import test from 'node:test'
import assert from 'node:assert/strict'
import { PARTS_FIELDS, setCell } from '../src/parts-workbook.mjs'
import { mergeSapWorkbook, retainSapWorkbookRows, migrateSapPending } from '../src/sap-workbook-sync.mjs'
import { sharedWorkbookState } from '../src/parts-workbook-link.mjs'
import { applySapSnapshotReferences } from '../src/sap-reference.mjs'
import { reconcile, isException, isHistoricalOrder, resolveFact } from '../src/reconciliation.mjs'
import { exceptionExportRows } from '../src/exception-export.mjs'
import { connectPublicWorkspace } from '../src/public-firebase-store.mjs'

const sap=(po='4500000001',extra={})=>({EBELN:po,EBELP:'00010',MATNR:'MAT1',MENGE:5,MEINS:'EA',TXZ01:'A part',WAERS:'AUD',...extra})
const workbook=()=>({sourceFile:'China.xlsx',sheets:[{id:'s0',name:'Sheet1',headerRows:1,merges:[],
  columns:PARTS_FIELDS.map((_,i)=>({id:`s0-c${i}`})),
  rows:[{id:'header',cells:PARTS_FIELDS,formulas:{},types:{}},...['OK','澳洲取消订单'].map((status,i)=>({id:`row${i}`,
    cells:PARTS_FIELDS.map(f=>({seq:i+1,po:`450000000${i+1}`,line:10,material:'MAT1',qty:5,completion:status,notes:'Keep China notes'}[f]??null)),
    formulas:{},types:{},fills:{'s0-c25':'#E2F0D9'}}))]}]})
const source={orders:[],shipments:[],issues:[]}
function linked(book,rows){const state=sharedWorkbookState(source,{},book).state;applySapSnapshotReferences(state,rows,1800000000000);return state.orders}

test('SAP adds missing orders once, leaves China cells intact and marks only the latest successful snapshot additions',()=>{
  const book=workbook(),before=structuredClone(book),rows=[sap(),sap('4500000002'),sap('4500000003')]
  let next=mergeSapWorkbook(book,linked(book,rows),rows,'run1')
  assert.deepEqual(book,before)
  assert.equal(next.sheets[0].rows.length,4)
  for(let i=1;i<3;i++)for(const field of ['cells','formulas','fills'])assert.deepEqual(next.sheets[0].rows[i][field],before.sheets[0].rows[i][field])
  assert.equal(next.sheets[0].rows[3].sapNewRun,'run1')
  assert.equal(next.sheets[0].rows[3].cells[25],null)
  assert.equal(next.sheets[0].rows[3].sapPending,true)
  assert.equal(mergeSapWorkbook(next,linked(next,rows),rows,'run1'),next)
  setCell(next.sheets[0],next.sheets[0].rows[3].id,25,'OK')
  setCell(next.sheets[0],next.sheets[0].rows[3].id,26,'Completed manually')
  const more=[...rows,sap('4500000004')]
  next=mergeSapWorkbook(next,linked(next,more),more,'run2')
  assert.equal(next.sheets[0].rows.length,5)
  assert.equal(next.sheets[0].rows[3].cells[25],'OK')
  assert.equal(next.sheets[0].rows[3].sapPending,false)
  assert.equal(next.sheets[0].rows[3].cells[26],'Completed manually')
  assert.deepEqual(linked(next,more).filter(o=>o.isNew).map(o=>o.po),['4500000004'])
  const unchanged=mergeSapWorkbook(next,linked(next,more),more,'run3')
  assert.equal(linked(unchanged,more).filter(o=>o.isNew).length,0)
})

test('China reimport owns matching statuses and retains absent pending and handled SAP orders across imports',()=>{
  const rows=[sap(),sap('4500000002'),sap('4500000003'),sap('4500000004'),sap('4500000005')]
  const old=mergeSapWorkbook(workbook(),linked(workbook(),rows),rows,'run1')
  const sheet=old.sheets[0]
  setCell(sheet,'sap-4500000004-10',25,'OK')
  setCell(sheet,'sap-4500000004-10',26,'Human completion notes')
  const incoming=workbook()
  const china=structuredClone(sheet.rows.find(r=>r.id==='sap-4500000003-10'))
  for(const field of ['sapOrigin','sapPending','sapNewRun','sapAnchor','importKey'])delete china[field]
  china.id='china-3';china.cells[25]='NG';china.cells[26]='China owns this note'
  incoming.sheets[0].rows.push(china)
  const before=structuredClone(incoming)
  const next=retainSapWorkbookRows(incoming,old)
  assert.deepEqual(incoming,before)
  assert.deepEqual(next.sheets[0].rows.slice(0,4),before.sheets[0].rows)
  assert.equal(next.sheets[0].rows.length,6)
  const byPo=po=>next.sheets[0].rows.find(r=>r.cells[2]===po)
  assert.equal(byPo('4500000003').sapOrigin,undefined)
  assert.equal(byPo('4500000003').cells[25],'NG')
  assert.equal(byPo('4500000004').cells[25],'OK')
  assert.equal(byPo('4500000004').cells[26],'Human completion notes')
  assert.equal(byPo('4500000005').sapPending,true)
  assert.equal(byPo('4500000005').cells[25],null)
  const again=retainSapWorkbookRows(incoming,next)
  assert.equal(again.sheets[0].rows.length,6)
  assert.equal(again.sheets[0].rows.at(-1).workbookOrderId,next.sheets[0].rows.at(-1).workbookOrderId)
  assert.equal(mergeSapWorkbook(next,linked(next,rows),rows,'run2').sheets[0].rows.length,6)
})

test('editing a pending SAP row starts NG processing, and invalid edits or untouched values do not',()=>{
  const rows=[sap(),sap('4500000002'),sap('4500000003')]
  const book=mergeSapWorkbook(workbook(),linked(workbook(),rows),rows,'run1'),sheet=book.sheets[0],row=sheet.rows.at(-1)
  setCell(sheet,row.id,26,'')
  assert.equal(row.sapPending,true)
  assert.throws(()=>setCell(sheet,row.id,26,'=VLOOKUP(A1,B1,1)'),/unsupported_formula/)
  assert.equal(row.sapPending,true)
  setCell(sheet,row.id,26,'Followed up with supplier')
  assert.equal(row.sapPending,false);assert.equal(row.cells[25],'NG')
  const next=mergeSapWorkbook(book,linked(book,rows),rows,'run2')
  assert.equal(next.sheets[0].rows.at(-1).sapPending,false)
  assert.equal(next.sheets[0].rows.at(-1).cells[26],'Followed up with supplier')
})

test('legacy migration clears only untouched automatically generated NG, preserving manual work',()=>{
  const rows=[sap(),sap('4500000002'),sap('4500000003'),sap('4500000004'),sap('4500000005')]
  const book=mergeSapWorkbook(workbook(),linked(workbook(),rows),rows,'run1')
  delete book.sapStatusVersion
  for(const row of book.sheets[0].rows.filter(r=>r.sapOrigin)){delete row.sapPending;row.cells[25]='NG'}
  book.sheets[0].rows[4].cells[26]='A human note'
  book.sheets[0].rows[5].cells[9]=7
  const next=migrateSapPending(book,rows)
  assert.equal(next.sheets[0].rows[3].sapPending,true)
  assert.equal(next.sheets[0].rows[3].cells[25],null)
  for(const r of [4,5]){assert.equal(next.sheets[0].rows[r].sapPending,false);assert.equal(next.sheets[0].rows[r].cells[25],'NG')}
  assert.equal(next.sheets[0].rows[1].cells[25],'OK')
  assert.equal(migrateSapPending(next,rows),next)
})

test('an anchored PO or material edit is an exception, never a duplicate new SAP order',()=>{
  const rows=[sap(),sap('4500000002')],book=mergeSapWorkbook(workbook(),linked(workbook(),rows),rows,'run1')
  setCell(book.sheets[0],'row0',2,'DIFFERENT-PO')
  setCell(book.sheets[0],'row0',8,'DIFFERENT-MATERIAL')
  const orders=linked(book,rows),completed=orders[0]
  assert.equal(isHistoricalOrder(completed),true,'explicit OK remains completed even when remaining quantity is positive')
  resolveFact(completed,'material',{factor:1},'Mapping confirmed')
  const checks=reconcile(orders,[])
  assert.deepEqual(checks.filter(c=>c.order===completed.id).map(c=>c.kind),['po','material'])
  assert.ok(checks.every(isException))
  const exported=exceptionExportRows(checks,orders,{language:'en'})
  assert.ok(exported.slice(1).some(row=>row.includes('DIFFERENT-PO')&&row.includes('4500000001')&&row.includes('DIFFERENT-MATERIAL')))
  assert.equal(mergeSapWorkbook(book,orders,rows,'run2').sheets[0].rows.length,3)
  assert.equal(completed.importCompletion,'OK')
})

test('latest China replacement is the baseline and ambiguous SAP candidates do not create duplicate orders',()=>{
  const book=workbook();book.sheets[0].rows=book.sheets[0].rows.slice(0,2)
  book.importId='latest-China';book.sheets[0].fieldColumns=Object.fromEntries(PARTS_FIELDS.map((f,i)=>[f,`s0-c${i}`]))
  book.sheets[0].rows[1].cells[3]=1
  const rows=[sap(),sap('4500000001',{EBELP:'00020'})]
  const next=mergeSapWorkbook(book,linked(book,rows),rows,'run1')
  assert.equal(next.sheets[0].rows.length,2)
  assert.equal(next.sheets[0].rows[1].cells[25],'OK')
})

test('workspace refresh compares the latest workbook with SAP and saves append-only changes using a conditional write',async()=>{
  let stored={schemaVersion:1,revision:1,bookJson:JSON.stringify(workbook())},writes=0,state,summary,errors=[]
  const rows=[sap(),sap('4500000002'),sap('4500000003')]
  const pointer={run:'1800000000000-1234567890abcdef1234567890abcdef',finishedAt:1800000000000,hash:'hash',counts:{po:3}}
  const fetcher=async(url,options={})=>{
    if(url.endsWith('/source.json'))return Response.json({kind:'excel',schemaVersion:1,generation:'g',dataJson:JSON.stringify(source),summary:{}})
    if(url.includes('/versions.json?'))return Response.json(null)
    if(url.endsWith('/partsWorkbook.json')){
      if(options.method==='PUT'){
        assert.equal(options.headers['If-Match'],`"${stored.revision}"`)
        stored={...JSON.parse(options.body),savedAt:1800000000001};writes++
      }
      return Response.json(stored,{headers:{etag:`"${stored.revision}"`}})
    }
    if(url.endsWith('/current.json'))return Response.json(pointer)
    if(url.endsWith('/hash.json'))return Response.json('hash')
    if(url.endsWith('/tables/po.json'))return Response.json(Object.fromEntries(rows.map((row,i)=>[i,row])))
    throw new Error(url)
  }
  const cloud=await connectPublicWorkspace(packet=>{state=packet.state;summary=packet.summary},e=>errors.push(e),{databaseURL:'https://example.test',fetcher,persistSapLinks:false})
  try {
    assert.deepEqual(errors,[]);assert.equal(writes,1);assert.equal(state.orders.length,3)
    assert.equal(state.orders.find(o=>o.po==='4500000003').isNew,true)
    assert.equal(summary.masterCompletion.NG,0)
    assert.equal(summary.masterCompletion.SAP,1)
    assert.equal(state.orders[0].importCompletion,'OK');assert.equal(state.orders[1].cancelled,true)
    await cloud.refresh();assert.equal(writes,1,'polling an unchanged pointer never writes or re-adds rows')
    const latest=JSON.parse(stored.bookJson);latest.importId='replacement';delete latest.sapRefreshRun
    latest.sheets[0].fieldColumns=Object.fromEntries(PARTS_FIELDS.map((f,i)=>[f,`s0-c${i}`]))
    latest.sheets[0].rows=latest.sheets[0].rows.filter(r=>r.id!=='row0')
    stored={...stored,revision:stored.revision+1,bookJson:JSON.stringify(latest)}
    await cloud.refresh()
    assert.equal(writes,2);assert.equal(state.orders.length,3)
    assert.equal(state.orders.find(o=>o.po==='4500000001').isNew,true,'compares unchanged SAP against a later China import')
  }finally{await cloud.disconnect()}
})
