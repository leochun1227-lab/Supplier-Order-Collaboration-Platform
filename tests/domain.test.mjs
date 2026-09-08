import test from 'node:test'
import assert from 'node:assert/strict'
import {seedOrders,seedShipments,canSee,openQty,validateCommitment,daysLate} from '../src/domain.mjs'

test('supplier demo scope excludes other supplier records',()=>{
  const all=seedOrders(); assert.equal(all.filter(o=>canSee(o,'supplier')).length,9)
  assert.equal(all.filter(o=>canSee(o,'buyer')).length,11)
})
test('split commitment accepts valid full and partial quantities',()=>{
  const order=seedOrders()[0]
  assert.deepEqual(validateCommitment(order,[{qty:70,date:'2026-09-18'},{qty:50,date:'2026-09-25'}]),{total:120,partial:false,eta:'2026-09-25'})
  assert.equal(validateCommitment(order,[{qty:60,date:'2026-09-18'}]).partial,true)
})
test('invalid quantities or dates cannot enter commitments',()=>{
  const o=seedOrders()[0]
  for(const batches of [[],[{qty:121,date:'2026-09-20'}],[{qty:0,date:'2026-09-20'}],[{qty:1.5,date:'2026-09-20'}],[{qty:2,date:'2026-02-30'}],[{qty:2,date:'2026-09-01'}]])assert.throws(()=>validateCommitment(o,batches))
})
test('sample quantities reconcile with shipment and receipt totals',()=>{
  const orders=seedOrders(); const shipments=seedShipments()
  assert.equal(orders.reduce((n,o)=>n+o.qty,0),1720)
  assert.equal(orders.reduce((n,o)=>n+openQty(o),0),1220)
  assert.equal(orders.reduce((n,o)=>n+o.shipped-o.received,0),420)
  for(const shipment of shipments)assert.equal(orders.find(o=>o.id===shipment.order).shipped,shipment.qty)
  assert.equal(daysLate(orders[2]),8)
})
