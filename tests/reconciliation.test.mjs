import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceOrders,workspaceShipments,reconcile,detectChecks,resolveFact,updateCase,recordDispatch,applyDemoSnapshot,businessSummary,mappingReady,priceReady,reportedQty,groupedQuantity,remainingQty } from '../src/reconciliation.mjs'
const fixture=()=>({orders:workspaceOrders(),shipments:workspaceShipments()})
test('checks distinguish facts from timing and deduplicate repeat runs',()=>{
  const {orders,shipments}=fixture();let cases=reconcile(orders,shipments)
  assert.equal(cases.filter(c=>c.kind==='shipment').length,2)
  assert.equal(cases.filter(c=>c.kind==='material').length,1)
  assert.equal(cases.filter(c=>c.kind==='price').length,1)
  assert.equal(cases.filter(c=>c.kind==='reference').length,1)
  assert.deepEqual(reconcile(orders,shipments,cases),cases)
  assert.ok(new Set(cases.map(c=>c.order)).size<cases.length)
})
test('mapping approval is scoped to the exact code and unit pair, without rewriting SAP',()=>{
  const {orders,shipments}=fixture(),o=orders.at(-1),original=o.sapPart
  resolveFact(o,'material',{factor:1},'Confirmed scoped mapping')
  assert.ok(mappingReady(o));assert.equal(o.sapPart,original)
  assert.ok(!detectChecks(orders,shipments).some(c=>c.order===o.id&&c.kind==='material'))
  o.soPart='CHANGED-CODE';assert.ok(!mappingReady(o))
  assert.throws(()=>resolveFact(o,'material',{factor:0},'Invalid conversion'))
})
test('confirmed conversion is checked against SO quantity, not silently treated as equal',()=>{
  const {orders,shipments}=fixture(),o=orders.at(-1)
  resolveFact(o,'material',{factor:2},'Confirmed 2 metres per factory unit')
  assert.ok(detectChecks(orders,shipments).some(c=>c.order===o.id&&c.kind==='quantity'))
  o.soQty=100;assert.ok(!detectChecks(orders,shipments).some(c=>c.order===o.id&&c.kind==='quantity'))
})
test('notes and reassignment do not close discrepancies; resolved facts preserve case history',()=>{
  const {orders,shipments}=fixture();let cases=reconcile(orders,shipments),c=cases.find(c=>c.kind==='material')
  updateCase(cases,c.id,{owner:'New owner',due:'2026-09-10',note:'Investigating mapping'})
  cases=reconcile(orders,shipments,cases);assert.equal(cases.find(x=>x.id===c.id).status,'处理中')
  resolveFact(orders.find(o=>o.id===c.order),'material',{factor:1},'Confirmed by buyer')
  cases=reconcile(orders,shipments,cases);const closed=cases.find(x=>x.id===c.id)
  assert.equal(closed.status,'已解决');assert.equal(closed.owner,'New owner');assert.equal(closed.log.length,1)
  orders.find(o=>o.id===c.order).soPart='NEW';assert.equal(reconcile(orders,shipments,cases).find(x=>x.id===c.id).status,'待处理')
})
test('later SAP snapshot matches only its predefined shipment and never overwrites reports',()=>{
  const {orders,shipments}=fixture();let cases=reconcile(orders,shipments)
  assert.equal(applyDemoSnapshot(orders,shipments),true);assert.equal(orders[0].shipped,48);assert.equal(orders[0].reported,48)
  assert.equal(applyDemoSnapshot(orders,shipments),false);assert.equal(orders[0].shipped,48)
  cases=reconcile(orders,shipments,cases);assert.ok(cases.filter(c=>c.kind==='shipment').every(c=>c.status==='已解决'))
  assert.equal(businessSummary(orders,shipments).transit.length,2,'PGI without verified logistics is not transit')
})
test('multi-line dispatch supports split batches without changing SAP quantities',()=>{
  const {orders,shipments}=fixture();const id=recordDispatch(orders,shipments,{date:'2026-09-08',mode:'海运',ref:'DEMO-NEW',eta:'',chassis:'DEMO',position:'Parts',allocations:[{order:orders[0].id,qty:10},{order:orders[1].id,qty:5}]})
  assert.equal(shipments.find(s=>s.id===id).allocations.length,2);assert.equal(orders[0].reported,58);assert.equal(orders[0].shipped,0)
  applyDemoSnapshot(orders,shipments);assert.equal(orders[0].shipped,48);assert.equal(orders[0].reported,58)
  assert.ok(detectChecks(orders,shipments).some(c=>c.order===orders[0].id&&c.kind==='shipment'))
  assert.equal(businessSummary(orders,shipments).pendingBatches.length,1)
})
test('invalid or duplicate allocations fail atomically, before any order mutation',()=>{
  const {orders,shipments}=fixture(),before=JSON.stringify({orders,shipments}),base={date:'2026-09-08',mode:'海运',ref:'DEMO',chassis:'',position:''}
  for(const allocations of [[{order:orders[0].id,qty:73}],[{order:orders[0].id,qty:2},{order:orders[0].id,qty:3}],[{order:orders[0].id,qty:1},{order:orders[5].id,qty:1}],[{order:orders[0].id,qty:1.5}]]){
    assert.throws(()=>recordDispatch(orders,shipments,{...base,allocations}));assert.equal(JSON.stringify({orders,shipments}),before)
  }
})
test('unit groups and price coverage avoid misleading quantity and value totals',()=>{
  const {orders,shipments}=fixture();const d=businessSummary(orders,shipments)
  assert.equal(d.unpriced.length,1);assert.equal(d.known.length,9)
  assert.equal(d.remaining.M,200);assert.ok(d.remaining.EA>0)
  assert.equal(d.transitValue,30600)
  const o=orders[6],old=d.openValue;resolveFact(o,'price',{},'Confirmed formal price')
  assert.equal(businessSummary(orders,shipments).openValue,old+36)
  o.unitPrice=99;assert.equal(priceReady(o),false,'A changed price must be confirmed again')
  o.currency='CNY';assert.throws(()=>resolveFact(o,'price',{},'Not an AUD price'))
})
test('transit caps allocations at outstanding SAP quantity and respects supplier scope',()=>{
  const {orders,shipments}=fixture(),o=orders[3];o.received=30
  shipments.push({...shipments[0],id:'DUPLICATE',allocations:[{order:o.id,qty:120,receivedQty:0}]})
  const d=businessSummary([o],shipments);assert.equal(d.transitRows.reduce((n,r)=>n+r.qty,0),90);assert.equal(d.transit.length,1)
  const empty=businessSummary([],shipments);assert.equal(empty.transitValue,0);assert.equal(empty.batches.length,0)
})
test('receipts, dispatch and commitments do not erase each other',()=>{
  const {orders,shipments}=fixture(),o=orders[0],eta=o.eta
  resolveFact(o,'delivery',{date:'2026-09-12'},'Revised dispatch date')
  assert.equal(o.eta,eta);assert.equal(o.initialEtd,'2026-09-06');assert.equal(reportedQty(o),48)
  assert.equal(remainingQty(o),72);assert.equal(groupedQuantity([o],x=>x.received).EA,undefined)
  assert.throws(()=>resolveFact(o,'delivery',{date:'2026-09-07'},'Past commitment'))
  assert.throws(()=>resolveFact(o,'shipment',{},'Notes cannot clear SAP gap'))
  assert.ok(detectChecks(orders,shipments).some(c=>c.order===o.id&&c.kind==='shipment'))
})
