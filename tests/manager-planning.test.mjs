import test from 'node:test'
import assert from 'node:assert/strict'
import { managerOverview, freightOverview } from '../src/manager-overview.mjs'

const order=(id,more={})=>({id,po:id,qty:100,reported:100,shipped:100,received:0,created:'2026-09-01',
  promisedEtd:'2026-12-30',type:'生产订单',mode:'海运',unit:'EA',currency:'AUD',unitPrice:200,priceUnit:10,priceConfirmed:true,...more})
const batch=(o,id,date,mode='空运',freight=100,more={})=>({id,order:o.id,qty:10,receivedQty:0,sapPosted:true,stage:2,
  pgiAt:date,eta:'2026-12-22',mode,freight,freightCurrency:'AUD',...more})

test('four arrival weeks span year-end without overlap or mixed-unit quantity sums',()=>{
  const a=order('a'),b=order('b',{unit:'M'})
  const dates=['2026-12-20','2026-12-26','2026-12-27','2027-01-03','2027-01-10','2027-01-16','2027-01-17','2026-12-19','']
  const batches=dates.map((eta,i)=>batch(i%2?a:b,'s'+i,'2026-12-18',i%2?'空运':'海运',100,{eta}))
  const d=managerOverview([a,b],batches,'2026-12-20')
  assert.deepEqual(d.arrivalWeeks.map(w=>w.count),[2,1,1,2])
  assert.equal(d.arrivalWeeks.at(-1).end,'2027-01-16')
  assert.equal(d.missingEta.length,1)
  for(const w of d.arrivalWeeks) assert.equal(w.modes.reduce((n,m)=>n+m.count,0),w.count)
  assert.deepEqual(managerOverview([a],batches,'2026-12-20').arrivalWeeks.map(w=>w.count),[1,0,1,1])
})

test('unavailable arrival evidence and costs stay null, not zero',()=>{
  const a=order('a',{imported:true,sourceRemaining:100})
  const d=managerOverview([a],[batch(a,'aggregate','2026-09-10','空运',100,{aggregate:true})],'2026-10-01')
  assert.deepEqual(d.arrivalWeeks.map(w=>w.count),[null,null,null,null])
  assert.equal(d.freight.ytd.airFreight,null)
  assert.ok(d.freight.months.every(m=>m.airFreight===null))
  assert.equal(d.freight.monthChange,null)
})

test('costs use dated actual records, price units and last complete months for changes',()=>{
  const a=order('a',{received:100})
  const batches=[batch(a,'jul','2026-07-01'),batch(a,'aug-air','2026-08-01','空运',200),
    batch(a,'aug-sea','2026-08-01','海运',200),batch(a,'sep-air','2026-09-01','空运',300),
    batch(a,'sep-sea','2026-09-01','海运',100),batch(a,'oct-air','2026-10-01','空运',400),
    batch(a,'future','2026-10-20','空运',9999),batch(a,'old','2025-12-30','空运',9999),
    batch(a,'deleted','2026-09-01','空运',9999,{deletedAt:'2026-09-02'}),
    batch(a,'aggregate','2026-09-01','空运',9999,{aggregate:true})]
  const f=freightOverview([a],batches,'2026-10-15')
  assert.equal(f.ytd.airFreight,1000)
  assert.equal(f.ytd.airValue,800)
  assert.equal(f.ytd.freightToValue,125)
  assert.equal(f.ytd.totalFreight,1300)
  assert.deepEqual(f.months.map(m=>m.month),['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'])
  assert.equal(f.months.at(-1).airShare,75)
  assert.equal(f.monthChange,50)
  assert.equal(f.shareChange,25)
})

test('unknown freight currency, missing dates and unallocated shared-batch costs block totals',()=>{
  const a=order('a'),b=order('b',{unit:'M'})
  for(const more of [{freightCurrency:undefined},{freightCurrency:'USD'},{freight:-1},{pgiAt:'bad-date'},
    {allocations:[{order:'a',qty:10},{order:'b',qty:50}]}]){
    const f=freightOverview([a],[batch(a,'s','2026-09-01','空运',100,more)],'2026-10-01')
    assert.equal(f.ytd.airFreight,null)
    assert.equal(f.months.at(-1).airFreight,null)
    assert.equal(f.monthChange,null)
  }
  assert.equal(freightOverview([a,b],[batch(a,'s','2026-09-01','空运',100,{allocations:[{order:'a',qty:10},{order:'b',qty:50}]})],'2026-10-01').ytd.airFreight,100)
})

test('unconfirmed goods values do not produce a misleading freight-to-value ratio',()=>{
  const a=order('a',{priceConfirmed:false})
  const f=freightOverview([a],[batch(a,'s','2026-09-01')],'2026-10-01')
  assert.equal(f.ytd.airFreight,100)
  assert.equal(f.ytd.airValue,null)
  assert.equal(f.ytd.freightToValue,null)
})

test('zero comparison months have no percentage change and dates cross January correctly',()=>{
  const a=order('a')
  const f=freightOverview([a],[batch(a,'nov','2026-11-01','海运',100),batch(a,'dec','2026-12-01','空运',100)],'2027-01-03')
  assert.equal(f.months.at(-1).month,'2026-12')
  assert.equal(f.months.at(-2).airFreight,0)
  assert.equal(f.monthChange,null)
  assert.equal(f.shareChange,100)
  assert.equal(f.ytd.airFreight,null)
})

test('arrival drill-down excludes fully received lines within a shared batch',()=>{
  const a=order('a',{received:100}),b=order('b')
  const d=managerOverview([a,b],[batch(b,'shared','2026-12-18','海运',100,
    {allocations:[{order:'a',qty:10,receivedQty:0},{order:'b',qty:10,receivedQty:0}]})],'2026-12-20')
  assert.equal(d.arrivalWeeks[0].count,1)
  assert.deepEqual(d.arrivalWeeks[0].rows.map(o=>o.id),['b'])
})
