import test from 'node:test'
import assert from 'node:assert/strict'
import { PARTS_FIELDS } from '../src/parts-workbook.mjs'
import { orderDate, sapWorkbookDateScope } from '../src/parts-workbook-scope.mjs'
import { sharedWorkbookState } from '../src/parts-workbook-link.mjs'
import { mergeSapWorkbook, retainSapWorkbookRows } from '../src/sap-workbook-sync.mjs'

const row=(id,ordered,sapOrigin=false)=>({id,sapOrigin,cells:PARTS_FIELDS.map(f=>({po:id,line:'10',material:'MAT',qty:1,ordered,completion:'OK',notes:'Preserve human work'}[f]??null)),formulas:{},types:{},...(sapOrigin?{sapAnchor:{po:id,item:'10'}}:{})})
const book=()=>({sourceFile:'China.xlsx',sheets:[{id:'s0',name:'Sheet1',headerRows:1,merges:[],columns:PARTS_FIELDS.map((_,i)=>({id:`s0-c${i}`})),rows:[{id:'header',cells:PARTS_FIELDS,formulas:{},types:{}},row('china','2025-09-12'),row('old','20250911',true),row('boundary','20250912',true),row('new','20260101',true),row('unknown','',true)]}]})
const source={orders:[],shipments:[],issues:[]}

test('show only strictly later SAP dates; hide boundary and unknown dates while preserving stored cells',()=>{
  const b=book(),before=structuredClone(b),scope=sapWorkbookDateScope(b)
  assert.equal(scope.cutoff,'2025-09-12');assert.deepEqual([...scope.hidden],['old','boundary','unknown'])
  const projected=sharedWorkbookState(source,{},b)
  assert.equal(projected.state.orders.length,2)
  assert.ok(projected.hidden.has('PARTS-old'))
  assert.ok(!projected.state.orders.some(o=>o.po==='old'))
  assert.deepEqual(b,before)
  b.sheets[0].rows[1].cells[13]=''
  assert.equal(sapWorkbookDateScope(b).hidden.size,4)
})

test('normalize SAP dates and reject malformed dates without guessing',()=>{
  assert.equal(orderDate('20250912'),'2025-09-12')
  assert.equal(orderDate('2025-09-12T00:00:00.000Z'),'2025-09-12')
  for(const value of ['20250230','2025-99-12','unknown',null])assert.equal(orderDate(value),'')
})

test('refresh admits only strictly later SAP dates and rechecks changed Excel cutoff',()=>{
  const b=book();b.sheets[0].rows=b.sheets[0].rows.slice(0,2)
  const rows=[['old','20250911'],['boundary','20250912'],['new','20260101'],['unknown','']].map(([EBELN,BEDAT])=>({EBELN,EBELP:'10',BEDAT,MATNR:'MAT',MENGE:1,OPEN_PO_ELIGIBLE:true}))
  const merged=mergeSapWorkbook(b,[],rows,'run1')
  assert.deepEqual(merged.sheets[0].rows.slice(2).map(r=>r.cells[2]),['new'])
  assert.equal(merged.sapDateCutoff,'2025-09-12')
  merged.sheets[0].rows[1].cells[13]='2025-09-01'
  const expanded=mergeSapWorkbook(merged,[],rows,'run1')
  assert.ok(expanded.sheets[0].rows.some(r=>r.cells[2]==='old'))
  assert.equal(expanded.sapDateCutoff,'2025-09-01')
})

test('new Excel import changes the date boundary without losing historical manual cells',()=>{
  const old=book(),replacement=book();replacement.sheets[0].rows=replacement.sheets[0].rows.slice(0,2)
  replacement.sheets[0].rows[1].cells[13]='2026-01-01'
  const next=retainSapWorkbookRows(replacement,old)
  assert.deepEqual([...sapWorkbookDateScope(next).hidden].sort(),['boundary','new','old','unknown'])
  assert.equal(next.sheets[0].rows.find(r=>r.id==='old').cells[26],'Preserve human work')
})

test('no SAP additions qualify when Excel has no valid date or date column',()=>{
  for (const removeColumn of [false,true]) {
    const b=book();b.sheets[0].rows=b.sheets[0].rows.slice(0,2)
    b.sheets[0].rows[1].cells[13]='not-a-date'
    if(removeColumn)b.sheets[0].columns[13].id='unmapped-date'
    const next=mergeSapWorkbook(b,[],[{EBELN:'new',EBELP:'10',BEDAT:'20261012',MATNR:'MAT',MENGE:1,OPEN_PO_ELIGIBLE:true}],'run1')
    assert.equal(next.sheets[0].rows.length,2)
  }
})
