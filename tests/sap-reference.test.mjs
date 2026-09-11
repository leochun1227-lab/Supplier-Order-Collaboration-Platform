import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSapReferences, sapReferenceFields, applySapSnapshotReferences, refreshSapSnapshot, sapLineMatches } from '../src/sap-reference.mjs'
import { detectChecks, reconcile, resolveFact, updateCase, factsFor } from '../src/reconciliation.mjs'
import { sharedWorkbookState } from '../src/parts-workbook-link.mjs'
import { hydrateState, projectState } from '../src/persistence.mjs'
import { connectPublicWorkspace } from '../src/public-firebase-store.mjs'
import { exceptionExportRows } from '../src/exception-export.mjs'
import { createSapAnchorStore } from '../src/sap-anchor-store.mjs'

const id='excel-1234567890abcdef12345678'
const order=()=>({id:'row1',imported:true,po:'4900000001',item:'00010',
  sapPo:'4900000001',sapItem:'00010',sapReferenceStatus:'matched',sapPart:'MAT1',soPart:'MAT1',
  unit:'EA',soUnit:'EA',buyer:'Buyer',qty:0,reported:0,cancelled:true,
  importFields:{po:4900000001,line:10},importEvidence:[{file:'test.xlsx',sheet:'Sheet1',row:4}]})
const source=()=>({orders:[order()],shipments:[],issues:[]})
const referenceKinds=rows=>detectChecks(rows,[]).filter(c=>['po','po_line','po_line_missing','sap_reference'].includes(c.kind))

const unlinked=()=>({...order(),sapPo:'',sapItem:'',sapReferenceStatus:'unmatched',qty:5,part:'MAT1',importFields:{po:'4900000001',line:1,material:'MAT1',qty:5}})
const sapRow=(line='00010',extra={})=>({EBELN:'4900000001',EBELP:line,MATNR:'MAT1',MENGE:5,MEINS:'EA',NETPR:12,PEINH:1,WAERS:'AUD',...extra})
const apply=(o,rows=[sapRow()])=>{applySapSnapshotReferences({orders:[o]},rows,1789104255050);return o}

test('unique PO, material and quantity links sequential Excel numbering without rewriting source values',()=>{
  const o=apply(unlinked())
  assert.equal(o.sapItem,'00010');assert.equal(o.importFields.line,1)
  assert.equal(o.sapLinkMethod,'po_material_quantity');assert.equal(o.sapLineConvention,'sequence')
  assert.equal(sapLineMatches(o),true);assert.deepEqual(referenceKinds([o]),[])
  assert.equal(o.quantityComparable,false,'identity association does not authorize quantity conversion')
  for(const patch of [{po:'4900000002'},{line:2},{qty:6},{material:'OTHER'}]){
    const edited=structuredClone(o);Object.assign(edited.importFields,patch)
    if(patch.qty)edited.qty=patch.qty
    if(patch.material)edited.soPart=patch.material
    assert.equal(sapLineMatches(edited),!patch.line,'only a changed line invalidates an established numbering convention')
  }
})

test('exact SAP line takes precedence; ambiguous matches stay unlinked; real numbering differences stay visible',()=>{
  const direct=apply(unlinked(),[sapRow('00001',{MATNR:'OTHER'}),sapRow()])
  assert.equal(direct.sapItem,'00001');assert.equal(direct.sapPart,'OTHER');assert.equal(direct.sapLineConvention,'sap')
  assert.ok(detectChecks([direct],[]).some(c=>c.kind==='material'))
  const ambiguous=apply(unlinked(),[sapRow(),sapRow('00020')])
  assert.equal(ambiguous.sapReferenceStatus,'unmatched');assert.equal(ambiguous.sapReferenceReason,'ambiguous')
  assert.equal(ambiguous.sapItem,'')
  const mismatch=apply(unlinked(),[sapRow('00030')])
  assert.equal(mismatch.sapReferenceStatus,'matched');assert.equal(mismatch.sapLineConvention,'sap')
  assert.deepEqual(referenceKinds([mismatch]).map(c=>c.kind),['po_line'])
})

test('snapshot refresh preserves the proven SAP anchor, collaboration and genuine changed SAP material',()=>{
  const o=apply(unlinked());o.eta='2026-10-01';o.comments=[{text:'Keep me'}]
  apply(o,[sapRow('00010',{MATNR:'NEW'}),sapRow('00020')])
  assert.equal(o.sapItem,'00010');assert.equal(o.sapPart,'NEW');assert.equal(o.eta,'2026-10-01')
  assert.equal(sapLineMatches(o),true,'a SAP material change must not invent a line mismatch')
  assert.deepEqual(o.comments,[{text:'Keep me'}]);assert.ok(detectChecks([o],[]).some(c=>c.kind==='material'))
  apply(o,[sapRow('00020')])
  assert.equal(o.sapReferenceReason,'snapshot_line_missing');assert.equal(o.sapItem,'')
  apply(o,[sapRow()]);assert.equal(o.sapItem,'00010')
})

test('latest snapshot validates complete count, hash and unique rows atomically; unchanged pointers avoid table downloads',async()=>{
  const pointer={run:'1789104243174-a81c04a60c154b3b9f60bd5e139628d4',finishedAt:1789104255050,counts:{po:1},hash:'test-hash'}
  let records={a:sapRow()},hash=pointer.hash,reads=[]
  const fetcher=async(url,options)=>{assert.equal(options.method,undefined);reads.push(url);return Response.json(url.endsWith('/current.json')?pointer:url.endsWith('/hash.json')?hash:records)}
  const data={orders:[unlinked()]},before=structuredClone(data)
  hash='wrong';await assert.rejects(refreshSapSnapshot(data,{fetcher}),/incomplete/);assert.deepEqual(data,before)
  hash=pointer.hash;records={};await assert.rejects(refreshSapSnapshot(data,{fetcher}),/incomplete/);assert.deepEqual(data,before)
  records={a:sapRow(),b:sapRow()};pointer.counts.po=2
  await assert.rejects(refreshSapSnapshot(data,{fetcher}),/duplicate/);assert.deepEqual(data,before)
  records={a:sapRow()};pointer.counts.po=1
  const run=await refreshSapSnapshot(data,{fetcher});assert.equal(data.orders[0].sapItem,'00010')
  reads=[];assert.equal(await refreshSapSnapshot(data,{fetcher,previousRun:run}),run);assert.equal(reads.length,1)
})

test('public workspace refresh reads new SAP snapshots and keeps last good data during an outage and reload',async()=>{
  let state,registry=null,offline=false,run='1789104243174-a81c04a60c154b3b9f60bd5e139628d4',rows={a:sapRow()}
  const original={orders:[{...unlinked(),eta:'2026-10-01'}],shipments:[],issues:[]}
  const fetcher=async(url,options)=>{
    if(url.includes('/sapReferenceLinks/')){
      if(offline)throw new Error('offline')
      if(options.method==='PUT'){assert.equal(options.headers['If-Match'],'test-etag');registry=JSON.parse(options.body)}
      return Response.json(registry,{headers:{etag:'test-etag'}})
    }
    assert.equal(options?.method,undefined)
    if(url.endsWith('/source.json'))return Response.json({kind:'excel',schemaVersion:1,generation:'g',dataJson:JSON.stringify(original)})
    if(url.includes('/versions.json?')||url.endsWith('/partsWorkbook.json'))return Response.json(null)
    if(offline)throw new Error('offline')
    if(url.endsWith('/current.json'))return Response.json({run,finishedAt:1789104255050,counts:{po:1},hash:'hash'})
    if(url.endsWith('/hash.json'))return Response.json('hash')
    if(url.endsWith('/tables/po.json'))return Response.json(rows)
    throw new Error(url)
  }
  const cloud=await connectPublicWorkspace(p=>state=p.state,e=>{throw e},{fetcher})
  try{
    assert.equal(state.orders[0].sapItem,'00010');assert.equal(state.orders[0].eta,'2026-10-01')
    offline=true;await cloud.refresh();assert.equal(state.orders[0].sapItem,'00010');assert.equal(state.orders[0].sapReferenceRefreshError,true)
    offline=false;await cloud.refresh();assert.equal(state.orders[0].sapReferenceRefreshError,false)
    run='1789104243175-a81c04a60c154b3b9f60bd5e139628d4';rows={a:sapRow('00010',{MATNR:'NEW'})}
    await cloud.refresh();assert.equal(state.orders[0].sapPart,'NEW');assert.equal(state.orders[0].eta,'2026-10-01')
    assert.ok(detectChecks(state.orders,[]).some(c=>c.kind==='material'))
    const reloaded=await connectPublicWorkspace(p=>state=p.state,e=>{throw e},{fetcher})
    await reloaded.disconnect();assert.equal(state.orders[0].sapPart,'NEW');assert.equal(state.orders[0].sapItem,'00010')
    assert.equal(sapLineMatches(state.orders[0]),true,'numbering convention survives page reloads')
  }finally{await cloud.disconnect()}
})

test('anchor conflicts fail closed and a lost save acknowledgement is safely verified',async()=>{
  let value=null,conflict=false,loseAck=false
  const store=createSapAnchorStore({base:'https://example.test',generation:'g',fetcher:async(url,options)=>{
    if(options.method==='PUT'){
      if(conflict)return new Response('',{status:412})
      value=JSON.parse(options.body)
      if(loseAck)throw Error('connection_lost')
    }
    return Response.json(value,{headers:{etag:'etag'}})
  }})
  const data={orders:[unlinked()]},save=await store(data);applySapSnapshotReferences(data,[sapRow()],1789104255050)
  conflict=true;await assert.rejects(save(data),/save_failed/);assert.equal(value,null)
  conflict=false;loseAck=true;await save(data);assert.equal(value.links.row1.anchor.item,'00010')
  const newSource={orders:[unlinked()]};newSource.orders[0].importFields.material='CHANGED'
  await assert.rejects(store(newSource),/source_conflict/)
})

test('incomplete or older SAP snapshots cannot replace the last good snapshot',async()=>{
  const data={orders:[unlinked()],sapSnapshotFinishedAt:200},before=structuredClone(data)
  const pointer={run:'1-a81c04a6-0c15-4b3b-9f60-bd5e139628d4',finishedAt:100,counts:{po:1},hash:'hash'}
  const fetcher=async url=>Response.json(url.endsWith('/current.json')?pointer:url.endsWith('/hash.json')?'hash':{a:sapRow('00010',{MENGE:null})})
  await assert.rejects(refreshSapSnapshot(data,{fetcher}),/older/);assert.deepEqual(data,before)
  pointer.finishedAt=300;await assert.rejects(refreshSapSnapshot(data,{fetcher}),/incomplete/);assert.deepEqual(data,before)
  await assert.rejects(refreshSapSnapshot(data,{previousRun:pointer.run,fetcher:async()=>Response.json(null)}),/pointer_missing/)
})

test('missing material does not produce a fallback link, and shared SAP lines never authorize quantity totals',()=>{
  const missing=unlinked();missing.importFields.material='';apply(missing,[sapRow('00010',{MATNR:''})])
  assert.equal(missing.sapReferenceStatus,'unmatched');assert.equal(missing.sapReferenceReason,'material_missing')
  const data={orders:[{...unlinked(),quantityComparable:true,unit:'EA'},{...unlinked(),id:'second',quantityComparable:true,unit:'EA'}]}
  applySapSnapshotReferences(data,[sapRow()],1789104255050)
  assert.deepEqual(data.orders.map(o=>o.sapSharedLineCount),[2,2]);assert.ok(data.orders.every(o=>!o.quantityComparable))
  assert.ok(detectChecks(data.orders,[]).every(c=>c.kind==='shared_reference'))
})

test('SAP quantity and unit changes remain discrepancies and original comparability recovers after correction',()=>{
  const o={...order(),cancelled:false,qty:5,part:'MAT1',quantityComparable:true,unit:'EA',importFields:{po:'4900000001',line:10,material:'MAT1',qty:5}}
  apply(o,[sapRow('00010',{MENGE:6})]);assert.equal(o.quantityComparable,false)
  assert.ok(detectChecks([o],[]).some(c=>c.kind==='quantity'))
  apply(o,[sapRow()]);assert.equal(o.quantityComparable,true)
  assert.ok(!detectChecks([o],[]).some(c=>c.kind==='quantity'))
  apply(o,[sapRow('00010',{MEINS:'M'})]);assert.equal(o.quantityComparable,false)
  assert.ok(detectChecks([o],[]).some(c=>c.kind==='unit'))
  assert.equal(factsFor(o,[]).find(f=>f.field.en==='Unit').sap,'M')
})

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
