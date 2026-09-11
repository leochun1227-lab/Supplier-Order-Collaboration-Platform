import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSapReferences, sapReferenceFields } from '../src/sap-reference.mjs'
import { detectChecks, reconcile, resolveFact, updateCase, factsFor } from '../src/reconciliation.mjs'
import { sharedWorkbookState } from '../src/parts-workbook-link.mjs'
import { hydrateState, projectState } from '../src/persistence.mjs'
import { connectPublicWorkspace } from '../src/public-firebase-store.mjs'
import { exceptionExportRows } from '../src/exception-export.mjs'

const id='excel-1234567890abcdef12345678'
const order=()=>({id:'row1',imported:true,po:'4900000001',item:'00010',
  sapPo:'4900000001',sapItem:'00010',sapReferenceStatus:'matched',sapPart:'MAT1',soPart:'MAT1',
  unit:'EA',soUnit:'EA',buyer:'Buyer',qty:0,reported:0,cancelled:true,
  importFields:{po:4900000001,line:10},importEvidence:[{file:'test.xlsx',sheet:'Sheet1',row:4}]})
const source=()=>({orders:[order()],shipments:[],issues:[]})
const referenceKinds=rows=>detectChecks(rows,[]).filter(c=>['po','po_line','po_line_missing','sap_reference'].includes(c.kind))

test('PO and line compare current Excel against independent SAP originals, including completed records',()=>{
  const o=order()
  assert.deepEqual(referenceKinds([o]),[])
  o.importFields.po='4900000002';o.importFields.line='00020'
  const checks=referenceKinds([o])
  assert.deepEqual(checks.map(c=>c.kind),['po','po_line'])
  assert.match(checks[0].detail,/SAP: 4900000001 ↔ Excel: 4900000002/)
  assert.match(checks[1].detail,/SAP: 00010 ↔ Excel: 00020/)
  assert.equal(factsFor(o,[])[0].business,'4900000002')
})

test('numeric leading zeros and surrounding spaces do not mismatch; blank or compound Excel values do',()=>{
  const o=order();o.importFields={po:' 04900000001 ',line:' 10 '}
  assert.deepEqual(referenceKinds([o]),[])
  for(const value of ['',null,'/','—','-']) {
    o.importFields.line=value
    assert.equal(referenceKinds([o])[0].kind,'po_line_missing')
  }
  o.importFields={po:'4900000001 / 4900000002',line:10}
  assert.equal(referenceKinds([o])[0].kind,'po')
  o.importFields={po:'00ABC',line:10};o.sapPo='ABC'
  assert.equal(referenceKinds([o])[0].kind,'po')
})

test('missing references do not invent mismatch values and differ from failed reads',()=>{
  const o={...order(),...sapReferenceFields({})}
  assert.equal(referenceKinds([o]).length,1)
  assert.match(referenceKinds([o])[0].detail.en,/No unique SAP link/)
  Object.assign(o,sapReferenceFields(null))
  assert.match(referenceKinds([o])[0].detail.en,/unavailable/)
  assert.equal(o.sapPo,'')
})

test('missing Line No is separate from mismatches and previous misclassification retains its history',()=>{
  const o=order();o.importFields.line='/'
  const previous=[{id:'CHECK-row1-po_line',order:'row1',kind:'po_line',status:'处理中',note:'Existing follow-up'}]
  const checks=reconcile([o],[],previous),missing=checks.find(c=>c.kind==='po_line_missing')
  assert.ok(missing);assert.equal(missing.priority,'中')
  assert.equal(checks.filter(c=>c.kind==='po_line'&&c.status!=='已解决').length,0)
  assert.equal(checks.find(c=>c.kind==='po_line').note,'Existing follow-up')
  assert.match(checks.find(c=>c.kind==='po_line').closure.en,/Reclassified/)
  o.importFields.line=10
  assert.deepEqual(referenceKinds([o]),[])
  o.importFields.line=20
  assert.deepEqual(referenceKinds([o]).map(c=>c.kind),['po_line'])
})

test('PO discrepancy remains open after follow-up, closes on correction and reopens on another edit',()=>{
  const o=order();o.importFields.po='CHANGED'
  let checks=reconcile([o],[])
  updateCase(checks,checks[0].id,{owner:'Leo',due:'2026-10-01',note:'Investigating'})
  assert.throws(()=>resolveFact(o,'po',{},'Approved'),/source_required/)
  checks=reconcile([o],[],checks)
  assert.equal(checks[0].status,'处理中')
  o.importFields.po=o.sapPo;checks=reconcile([o],[],checks)
  assert.equal(checks[0].status,'已解决')
  o.importFields.po='NEW';checks=reconcile([o],[],checks)
  assert.equal(checks[0].status,'待处理');assert.equal(checks[0].note,'Investigating')
})

test('a failed SAP reference read cannot close a previously detected PO mismatch',()=>{
  const o=order();o.importFields.po='CHANGED'
  const previous=reconcile([o],[])
  Object.assign(o,sapReferenceFields(null))
  const next=reconcile([o],[],previous)
  assert.equal(next.find(c=>c.kind==='po').status,'待处理')
  assert.equal(next.find(c=>c.kind==='po').closure,undefined)
  assert.ok(next.some(c=>c.kind==='sap_reference'))
})

test('legacy source loads references by stable ID without rewriting business fields; known unmatched and unavailable stay distinct',async()=>{
  const data=source();delete data.orders[0].sapReferenceStatus
  const payload={batchId:id,schemaVersion:1,records:{row1:{sapOriginal:{EBELN:'ORIGINAL-PO',EBELP:'00020'}}}}
  let reads=0
  await loadSapReferences(data,{importBatch:id},{databaseURL:'https://example.test',fetcher:async url=>{
    reads++;assert.ok(url.endsWith(`/imports/${id}/payloadJson.json`))
    return new Response(JSON.stringify(JSON.stringify(payload)))
  }})
  assert.equal(data.orders[0].sapPo,'ORIGINAL-PO');assert.equal(data.orders[0].po,'4900000001')
  await loadSapReferences(data,{importBatch:id},{fetcher:()=>{throw Error('unexpected fetch')}})
  assert.equal(reads,1)
  for(const value of [null,JSON.stringify({...payload,batchId:'different'}),'invalid json']) {
    const missing={orders:[{id:'row1',imported:true}]}
    await loadSapReferences(missing,{importBatch:id},{fetcher:async()=>new Response(JSON.stringify(value))})
    assert.equal(missing.orders[0].sapReferenceStatus,'unavailable')
  }
  const missing={orders:[{id:'row1',imported:true}]}
  await loadSapReferences(missing,{importBatch:id},{fetcher:async()=>{throw Error('offline')}})
  assert.equal(missing.orders[0].sapReferenceStatus,'unavailable')
})

test('saved workbook PO and line edits flow through Firebase composition, exceptions and export; SAP stays immutable',async()=>{
  const data=source();delete data.orders[0].sapReferenceStatus
  // Include blank headers and original field IDs, as in the real workbook.
  const book={sourceFile:'test.xlsx',sheets:[{id:'s0',name:'Sheet1',headerRows:3,
    columns:Array.from({length:27},(_,i)=>({id:`s0-c${i}`})),merges:[],
    rows:[1,2,3,4].map(i=>({id:`s0-r${i}`,cells:Array(27).fill(null),formulas:{},types:{}}))}]}
  book.sheets[0].rows[3].cells[2]='CHANGED-PO'
  book.sheets[0].rows[3].cells[3]='00020'
  const raw={...data.orders[0].importFields,material:'MAT1'}
  data.orders[0].importFields=raw
  const payload={batchId:id,schemaVersion:1,records:{row1:{sapOriginal:{EBELN:'4900000001',EBELP:'00010'}}}}
  const savedSource={kind:'excel',schemaVersion:1,generation:'g',importBatch:id,dataJson:JSON.stringify(data)}
  let state
  const cloud=await connectPublicWorkspace(packet=>{state=packet.state},error=>{throw error},{databaseURL:'https://example.test',fetcher:async(url,options)=>{
    assert.equal(options?.method,undefined,'read-only loading')
    if(url.endsWith('/source.json'))return Response.json(savedSource)
    if(url.includes('/imports/'))return Response.json(JSON.stringify(payload))
    if(url.includes('/versions.json?'))return Response.json(null)
    if(url.endsWith('/partsWorkbook.json'))return Response.json({schemaVersion:1,revision:1,bookJson:JSON.stringify(book)})
    throw new Error(url)
  }})
  try {
    const checks=referenceKinds(state.orders)
    assert.deepEqual(checks.map(c=>c.kind),['po','po_line'])
    assert.equal(state.orders[0].sapPo,'4900000001')
    const rows=exceptionExportRows(checks,state.orders,{language:'en'})
    const exported=Object.fromEntries(rows[0].map((key,i)=>[key,rows[1][i]]))
    assert.equal(exported['SAP PO'],'4900000001');assert.equal(exported['Workbook / business PO'],'CHANGED-PO')
    assert.equal(exported['SAP line'],'00010');assert.equal(exported['Workbook / business line'],'00020')
    const overlay=projectState(state);overlay.orders.row1.sapPo='FORGED'
    assert.equal(hydrateState(state,overlay).orders[0].sapPo,'4900000001')
    const corrected=structuredClone(book)
    corrected.sheets[0].rows[3].cells[2]='4900000001';corrected.sheets[0].rows[3].cells[3]=10
    cloud.updateWorkbook({book:corrected,revision:2})
    assert.deepEqual(referenceKinds(state.orders),[])
    const replay=sharedWorkbookState(state,overlay,corrected)
    assert.equal(replay.state.orders[0].sapPo,'4900000001')
  } finally {await cloud.disconnect()}
})
