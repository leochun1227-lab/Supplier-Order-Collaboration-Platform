import test from 'node:test'
import assert from 'node:assert/strict'
import { seedOrders, seedShipments, canSee } from '../src/domain.mjs'
import { dashboardData } from '../src/analytics.mjs'

test('overview reconciles quantities, categories, age buckets and goods values',()=>{
  const d=dashboardData(seedOrders(),seedShipments())
  assert.equal(d.totalQty,d.receivedQty+d.transitQty+d.unshippedQty)
  assert.equal(d.transitQty,420)
  assert.equal(d.transitValue,30600)
  assert.equal(d.freight,6250)
  assert.equal(d.poCount,9)
  assert.equal(d.open.length,10)
  assert.equal(d.categories.reduce((n,c)=>n+c.value,0),d.openValue)
  assert.equal(d.ageing.reduce((n,c)=>n+c.value,0),d.openValue)
  assert.equal(d.ageing.reduce((n,c)=>n+c.count,0),d.open.length)
  assert.equal(d.transport.reduce((n,t)=>n+t.value,0),d.transitValue)
  assert.equal(d.transport.reduce((n,t)=>n+t.qty,0),d.transitQty)
})

test('dashboard respects supplier and category scope including shipment costs',()=>{
  const orders=seedOrders().filter(o=>canSee(o,'supplier')&&o.type==='售后配件')
  const d=dashboardData(orders,seedShipments())
  assert.deepEqual(d.suppliers.map(s=>s.name),['Longtree'])
  assert.equal(d.categories[0].count,0)
  assert.equal(d.transitQty,300)
  assert.equal(d.transitValue,8400)
  assert.equal(d.freight,3450)
  assert.equal(d.batches.length,1)
  const empty=dashboardData([],seedShipments())
  assert.equal(empty.openValue,0)
  assert.equal(empty.freight,0)
  assert.equal(empty.batches.length,0)
})

test('split shipments and partial receipts never double-count SAP outstanding quantity',()=>{
  const order={...seedOrders()[3],shipped:120,received:30}
  const batch={...seedShipments()[0],qty:70,receivedQty:30}
  const d=dashboardData([order],[batch,{...batch,id:'split',qty:50,receivedQty:0}])
  assert.deepEqual(d.batches.map(s=>s.outstanding),[40,50])
  assert.equal(d.transitQty,90)
  assert.equal(d.transport[0].value,90*185)
  const missing=dashboardData([order],[])
  assert.equal(missing.transport.find(t=>t.mode==='待匹配运输').qty,90)
})

test('ageing boundaries exclude received orders and quantity changes update totals',()=>{
  const base=seedOrders()[0]
  const orders=['2026-09-08','2026-08-24','2026-08-23','2026-08-09','2026-08-08','2026-07-10','2026-07-09','2026-06-10','2026-06-09'].map((created,i)=>({...base,id:String(i),created}))
  assert.deepEqual(dashboardData(orders,[]).ageing.map(a=>a.count),[2,2,2,2,1])
  orders[0].received=orders[0].qty;orders[0].shipped=orders[0].qty
  const d=dashboardData(orders,[])
  assert.equal(d.ageing[0].count,1)
  assert.equal(d.openQty,8*120)
})
