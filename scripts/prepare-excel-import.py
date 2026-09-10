"""Read the four source workbooks, preserve evidence, and prepare a repeatable import.

No workbook is modified. No source file contents are executed as instructions.
SAP JSON arguments are previously extracted snapshots, not a claim of live sync.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import pathlib
import re
import openpyxl

FILES = {
    'weekly': '澳洲采购及售后配件发运8.29-9.4.xlsx',
    'open': '澳洲备品备件未完成清单截止9.4.xlsx',
    'delayed': '每周延迟发运（截止9.4）.xlsx',
    'master': '2026 Parts order list发澳洲.xlsx',
}
FIELDS = ['seq','mode','po','line','van','description_zh','description_en','supplier_reference','material','qty','category','so','buyer','ordered','agreed_etd','planned_etd','manager','eta_china','actual_ship','shipped','remaining','loaded_van','location','container','awb','completion','notes']
WEEKLY = ['po','description_zh','description_en','material','buyer','so','qty','shipped','actual_ship','loaded_van','location','container','awb','image']

def serial(value):
    return value.isoformat() if isinstance(value,(dt.datetime,dt.date,dt.time)) else value

def text(value):
    return '' if value is None or str(value).strip() in ('/','—','-','') else re.sub(r'\s+',' ',str(value)).strip()

def digits(value,width):
    value=text(value)
    return str(int(float(value))).zfill(width) if re.fullmatch(r'\d+(?:\.0)?',value) else None

def candidates(value,kind):
    value=text(value)
    if kind=='po':
        found=re.findall(r'(?<!\d)((?:45|49)\d{8})(?!\d)',value)
    else:
        direct=digits(value,10)
        found=[direct] if direct else [s.zfill(10) for s in re.findall(r'(?<!\d)(?:00)?(1\d{7})(?!\d)',value)]
    return sorted(set(found))

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def read_book(path,role):
    sha=hashlib.sha256(path.read_bytes()).hexdigest()
    book=openpyxl.load_workbook(path,read_only=True,data_only=True)
    raw={};records=[]
    try:
        for sheet_index,sheet in enumerate(book):
            rows={}
            for number,values in enumerate(sheet.iter_rows(values_only=True),1):
                if not any(v is not None for v in values):continue
                values=[serial(v) for v in values]
                rows[f'r{number}']=values
                if sheet_index!=0 or number<(4 if role=='master' else 2):continue
                fields=WEEKLY if role=='weekly' else FIELDS[:16]+['eta_unspecified']+FIELDS[16:] if role=='delayed' else FIELDS
                record=dict(zip(fields,values))
                # A completion marker is required in the master; totals/headers stay in raw sheets.
                if role=='master' and text(record.get('completion')) not in ('OK','NG','澳洲取消订单'):
                    raise ValueError(f'Unexpected master row layout at {sheet.title}:{number}')
                if role!='master' and not text(record.get('po')):raise ValueError(f'Missing PO at {role}:{number}')
                records.append({'id':f'{role}-{number:06d}','source':{'role':role,'file':path.name,'sha256':sha,'sheet':sheet.title,'row':number},'fields':record,'poCandidates':candidates(record.get('po'),'po'),'soCandidates':candidates(record.get('so'),'so'),'line':digits(record.get('line'),5)})
            raw[f's{sheet_index+1}']={'name':sheet.title,'rowCount':sheet.max_row,'columnCount':sheet.max_column,'rows':rows}
    finally:book.close()
    return {'name':path.name,'sha256':sha,'sheets':raw},records

def match_rows(extra,masters):
    f=extra['fields'];matches=[]
    for master in masters:
        g=master['fields']
        if not set(extra['poCandidates']).intersection(master['poCandidates']):continue
        if text(f.get('material'))!=text(g.get('material')) or f.get('qty')!=g.get('qty'):continue
        if extra['soCandidates'] and set(extra['soCandidates'])!=set(master['soCandidates']):continue
        if extra['line'] and master['line'] and extra['line']!=master['line']:continue
        matches.append(master)
    return matches

def prepare(directory,sap_dir):
    manifests={};sources={}
    for role,name in FILES.items():manifests[role],sources[role]=read_book(directory/name,role)
    masters=sources['master'];records={m['id']:{**m,'evidence':[m['id']],'sapMatches':[],'review':[]} for m in masters}
    source_rows={r['id']:r for rows in sources.values() for r in rows};issues={};links={}
    def issue(kind,record,evidence,detail):
        key=kind+'-'+fingerprint([record,evidence])[:20]
        issues[key]={'kind':kind,'record':record,'evidence':evidence,'detail':detail,'status':'待核对'}
        if record in records:records[record]['review'].append(key)
    for role in ('open','weekly','delayed'):
        for row in sources[role]:
            matches=match_rows(row,masters)
            if len(matches)==1:
                target=records[matches[0]['id']];target['evidence'].append(row['id']);links[row['id']]=target['id']
                differences={key:{'master':target['fields'].get(key),'supplement':value} for key,value in row['fields'].items() if key in target['fields'] and key not in ('seq','line','image') and text(value)!=text(target['fields'].get(key))}
                if differences:issue('source_difference',target['id'],[row['id']],differences)
            else:issue('source_link',None,[row['id']],{'candidateMasterRows':[m['id'] for m in matches],'reason':'ambiguous' if matches else 'not_found'})
    sap_files={};po=[]
    if sap_dir:
        p=sap_dir/'03-po.json'
        if p.exists():po=json.loads(p.read_text(encoding='utf-8-sig'));sap_files[p.name]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'fileModifiedAt':dt.datetime.fromtimestamp(p.stat().st_mtime,dt.timezone.utc).isoformat()}
    by_po=collections.defaultdict(list)
    for row in po:by_po[row['EBELN']].append(row)
    by_link=collections.defaultdict(list)
    for record in records.values():
        f=record['fields'];choices=[r for number in record['poCandidates'] for r in by_po[number]]
        if record['line']:choices=[r for r in choices if r['EBELP']==record['line']]
        else:choices=[r for r in choices if text(r['MATNR'])==text(f.get('material')) and r['MENGE']==f.get('qty')]
        if len(choices)==1:
            p=choices[0];record['sapMatches']=[{'po':p['EBELN'],'line':p['EBELP'],'method':'explicit_line' if record['line'] else 'unique_po_material_quantity','confirmed':False}]
            record['sapOriginal']=p;by_link[(p['EBELN'],p['EBELP'])].append(record['id'])
            if text(p['MATNR'])!=text(f.get('material')):issue('material',record['id'],[record['id']],{'sap':p['MATNR'],'excel':f.get('material')})
            if p['MENGE']!=f.get('qty'):issue('quantity',record['id'],[record['id']],{'sap':p['MENGE'],'excel':f.get('qty')})
            if p['NETPR'] in (None,0,1):issue('price',record['id'],[record['id']],{'price':p['NETPR'],'currency':p['WAERS'],'priceUnit':p['PEINH']})
        else:issue('sap_link',record['id'],[record['id']],{'candidateLines':[{'po':r['EBELN'],'line':r['EBELP']} for r in choices],'reason':'ambiguous' if choices else 'not_found_in_snapshot'})
    for (number,line),ids in by_link.items():
        if len(ids)>1:
            for rid in ids:issue('shared_po_line',rid,ids,{'po':number,'line':line,'note':'May be split dispatches or duplicate source rows; do not sum ordered quantities before confirmation.'})
    for row in sources['delayed']:
        issue('delivery_followup',links.get(row['id']),[row['id']],{'note':row['fields'].get('notes'),'remaining':row['fields'].get('remaining'),'etaRaw':row['fields'].get('eta_unspecified')})
    # Weekly rows are observations of existing records, never extra ordered quantity.
    dispatches={row['id']:{'sourceRow':row['id'],'record':links.get(row['id']),'reportedQty':row['fields'].get('shipped'),'reportedAt':row['fields'].get('actual_ship'),'containerNo':text(row['fields'].get('container')),'airWaybill':text(row['fields'].get('awb')),'loadedVan':text(row['fields'].get('loaded_van')),'location':text(row['fields'].get('location')),'sapMatchStatus':'待核对'} for row in sources['weekly']}
    summary={'sourceRows':{k:len(v) for k,v in sources.items()},'masterRecords':len(records),'masterCompletion':dict(collections.Counter(r['fields'].get('completion') for r in masters)),'linkedSupplementRows':len(links),'unlinkedSupplementRows':sum(len(sources[k]) for k in ('open','weekly','delayed'))-len(links),'uniqueMatchedSapPoLines':len(by_link),'sharedSapPoLineGroups':sum(len(ids)>1 for ids in by_link.values()),'reviewTasks':len(issues),'affectedMasterRecords':sum(bool(r['review']) for r in records.values()),'reviewKinds':dict(collections.Counter(i['kind'] for i in issues.values()))}
    content={'schemaVersion':1,'kind':'excel-initialization-staging','sourceFiles':manifests,'sourceRows':source_rows,'records':records,'links':links,'dispatchObservations':dispatches,'reviewTasks':issues,'sapEvidenceFiles':sap_files,'summary':summary,'notes':['OK is supplier-reported dispatch completion, not proof of SAP receipt.','China ETA and unspecified ETA are not AU warehouse ETA.','Quantities are not aggregated across unconfirmed units or shared SAP lines.','Workbook images are not extracted; original cell values and image formulas are preserved.','SAP matches are candidates from a prior local snapshot, not newly approved business mappings.']}
    content['contentHash']=fingerprint(content);content['batchId']='excel-'+content['contentHash'][:24]
    return content

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=pathlib.Path,required=True);parser.add_argument('--sap-directory',type=pathlib.Path);parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args()
    result=prepare(args.directory,args.sap_directory);args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'batchId':result['batchId'],**result['summary']},ensure_ascii=False))
