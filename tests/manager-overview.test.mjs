import test from 'node:test'
import assert from 'node:assert/strict'
import { managerOverview } from '../src/manager-overview.mjs'

const today='2026-10-01'
const order=(id,overrides={})=>({id,po:'PO-'+id,supplier:'Supplier A',qty:10,reported:0,shipped:0,received:0,
  unit:'EA',type:'生产订单',mode:'海运',created:'2026-09-01',promisedEtd:'2026-10-05',
  eta:'',required:'',dispatchDelayStatus:'unknown',...overrides})
const shipment=(o,overrides={})=>({id:'S-'+o.id,order:o.id,qty:10,receivedQty:0,sapPosted:true,stage:2,
  eta:'2026-10-03',originalEta:'2026-10-03',...overrides})

test('headline totals include history, deduplicate POs, and distinguish reports from receipt evidence',()=>{
  const rows=[order('open'),order('partial',{po:'PO-open',reported:3}),
    order('received',{reported:10,shipped:10,received:10}),
    order('unknown',{imported:true,sourceRemaining:0,reported:10,received:null,receiptsKnown:false}),
    order('cancelled',{cancelled:true,reported:10,received:10})]
  const {totals}=managerOverview(rows,[],today)
  assert.equal(totals.rows.length,5)
  assert.equal(totals.poCount,4)
  assert.equal(totals.cancelled.length,1)
  assert.deepEqual(totals.dispatched.map(o=>o.id),['partial','received','unknown'])
  assert.deepEqual(totals.received.map(o=>o.id),['received'])
  assert.deepEqual(totals.receiptUnknown.map(o=>o.id),['unknown'])
  assert.equal(managerOverview([rows[1]],[],today).totals.rows.length,1)
})

test('dispatch verification counts only active reported rows with unresolved PGI evidence',()=>{
  const rows=[order('missing',{reported:5,shipped:null}),order('short',{reported:5,shipped:3}),
    order('batch',{reported:10,shipped:10}),order('verified',{reported:10,shipped:10}),
    order('none'),order('cancelled',{cancelled:true,reported:10,shipped:null})]
  const batches=[shipment(rows[2],{sapPosted:false}),shipment(rows[3],{sapPosted:false,deletedAt:today})]
  assert.deepEqual(managerOverview(rows,batches,today).unverifiedDispatch.map(o=>o.id),['missing','short','batch'])
  assert.equal(managerOverview([rows[3]],batches,today).unverifiedDispatch.length,0)
})

test('missing commitments are tracked separately from date-backed and recorded delays',()=>{
  const rows=[order('missing',{promisedEtd:''}),order('past',{promisedEtd:'2026-09-30'}),
    order('manual',{promisedEtd:'',dispatchDelayStatus:'delayed'}),order('normal'),
    order('arrival',{eta:'2026-10-09',required:'2026-10-07'}),
    order('invalid',{promisedEtd:'2026-02-30',eta:'not-a-date'})]
  const d=managerOverview(rows,[],today)
  assert.deepEqual(d.delayed.map(o=>o.id),['past','manual','arrival'])
  assert.deepEqual(d.noDate.map(o=>o.id),['missing','manual','invalid'])
  const invalidBatch = order('invalid-batch')
  assert.equal(managerOverview([invalidBatch],[shipment(invalidBatch,{eta:'2026-02-30',originalEta:'2026-02-01'})],today).delayed.length,0)
})

test('cancelled, received, deleted and aggregate records cannot inflate delay or transit counts',()=>{
  const active=order('active',{reported:10,shipped:10})
  const cancelled=order('cancelled',{cancelled:true,promisedEtd:'2026-09-01'})
  const received=order('received',{received:10,promisedEtd:'2026-09-01'})
  const d=managerOverview([active,cancelled,received],[
    shipment(active,{id:'deleted',deletedAt:today,delayStatus:'delayed'}),
    shipment(active,{id:'aggregate',aggregate:true,delayStatus:'delayed'}),
    shipment(cancelled),shipment(received),
  ],today)
  assert.equal(d.open.length,1)
  assert.equal(d.delayed.length,0)
  assert.equal(d.verified.length,0)
})

test('arrival horizon includes today through day six and only verified scoped batches',()=>{
  const rows=['today','six','seven','missing','unposted'].map(id=>order(id,{reported:10,shipped:10}))
  const dates=[today,'2026-10-07','2026-10-08','',today]
  const batches=rows.map((o,i)=>shipment(o,{eta:dates[i],sapPosted:i!==4}))
  const d=managerOverview(rows,batches,today)
  assert.deepEqual(d.upcomingOrders.map(o=>o.id),['today','six'])
  assert.equal(d.missingEta.length,1)
  assert.equal(d.verified.length,4)
  const scoped=managerOverview([rows[1]],batches,today)
  assert.equal(scoped.verified.length,1)
  assert.deepEqual(scoped.upcomingOrders.map(o=>o.id),['six'])
})

test('unverified imported data and all-missing ETAs remain unavailable rather than zero',()=>{
  const o=order('imported',{imported:true,sourceRemaining:10})
  const d=managerOverview([o],[shipment(o,{aggregate:true})],today)
  assert.equal(d.transitKnown,false)
  assert.equal(d.arrivalsKnown,false)
  const verified=managerOverview([{...o,shipped:10}],[shipment(o,{eta:''})],today)
  assert.equal(verified.transitKnown,true)
  assert.equal(verified.arrivalsKnown,false)
})

test('long-open counts use creation age, preserve unknown dates and reconcile transport categories',()=>{
  const d=managerOverview([order('60',{created:'2026-08-02',mode:'海运'}),
    order('61',{created:'2026-08-01',unit:'M',mode:'空运'}),
    order('unknown',{created:'',mode:'—'}),order('future',{created:'2026-10-02',mode:'快递'})],[],today)
  assert.deepEqual(d.aged.map(o=>o.id),['61'])
  assert.deepEqual(d.ageingUnknown.map(o=>o.id),['unknown','future'])
  assert.equal(d.modes.reduce((n,m)=>n+m.rows.length,0),d.open.length)
  assert.equal(d.modes.find(m=>m.mode==='未分类').rows.length,1)
})
