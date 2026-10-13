import test from 'node:test'
import assert from 'node:assert/strict'
import {detectChecks,reconcile,resolveFact,workspaceOrders,materialReady,unitReady} from '../src/reconciliation.mjs'
import {exceptionExportRows} from '../src/exception-export.mjs'
import {projectState,hydrateState} from '../src/persistence.mjs'

const order=()=>({id:'separate',imported:true,cancelled:true,qty:0,sapPo:'4900000001',sapItem:'00010',
  sapReferenceStatus:'matched',sapPart:'MAT',part:'MAT',soPart:'MAT',sapUnit:'EA',unit:'EA',soUnit:'EA',
  importFields:{po:'4900000001',line:10,material:'MAT'}})
const checks=o=>detectChecks([o],[]).filter(c=>['material','unit'].includes(c.kind))

test('material and unit issues each occupy one item, with independent corrections and exports',()=>{
  const o=order();o.importFields.material=o.soPart='OTHER';o.soUnit='?'
  const both=checks(o)
  assert.deepEqual(both.map(c=>c.kind),['material','unit'])
  assert.equal(new Set(both.map(c=>c.id)).size,2)
  assert.ok(!both[0].detail.includes('EA'),'material evidence contains no unit comparison')
  assert.equal(both[1].title.zh,'单位待确认')
  const rows=exceptionExportRows(both,[o])
  assert.equal(rows.length,3)
  assert.deepEqual(rows.slice(1).map(r=>r[1]),['物料号待确认','单位待确认'])
  both[0].note='Material follow-up';both[1].note='Unit follow-up'
  o.importFields.material=o.soPart='MAT'
  let next=reconcile([o],[],both)
  assert.equal(next.find(c=>c.kind==='material').status,'已解决')
  assert.equal(next.find(c=>c.kind==='unit').status,'待处理')
  assert.equal(next.find(c=>c.kind==='material').note,'Material follow-up')
  o.soUnit='EA';o.importFields.material=o.soPart='OTHER'
  next=reconcile([o],[],next)
  assert.equal(next.find(c=>c.kind==='unit').status,'已解决')
  assert.equal(next.find(c=>c.kind==='unit').note,'Unit follow-up')
  assert.equal(next.find(c=>c.kind==='material').status,'待处理')
})

test('unknown and changed units never generate a material issue or multiple unit items',()=>{
  for(const patch of [{soUnit:'?'},{unit:'?',soUnit:'?'},{sapUnit:'ST',unit:'EA',soUnit:'M'},{sapUnit:''}]){
    const o={...order(),...patch}
    assert.deepEqual(checks(o).map(c=>c.kind),['unit'])
  }
  assert.deepEqual(checks(order()),[])
})

test('unit approval and material approval are separate and survive persistence',()=>{
  for(const first of ['material','unit']){
    const o=workspaceOrders().at(-1),state={orders:[o],shipments:[],issues:[],checks:[]}
    resolveFact(o,first,{factor:2},'First confirmation')
    assert.equal(materialReady(o),first==='material')
    assert.equal(unitReady(o),first==='unit')
    const restored=hydrateState({orders:workspaceOrders().slice(-1),shipments:[],issues:[]},projectState(state)).orders[0]
    assert.equal(materialReady(restored),first==='material');assert.equal(unitReady(restored),first==='unit')
    resolveFact(restored,first==='material'?'unit':'material',{factor:2},'Second confirmation')
    assert.equal(materialReady(restored),true);assert.equal(unitReady(restored),true)
    assert.equal(restored.mapping.factor,2)
    assert.ok(restored.mapping.materialNote);assert.ok(restored.mapping.unitNote)
  }
  const imported=order()
  for(const kind of ['unit','material'])assert.throws(()=>resolveFact(imported,kind,{factor:1},'Cannot bypass source'),/source_required/)
})
