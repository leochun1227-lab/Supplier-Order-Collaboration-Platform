import copy
import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sap_sync', Path(__file__).parents[1] / 'scripts/sync_sap.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def extraction(start=100):
    return {'schemaVersion': 1, 'startedAt': start, 'finishedAt': start + 10,
            'scope': {'client': '800'}, 'tables': {
                'po': [{'EBELN': '4500000001', 'EBELP': '00010', 'MENGE': 10, 'OPTIONAL': None}],
                'so': [], 'deliveries': [], 'schedules': [], 'history': []}}


class FakeDB:
    def __init__(self, old=None, fail_stage=False, conflict=False):
        self.data = {'sap/current': old}
        self.writes = []
        self.fail_stage, self.conflict = fail_stage, conflict

    def request(self, path, value=None, method='GET', etag=None):
        if method == 'GET':
            return copy.deepcopy(self.data.get(path)), 'etag'
        if path.startswith('sap/runs/') and self.fail_stage:
            raise RuntimeError('firebase_http_503')
        if path == 'sap/current':
            assert etag == 'etag'
            if self.conflict:
                self.conflict = False
                self.data[path] = {'startedAt': 9999, 'hash': 'newer'}
                raise RuntimeError('firebase_http_412')
        self.writes.append(path)
        self.data[path] = sync.firebase_value(copy.deepcopy(value))
        return self.data[path], None


class SyncTests(unittest.TestCase):
    def test_validates_complete_generation_and_duplicates(self):
        raw = extraction()
        self.assertEqual(sync.build_snapshot(raw)['counts']['po'], 1)
        for table in sync.TABLE_KEYS:
            missing = copy.deepcopy(raw)
            del missing['tables'][table]
            with self.assertRaises(ValueError):
                sync.build_snapshot(missing)
        raw['tables']['po'] *= 2
        with self.assertRaises(ValueError):
            sync.build_snapshot(raw)
        raw['tables']['po'] = []
        with self.assertRaises(ValueError):
            sync.build_snapshot(raw)

    def test_stages_verified_snapshot_then_pointer_never_collaboration(self):
        db = FakeDB()
        snapshot = sync.build_snapshot(extraction())
        self.assertEqual(sync.publish(snapshot, db), 'published')
        self.assertTrue(db.writes[0].startswith('sap/runs/'))
        self.assertEqual(db.writes[1], 'sap/current')
        self.assertTrue(all(p.startswith(('sap/', 'sync/')) for p in db.writes))
        staged = db.data[db.writes[0]]
        self.assertNotIn('so', staged['tables'])
        self.assertEqual(staged['counts']['so'], 0)
        self.assertNotIn('OPTIONAL', next(iter(staged['tables']['po'].values())))

    def test_failures_and_late_runs_do_not_replace_current(self):
        previous = {'startedAt': 50, 'hash': 'previous'}
        db = FakeDB(previous, fail_stage=True)
        with self.assertRaises(RuntimeError):
            sync.publish(sync.build_snapshot(extraction()), db)
        self.assertEqual(db.data['sap/current'], previous)
        db = FakeDB(previous, conflict=True)
        self.assertEqual(sync.publish(sync.build_snapshot(extraction()), db), 'superseded')
        self.assertEqual(db.data['sap/current']['hash'], 'newer')

    def test_unchanged_data_does_not_duplicate_snapshots(self):
        first = sync.build_snapshot(extraction())
        second = sync.build_snapshot(extraction(200))
        self.assertEqual(first['hash'], second['hash'])
        db = FakeDB({'hash': first['hash']})
        self.assertEqual(sync.publish(second, db), 'unchanged')
        self.assertEqual(db.writes, ['sync/lastSuccessfulCheck'])

    def test_extraction_uses_readonly_select_and_rolls_back(self):
        config = {'client': '800', 'company': '3110', 'plant': '3111', 'supplier': '0000003060',
                  'salesOrg': '3090', 'customer': '0000003060'}
        calls = []
        class Cursor:
            description = [('EBELN',), ('EBELP',)]
            def execute(self, sql):
                calls.append(sql)
                self.rows = [('4500000001', '00010')] if len(calls) == 1 else []
            def fetchmany(self, _):
                rows, self.rows = self.rows, []
                return rows
            def close(self): pass
        class Connection:
            @property
            def timeout(self): return 0
            @timeout.setter
            def timeout(self, _): raise RuntimeError('HYC00', 'Optional feature not implemented')
            def cursor(self): return Cursor()
            def rollback(self): self.rolled_back = True
            def close(self): self.closed = True
        conn = Connection()
        def connect(dsn, **kwargs):
            self.assertEqual(kwargs, {'timeout': 20, 'autocommit': False})
            return conn
        with patch.object(sync, 'connection_string', return_value='test-only'):
            snapshot = sync.extract(config, connect)
        self.assertEqual(len(calls), 5)
        self.assertTrue(all(sql.lstrip().startswith('SELECT') and ';' not in sql for sql in calls))
        self.assertTrue(conn.rolled_back and conn.closed)
        self.assertEqual(snapshot['counts']['po'], 1)
        with self.assertRaises(ValueError):
            sync.query_for('po', {**config, 'client': "800' OR 1=1"})

    def test_hana_credentials_remain_literal_and_cannot_inject_options(self):
        credential_path = Path(__file__).resolve()
        config = {'sapCredentialPath': str(credential_path), 'serverNode': 'sap.test:30015'}
        with patch.dict(sync.os.environ, {}, clear=True):
            with patch.object(sync.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=0, stdout=b'{"user":"TEST_USER","password":"fake!password"}')):
                self.assertEqual(sync.connection_string(config),
                                 'DRIVER={HDBODBC};SERVERNODE=sap.test:30015;UID=TEST_USER;PWD=fake!password;')
            with patch.object(sync.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=0, stdout=b'{"user":"TEST_USER","password":"bad;UID=OTHER"}')):
                with self.assertRaisesRegex(ValueError, 'unsupported_hana_connection_value'):
                    sync.connection_string(config)

    def test_transport_rejects_collaboration_paths_before_network(self):
        db = sync.Firebase({'firebasePublicTest': True})
        with self.assertRaises(ValueError):
            db.request('workspaces/excel-20260904/source', {}, 'PUT')


if __name__ == '__main__':
    unittest.main()
