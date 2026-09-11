import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceOrders,workspaceShipments,reconcile,detectChecks,resolveFact,updateCase,recordDispatch,applyDemoSnapshot,businessSummary,mappingReady,priceReady,reportedQty,groupedQuantity,remainingQty,updateShipment,delayDays,shipmentDelayed,factsFor } from '../src/reconciliation.mjs'
const fixture=()=>({orders:workspaceOrders(),shipments:workspaceShipments()})

test('missing SAP material is not substituted with a workbook material in comparison facts',()=>{
  const order={...workspaceOrders()[0],sapPart:'',part:'WORKBOOK-ONLY',soPart:''}
  const material=factsFor(order,[])[0]
  assert.equal(material.sap,'—');assert.equal(material.business,'')
})
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

const logisticsForm=s=>({mode:s.mode,stage:s.stage,eta:s.eta||'',containerNo:s.containerNo||'',waybillNo:s.waybillNo||'',courierNo:s.courierNo||'',carrier:'Demo carrier',location:'Demo location',chassis:s.chassis,position:'Parts compartment',delayStatus:'normal',delayReason:'',nextAction:'Contact carrier',note:'Checked carrier update'})
test('logistics edits preserve SAP facts, first ETA and distinct tracking fields with audit history',()=>{
  const {orders,shipments}=fixture(),s=shipments[0],before=JSON.stringify(orders)
  const sap=[s.sapPosted,s.sapDelivery,s.pgiAt,s.sapRef,JSON.stringify(s.allocations)]
  updateShipment(s,{...logisticsForm(s),containerNo:'DEMO-NEW-BOX',waybillNo:'DEMO-BL',courierNo:'DEMO-PARCEL',eta:'2026-09-22',delayStatus:'delayed',delayReason:'Transshipment delay'})
  assert.equal(s.originalEta,'2026-09-17');assert.equal(delayDays(s),5);assert.equal(s.containerNo,'DEMO-NEW-BOX');assert.equal(s.waybillNo,'DEMO-BL');assert.equal(s.courierNo,'DEMO-PARCEL')
  assert.deepEqual([s.sapPosted,s.sapDelivery,s.pgiAt,s.sapRef,JSON.stringify(s.allocations)],sap)
  assert.equal(JSON.stringify(orders),before);assert.equal(s.updates[0].before.eta,'2026-09-18');assert.equal(s.updates[0].after.eta,'2026-09-22')
  updateShipment(s,{...logisticsForm(s),delayStatus:'normal',delayReason:'Still later than baseline'})
  assert.ok(shipmentDelayed(s),'On-track selection does not erase actual ETA variance')
  assert.equal(s.updates.length,2)
})
test('manual delay without ETA creates linked tasks, and later SAP sync preserves collaboration',()=>{
  const {orders,shipments}=fixture(),s=shipments[2]
  updateShipment(s,{...logisticsForm(s),eta:'',delayStatus:'delayed',delayReason:'Awaiting vessel confirmation',courierNo:'DEMO-LOCAL'})
  assert.equal(delayDays(s),null)
  const cases=detectChecks(orders,shipments).filter(c=>c.kind==='logistics'&&[orders[0].id,orders[1].id].includes(c.order));assert.equal(cases.length,2)
  applyDemoSnapshot(orders,shipments);assert.equal(s.courierNo,'DEMO-LOCAL');assert.equal(s.delayReason,'Awaiting vessel confirmation');assert.equal(s.eta,'')
  updateShipment(s,{...logisticsForm(s),eta:'2026-09-20',delayStatus:'normal'})
  assert.equal(s.originalEta,'2026-09-20');assert.equal(delayDays(s),0)
  assert.equal(detectChecks(orders,shipments).filter(c=>c.kind==='logistics'&&cases.some(old=>old.id===c.id)).length,0)
})
test('invalid logistics updates fail before touching the batch',()=>{
  const s=workspaceShipments()[0],before=JSON.stringify(s)
  for(const edit of [{eta:'2026-02-30'},{eta:'2026-09-24',delayReason:''},{delayStatus:'delayed',delayReason:''},{note:''},{stage:99}]){
    assert.throws(()=>updateShipment(s,{...logisticsForm(s),...edit}));assert.equal(JSON.stringify(s),before)
  }
})
test('new courier batches retain carrier and separate tracking references',()=>{
  const {orders,shipments}=fixture()
  const id=recordDispatch(orders,shipments,{date:'2026-09-08',mode:'快递',courierNo:'DEMO-COURIER-1',carrier:'Demo Express',containerNo:'',waybillNo:'DEMO-WAYBILL',eta:'',chassis:'',position:'',allocations:[{order:orders[0].id,qty:2}]})
  const s=shipments.find(s=>s.id===id);assert.equal(s.ref,'DEMO-COURIER-1');assert.equal(s.carrier,'Demo Express');assert.equal(s.waybillNo,'DEMO-WAYBILL');assert.equal(s.sapPosted,false)
})
