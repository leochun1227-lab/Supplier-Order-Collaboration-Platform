import test from 'node:test'
import assert from 'node:assert/strict'
import { excelWorkspace } from '../scripts/excel-workspace.mjs'
import { openQty } from '../src/domain.mjs'
import { hydrateState,projectState } from '../src/persistence.mjs'
const batch={contentHash:'test',batchId:'excel-test',summary:{},reviewTasks:{},sourceRows:{r:{source:{file:'test.xlsx',sheet:'Sheet1',row:4},fields:{}}},records:{}}
function record(id,completion,qty,reported,left){return {id,fields:{po:4900000001,qty,shipped:reported,remaining:left,completion,eta_china:'2026-09-05',actual_ship:'2026-09-04',material:'PART',mode:'海运'},poCandidates:['4900000001'],line:'00010',soCandidates:[],evidence:['r'],review:[]}}
test('Excel completion is not treated as SAP receipt or AU ETA',()=>{
  const source=excelWorkspace({...batch,records:{a:record('a','OK',20,20,0),b:record('b','NG',50,48,2),c:record('c','澳洲取消订单',12,0,12)}})
  assert.deepEqual(source.data.orders.map(openQty),[0,2,0]);assert.equal(source.data.shipments.length,2)
  assert.ok(source.data.orders.every(o=>o.received===null&&o.shipped===null&&o.eta===''))
  const loaded=hydrateState(source.data,projectState({...source.data,checks:[]}))
  assert.equal(loaded.shipments[0].allocations[0].receivedQty,null)
  loaded.orders[1].reported=49;assert.equal(openQty(loaded.orders[1]),1)
})

test('confirmed owner mapping classifies purpose without replacing source category or existing decisions',async()=>{
  const {classifyOrders}=await import('../scripts/order-purpose.mjs')
  const rows=[
    {id:'a',buyer:'Karen Andrews',type:'用途待确认',sourceType:'buy'},
    {id:'b',buyer:'Nishi Arachchige',type:'用途待确认',sourceType:'make'},
    {id:'c',buyer:'Owen Liu',type:'用途待确认'},
    {id:'d',buyer:'Karen Other',type:'用途待确认'},
    {id:'e',buyer:'Nishi A.',type:'生产订单'},
  ]
  assert.equal(classifyOrders(rows).length,2)
  assert.deepEqual(rows.map(o=>o.type),['生产订单','售后配件','用途待确认','用途待确认','生产订单'])
  assert.equal(rows[0].sourceType,'buy');assert.equal(rows[1].sourceType,'make')
  assert.equal(classifyOrders(rows).length,0)
  const r=record('owner','NG',10,0,10);r.fields.buyer='Karen Andrews'
  assert.equal(excelWorkspace({...batch,records:{owner:r}}).data.orders[0].type,'生产订单')
})
