import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {cloneBook,setCell,insertRow,deleteRows,insertColumn,deleteColumn} from '../src/parts-workbook.mjs'
import {sharedWorkbookState,retainHiddenWorkbookRecords} from '../src/parts-workbook-link.mjs'
import {projectState} from '../src/persistence.mjs'
import {openQty} from '../src/domain.mjs'
import {detectChecks} from '../src/reconciliation.mjs'
import {excelWorkspace} from '../scripts/excel-workspace.mjs'

const seed=JSON.parse(readFileSync(new URL('../public/parts-workbook.json',import.meta.url)))
const fields=['seq','mode','po','line','van','description_zh','description_en','supplier_reference','material','qty','category','so','buyer','ordered','agreed_etd','planned_etd','manager','eta_china','actual_ship','shipped','remaining','loaded_van','location','container','awb','completion','notes']
const rows=seed.sheets[0].rows.slice(3,5)
const sourceRows=Object.fromEntries(rows.map((row,i)=>[`master-${i}`,{source:{file:seed.sourceFile,sheet:'Sheet1',row:i+4},fields:Object.fromEntries(fields.map((f,c)=>[f,row.cells[c]]))}]))
const records=Object.fromEntries(Object.entries(sourceRows).map(([id,row])=>[id,{id,fields:row.fields,evidence:[id],review:[],poCandidates:[String(row.fields.po)],line:'00010',soCandidates:[String(row.fields.so)]}]))
export const fixture=excelWorkspace({contentHash:'workbook-link-test',batchId:'test',summary:{},sourceRows,records}).data
// Only these two source rows are in the test fixture; the summary sheet remains.
export const workbook=cloneBook(seed)
workbook.sheets[0].rows=workbook.sheets[0].rows.slice(0,5)

test('unchanged workbook preserves previously saved collaboration values',()=>{
  const before=sharedWorkbookState(fixture,{},null).state
  before.orders[0].reported=22;before.orders[0].chinaEta='2026-10-15'
  const next=sharedWorkbookState(fixture,projectState(before),workbook).state
  assert.equal(next.orders.length,2);assert.equal(next.orders[0].reported,22);assert.equal(next.orders[0].chinaEta,'2026-10-15')
  assert.equal(next.shipments.length,2)
})
test('material edit follows immutable row identity after insertion; duplicates do not cross-update; SAP preserved',()=>{
  const input=cloneBook(workbook), original=JSON.stringify(fixture)
  insertRow(input.sheets[0],3)
  setCell(input.sheets[0],'s0-r4',8,'NEW-MATERIAL')
  setCell(input.sheets[0],'s0-r4',2,'NEW-PO')
  const {state}=sharedWorkbookState(fixture,{},input)
  assert.equal(state.orders.length,2)
  const order=state.orders.find(o=>o.id==='master-0')
  assert.equal(order.part,'NEW-MATERIAL');assert.equal(order.soPart,'NEW-MATERIAL');assert.equal(order.po,'NEW-PO')
  assert.equal(order.sapPart,fixture.orders[0].sapPart)
  assert.equal(state.orders[1].part,fixture.orders[1].part)
  assert.ok(state.shipments.some(s=>s.order===order.id))
  assert.ok(detectChecks(state.orders,state.shipments).some(c=>c.order===order.id&&c.kind==='material'))
  assert.equal(JSON.stringify(fixture),original)
})
test('quantities, formula results, dates, status and container flow to shared records',()=>{
  const input=cloneBook(workbook),sheet=input.sheets[0]
  setCell(sheet,'s0-r4',9,'30');setCell(sheet,'s0-r4',19,'7');setCell(sheet,'s0-r4',25,'NG')
  setCell(sheet,'s0-r4',17,'2026-10-01');setCell(sheet,'s0-r4',23,'NEW-CONTAINER')
  const {state}=sharedWorkbookState(fixture,{},input)
  assert.equal(state.orders[0].qty,30);assert.equal(state.orders[0].reported,7);assert.equal(openQty(state.orders[0]),23)
  assert.equal(state.orders[0].chinaEta,'2026-10-01');assert.equal(state.orders[0].status,'部分发运')
  assert.equal(state.shipments[0].qty,7);assert.equal(state.shipments[0].allocations[0].qty,7)
  assert.equal(state.shipments[0].containerNo,'NEW-CONTAINER')
})
test('later table edits override only changed fields; later other-page edits persist; undo restores original value',()=>{
  const input=cloneBook(workbook)
  setCell(input.sheets[0],'s0-r4',17,'2026-10-01')
  let current=sharedWorkbookState(fixture,{},input)
  current.state.orders[0].chinaEta='2026-10-02';current.state.orders[0].comments=[{text:'keep note'}]
  const overlay=projectState(current.state),baseline=current.baseline
  let reloaded=sharedWorkbookState(fixture,overlay,input,baseline)
  assert.equal(reloaded.state.orders[0].chinaEta,'2026-10-02')
  setCell(input.sheets[0],'s0-r4',8,'CHANGED-PART')
  reloaded=sharedWorkbookState(fixture,overlay,input,baseline)
  assert.equal(reloaded.state.orders[0].chinaEta,'2026-10-02')
  setCell(input.sheets[0],'s0-r4',17,'2026-10-03')
  reloaded=sharedWorkbookState(fixture,overlay,input,baseline)
  assert.equal(reloaded.state.orders[0].chinaEta,'2026-10-03');assert.equal(reloaded.state.orders[0].comments[0].text,'keep note')
  reloaded=sharedWorkbookState(fixture,overlay,workbook,baseline)
  assert.equal(reloaded.state.orders[0].chinaEta,fixture.orders[0].chinaEta)
})
test('delete hides linked records and counts, preserves archived collaboration, and undo restores it',()=>{
  const before=sharedWorkbookState(fixture,{},workbook).state
  before.orders[0].comments=[{text:'retained history'}]
  before.issues=[{id:'issue',order:'master-0',note:'keep'}]
  const overlay=projectState(before), input=cloneBook(workbook)
  deleteRows(input.sheets[0],['s0-r4'])
  const removed=sharedWorkbookState(fixture,overlay,input)
  assert.equal(removed.state.orders.length,1);assert.equal(removed.state.shipments.length,1);assert.equal(removed.state.issues.length,0)
  const saved=retainHiddenWorkbookRecords(overlay,projectState(removed.state),removed.hidden)
  const restored=sharedWorkbookState(fixture,saved,workbook).state
  assert.equal(restored.orders.length,2);assert.equal(restored.shipments.length,2)
  assert.equal(restored.orders[0].comments[0].text,'retained history');assert.equal(restored.issues[0].note,'keep')
})
test('new rows become shared orders when populated; inserted/deleted columns cannot shift mappings',()=>{
  const input=cloneBook(workbook),sheet=input.sheets[0],id=insertRow(sheet)
  assert.equal(sharedWorkbookState(fixture,{},input).state.orders.length,2)
  setCell(sheet,id,8,'ADDED');setCell(sheet,id,9,'12')
  let current=sharedWorkbookState(fixture,{},input)
  assert.equal(current.state.orders.length,3);assert.equal(openQty(current.state.orders[2]),12)
  const addedId=current.state.orders[2].id
  current.state.orders[2].comments=[{text:'new note'}]
  const overlay=projectState(current.state)
  const restoreBook=cloneBook(input)
  deleteRows(sheet,[id])
  current=sharedWorkbookState(fixture,overlay,input)
  assert.ok(current.hidden.has(addedId));assert.equal(current.state.orders.length,2)
  const saved=retainHiddenWorkbookRecords(overlay,projectState(current.state),current.hidden)
  assert.equal(sharedWorkbookState(fixture,saved,restoreBook).state.orders[2].comments[0].text,'new note')
  insertColumn(sheet,8);setCell(sheet,'s0-r4',9,'SHIFTED-MATERIAL')
  assert.equal(sharedWorkbookState(fixture,{},input).state.orders[0].part,'SHIFTED-MATERIAL')
  deleteColumn(sheet,9)
  assert.equal(sharedWorkbookState(fixture,{},input).state.orders[0].part,'')
})
