import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceOrders, workspaceShipments, reconcile } from '../src/reconciliation.mjs'
import { projectState, hydrateState, copy, deleteDispatch, restoreDispatch, changeSummary, revisionKey } from '../src/persistence.mjs'
import { buildSnapshot } from '../scripts/sap-snapshot.mjs'
const seed=()=>({orders:workspaceOrders(),shipments:workspaceShipments(),issues:[],checks:[]})
test('source refresh retains cleared ETA, delay and references but owns SAP quantities and PGI',()=>{
  const source=seed(),state=seed();state.orders[0].promisedEtd='2026-10-01';state.orders[0].pending=null;state.orders[0].comments=[]
  Object.assign(state.shipments[0],{eta:'',containerNo:'NEW-CONTAINER',courierNo:'EXP-1',delayStatus:'delayed',sapDelivery:'FAKE-OVERRIDE'})
  const stored=JSON.parse(JSON.stringify(projectState(state)))
  source.orders[0].qty=999;source.orders[0].so='UPDATED-SAP-SO';source.shipments[0].sapDelivery='NEW-SAP';source.shipments[0].allocations[0].receivedQty=12
  const loaded=hydrateState(source,stored)
  assert.equal(loaded.orders[0].qty,999);assert.equal(loaded.orders[0].so,'UPDATED-SAP-SO');assert.equal(loaded.orders[0].promisedEtd,'2026-10-01');assert.equal(loaded.orders[0].pending,null);assert.deepEqual(loaded.orders[0].comments,[])
  assert.equal(loaded.shipments[0].eta,'');assert.equal(loaded.shipments[0].sapDelivery,'NEW-SAP');assert.equal(loaded.shipments[0].containerNo,'NEW-CONTAINER');assert.equal(loaded.shipments[0].allocations[0].receivedQty,12)
})
test('deletion reverses allocation exactly once, preserves history and restores',()=>{
  const state=seed(),before=copy(state),id='SHP-DEMO-003'
  deleteDispatch(state,id,'Duplicate dispatch registration','2026-09-10T01:00:00Z')
  assert.equal(state.orders[0].reported,before.orders[0].reported-48);assert.equal(state.orders[1].reported,before.orders[1].reported-30)
  assert.throws(()=>deleteDispatch(state,id,'again','now'),/shipment_missing/)
  const loaded=hydrateState(before,JSON.parse(JSON.stringify(projectState(state))))
  assert.ok(loaded.shipments.find(s=>s.id===id).deletedAt)
  assert.ok(changeSummary(projectState(before),projectState(state)).some(c=>c.id===id&&c.action==='delete'))
  restoreDispatch(state,id);assert.equal(state.orders[0].reported,before.orders[0].reported);assert.equal(state.shipments.find(s=>s.id===id).deletedAt,undefined)
})
test('posted shipments cannot be deleted; failed restoration cannot overallocate',()=>{
  const state=seed();assert.throws(()=>deleteDispatch(state,state.shipments[0].id,'x','now'),/posted_shipment/)
  deleteDispatch(state,'SHP-DEMO-003','x','now');state.orders[1].reported=state.orders[1].qty
  const before=copy(state);assert.throws(()=>restoreDispatch(state,'SHP-DEMO-003'),/quantity_invalid/);assert.deepEqual(state,before)
})
test('projection rejects duplicate and Firebase-invalid record IDs',()=>{
  const state=seed();state.orders[0].id='not/a/key';assert.throws(()=>projectState(state),/invalid_records/)
  assert.equal(revisionKey(12),'r12');assert.throws(()=>revisionKey(1.5))
})
test('initial RTDB source with omitted empty arrays still supports comments and commitments',()=>{
  const source=seed();delete source.orders[0].comments;delete source.orders[0].batches
  const loaded=hydrateState(source);loaded.orders[0].comments.unshift({text:'A note'})
  assert.equal(loaded.orders[0].comments.length,1);assert.deepEqual(loaded.orders[0].batches,[])
})
test('snapshot validates all tables, stable keys and complete extraction',()=>{
  const data={schemaVersion:1,startedAt:1,finishedAt:2,scope:{company:'3110'},tables:{po:[{EBELN:'0001',EBELP:'00010'}],so:[],deliveries:[],schedules:[],history:[]}}
  const a=buildSnapshot(data);assert.equal(a.counts.po,1)
  assert.equal(a.hash,buildSnapshot({...data,finishedAt:3}).hash)
  assert.throws(()=>buildSnapshot({...data,tables:{...data.tables,history:undefined}}),/Missing/)
  assert.throws(()=>buildSnapshot({...data,tables:{...data.tables,po:[...data.tables.po,...data.tables.po]}}),/duplicate/)
  assert.throws(()=>buildSnapshot({...data,tables:{...data.tables,po:[]}}),/Empty PO/)
})
