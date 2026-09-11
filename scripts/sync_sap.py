"""Read-only SAP HANA extraction and independent Firebase snapshot publishing.

Windows entry point: run.bat. Credentials stay on the sync computer, outside
the web build. No writes are made to SAP or the collaboration workspace.
"""
import argparse
import contextlib
import datetime as dt
import decimal
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

TABLE_KEYS = {
    'po': ['EBELN', 'EBELP'], 'so': ['VBELN', 'POSNR'],
    'deliveries': ['VBELN', 'POSNR'], 'schedules': ['EBELN', 'EBELP', 'ETENR'],
    'history': ['EBELN', 'EBELP', 'ZEKKN', 'VGABE', 'GJAHR', 'BELNR', 'BUZEI'],
}
SCOPE_KEYS = ('client', 'company', 'plant', 'supplier', 'salesOrg', 'customer')
DATABASE = 'https://supplier-collaboration-30ddf-default-rtdb.asia-southeast1.firebasedatabase.app'
ROOT = Path(__file__).resolve().parent


def millis():
    return int(time.time() * 1000)


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def safe_value(value):
    if isinstance(value, decimal.Decimal):
        value = float(value)
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('non_finite_sap_value')
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    return value


def query_for(name, config):
    scope = {k: str(config[k]) for k in SCOPE_KEYS}
    if any(not re.fullmatch(r'\d{3,10}', value) for value in scope.values()):
        raise ValueError('invalid_sap_scope')
    sql = (ROOT / 'sap-queries' / (name + '.sql')).read_text(encoding='utf-8-sig').format(**scope)
    if (not re.match(r'^\s*SELECT\b', sql, re.I) or
            re.search(r';|--|/\*|\b(INTO|UPDATE|DELETE|INSERT|DROP|ALTER|CREATE|CALL|MERGE|UPSERT)\b', sql, re.I)):
        raise ValueError('only_select_allowed')
    return sql


def connection_string(config):
    if os.environ.get('SAP_HANA_DSN'):
        return os.environ['SAP_HANA_DSN']
    credential = Path(config['sapCredentialPath']).resolve(strict=True)
    # Export-Clixml encrypts the password for the Windows user on this computer.
    # Capture the decrypted value only in memory; never forward subprocess output.
    script = ('$ErrorActionPreference="Stop";[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'
              '$c=Import-Clixml -LiteralPath $env:REGENT_SAP_CREDENTIAL;'
              '@{user=$c.UserName;password=$c.GetNetworkCredential().Password}|ConvertTo-Json -Compress')
    result = subprocess.run(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
        env={**os.environ, 'REGENT_SAP_CREDENTIAL': str(credential)},
        capture_output=True, timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    if result.returncode:
        raise ValueError('credential_unavailable_for_windows_user')
    values = json.loads(result.stdout.decode('utf-8-sig'))
    # HDBODBC treats braces in UID/PWD as literal credential characters.
    # Reject delimiters rather than allowing values to inject connection options.
    def hana_value(value):
        value = str(value)
        if not value or any(char in value for char in ';\r\n\0'):
            raise ValueError('unsupported_hana_connection_value')
        return value
    return 'DRIVER={HDBODBC};' + ';'.join(f'{key}={hana_value(value)}' for key, value in {
        'SERVERNODE': config['serverNode'],
        'UID': values['user'], 'PWD': values['password'],
    }.items()) + ';'


def extract(config, connect=None):
    if connect is None:
        import pyodbc
        connect = pyodbc.connect
    queries = {name: query_for(name, config) for name in TABLE_KEYS}
    started = millis()
    # HDBODBC rejects SQL_ATTR_ACCESS_MODE (HYC00). Read-only behavior is
    # enforced by the SELECT-only query validation above and the SAP account.
    conn = connect(connection_string(config), timeout=20, autocommit=False)
    tables = {}
    try:
        try:
            conn.timeout = 120
        except Exception as error:
            # Some HDBODBC versions do not expose the optional connection
            # timeout attribute. Do not turn a successful login into a failure.
            if not error.args or error.args[0] != 'HYC00':
                raise
        for name, sql in queries.items():
            cursor = conn.cursor()
            try:
                cursor.execute(sql)
                columns = [col[0] for col in cursor.description]
                rows = []
                while True:
                    batch = cursor.fetchmany(1000)
                    if not batch:
                        break
                    rows.extend({key: safe_value(value) for key, value in zip(columns, row)} for row in batch)
                    if len(rows) > 50000:
                        raise ValueError('sap_row_limit_exceeded')
                tables[name] = rows
            finally:
                cursor.close()
        return build_snapshot({'schemaVersion': 1, 'startedAt': started, 'finishedAt': millis(),
                               'scope': {k: str(config[k]) for k in SCOPE_KEYS}, 'tables': tables})
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()


def build_snapshot(raw):
    if (raw.get('schemaVersion') != 1 or not isinstance(raw.get('startedAt'), (int, float)) or
            not isinstance(raw.get('finishedAt'), (int, float)) or raw['finishedAt'] < raw['startedAt']):
        raise ValueError('invalid_extraction')
    tables, counts = {}, {}
    for name, fields in TABLE_KEYS.items():
        rows = raw.get('tables', {}).get(name)
        if not isinstance(rows, list) or len(rows) > 50000:
            raise ValueError('missing_or_oversized_table')
        records = {}
        for row in rows:
            if any(row.get(k) is None or str(row[k]) == '' for k in fields):
                raise ValueError('missing_sap_key')
            key = '_'.join(str(row[k]) for k in fields)
            if key in records or re.search(r'[.#$\[\]/\x00-\x1f\x7f]', key):
                raise ValueError('duplicate_or_invalid_sap_key')
            records[key] = row
        tables[name], counts[name] = records, len(rows)
    if not counts['po']:
        raise ValueError('empty_po_extraction')
    digest = hashlib.sha256(encode({'scope': raw['scope'], 'tables': tables}).encode('utf-8')).hexdigest()
    return {**{k: raw[k] for k in ('schemaVersion', 'startedAt', 'finishedAt', 'scope')},
            'tables': tables, 'counts': counts, 'hash': digest}


class Firebase:
    def __init__(self, config):
        # Public REST access is the mode explicitly selected for this project.
        # Fail closed if this setting has not been intentionally configured.
        if config.get('firebasePublicTest') is not True:
            raise ValueError('firebase_access_mode_not_configured')

    def request(self, path, value=None, method='GET', etag=None):
        if not (path.startswith('sap/') or path.startswith('sync/')):
            raise ValueError('write_outside_sync_namespace')
        headers = {'Content-Type': 'application/json'}
        if method == 'GET':
            headers['X-Firebase-ETag'] = 'true'
        if etag is not None:
            headers['If-Match'] = etag
        request = urllib.request.Request(
            f'{DATABASE}/supplierCollaboration/{path}.json',
            data=None if method == 'GET' else encode(value).encode('utf-8'),
            headers=headers, method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response), response.headers.get('ETag')
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'firebase_http_{error.code}') from None


def publish(snapshot, db):
    current, _ = db.request('sap/current')
    if current and current.get('hash') == snapshot['hash']:
        db.request('sync/lastSuccessfulCheck', millis(), 'PUT')
        return 'unchanged'
    run = str(snapshot['startedAt']) + '-' + uuid.uuid4().hex
    db.request('sap/runs/' + run, snapshot, 'PUT')
    # Verify the whole staged generation before exposing it as the latest one.
    staged, _ = db.request('sap/runs/' + run)
    if staged != firebase_value(snapshot):
        raise ValueError('snapshot_readback_mismatch')
    pointer = {k: snapshot[k] for k in ('hash', 'startedAt', 'finishedAt', 'counts')}
    pointer['run'] = run
    for _ in range(4):
        old, etag = db.request('sap/current')
        if old and old.get('startedAt', 0) > snapshot['startedAt']:
            return 'superseded'
        if not etag:
            raise ValueError('conditional_write_unavailable')
        try:
            db.request('sap/current', pointer, 'PUT', etag)
            break
        except RuntimeError as error:
            if str(error) != 'firebase_http_412':
                raise
    else:
        raise ValueError('snapshot_pointer_conflict')
    db.request('sync/runs/' + run, {'status': 'complete', 'at': millis(), 'counts': snapshot['counts']}, 'PUT')
    db.request('sync/lastSuccessfulCheck', millis(), 'PUT')
    return 'published'


def firebase_value(value):
    """RTDB omits null fields and empty collections on read-back."""
    if isinstance(value, dict):
        return {k: v for k, item in value.items() if (v := firebase_value(item)) is not None} or None
    if isinstance(value, list):
        return [firebase_value(item) for item in value] or None
    return value


@contextlib.contextmanager
def single_run(path):
    import msvcrt
    with path.open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError('sync_already_running') from None
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--dry-run', action='store_true', help='Read and validate SAP, without Firebase writes')
    args = parser.parse_args()
    stage, logger = 'configuration', None
    try:
        config_path = Path(args.config).resolve(strict=True)
        config = json.loads(config_path.read_text(encoding='utf-8-sig'))
        output = Path(config.get('outputDir', str(ROOT.parent / 'outputs' / 'firebase-sync'))).resolve()
        output.mkdir(parents=True, exist_ok=True)
        logger = logging.getLogger('sap-sync')
        logger.setLevel(logging.INFO)
        handler = RotatingFileHandler(output / 'sync.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
        logger.addHandler(handler)
        with single_run(output / 'sync.lock'):
            stage = 'sap_read'
            snapshot = extract(config)
            (output / 'latest-extraction.json').write_text(encode(snapshot), encoding='utf-8')
            stage = 'firebase_publish'
            status = 'dry_run' if args.dry_run else publish(snapshot, Firebase(config))
            result = {'status': status, 'counts': snapshot['counts'], 'finishedAt': snapshot['finishedAt']}
            logger.info(encode(result))
            print(encode(result))
        return 0
    except Exception as error:
        # Driver and HTTP exceptions may include credentials or business values.
        # Never print exception messages, connection strings or stack traces.
        result = {'status': 'failed', 'stage': stage, 'errorType': type(error).__name__}
        if logger:
            logger.error(encode(result))
        print(encode(result), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
