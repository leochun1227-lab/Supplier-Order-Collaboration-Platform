import test from 'node:test'
import assert from 'node:assert/strict'
import { workbookFilterValues, filteredRows, SAP_PENDING_FILTER } from '../src/parts-workbook.mjs'
import { hiddenSapSupplement } from '../src/parts-workbook-scope.mjs'

test('pending status can be searched and filtered separately from blank and NG cells without modifying records', () => {
  const sheet = {headerRows:1,rows:[
    {id:'header',cells:['PO','Status']},
    {id:'pending',cells:['45001',''],sapOrigin:true,sapPending:true},
    {id:'legacy',cells:['45002','NG'],sapOrigin:true,sapPending:true},
    {id:'excel-blank',cells:['45003','']},
    {id:'handled',cells:['45004','NG'],sapOrigin:true,sapPending:false},
    {id:'closed',cells:['45005',''],sapOrigin:true,sapPending:true,sapOpenPo:{eligible:false}},
    {id:'old',cells:['45006',''],sapOrigin:true,sapPending:true},
  ]}
  const before = JSON.stringify(sheet), raw = sheet.rows.map(row => row.cells)
  const values = workbookFilterValues(sheet, raw, 1)
  const ids = (search, filters) => filteredRows(sheet,values,search,filters).map(({row})=>row.id)
  assert.deepEqual(ids('',{1:{values:[SAP_PENDING_FILTER]}}),['pending','legacy','closed','old'])
  assert.deepEqual(ids('待处理',{}),['pending','legacy','closed','old'])
  assert.deepEqual(ids('pending sap',{}),['pending','legacy','closed','old'])
  assert.deepEqual(ids('',{1:{mode:'blank'}}),['excel-blank'])
  assert.deepEqual(ids('',{1:{values:['NG']}}),['handled'])
  assert.deepEqual(ids('',{0:{values:['45001']},1:{values:[SAP_PENDING_FILTER]}}),['pending'])
  const scope = {hidden:new Set(['old'])}
  assert.deepEqual(filteredRows(sheet,values,'',{1:{values:[SAP_PENDING_FILTER]}}).filter(({row})=>!hiddenSapSupplement(row,scope)).map(({row})=>row.id),['pending','legacy'])
  assert.equal(JSON.stringify(sheet),before)
  assert.equal(raw[1][1],'')
  assert.equal(raw[2][1],'NG')
  assert.equal(workbookFilterValues(sheet,raw,-1),raw)
  sheet.rows[1].sapPending = false
  assert.equal(workbookFilterValues(sheet,raw,1)[1][1],'')
})
