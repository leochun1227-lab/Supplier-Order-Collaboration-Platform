import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cloneBook, columnName, sheetValues, setCell, insertRow, deleteRows, insertColumn, deleteColumn, filteredRows, setCellFill, cellFill, setDimension } from '../src/parts-workbook.mjs'
import { createPartsWorkbookStore } from '../src/parts-workbook-store.mjs'

const source = JSON.parse(readFileSync(new URL('../public/parts-workbook.json', import.meta.url)))
test('both source sheets retain every row, column, title, blank and formula result', () => {
  assert.deepEqual(source.sheets.map(s => [s.name, s.rows.length, s.columns.length]), [['Sheet1',1256,27],['Sheet2',5,15]])
  for (const sheet of source.sheets) {
    assert.ok(sheet.rows.every(row => row.cells.length === sheet.columns.length))
    assert.deepEqual(sheetValues(sheet), sheet.rows.map(row => row.cells))
    assert.equal(new Set(sheet.rows.map(row => row.id)).size, sheet.rows.length)
  }
  assert.equal(source.sheets[0].merges.length, 3)
  assert.equal(columnName(26), 'AA')
})
test('editing quantity recalculates remaining; dates recalculate ETD; external lookup cached result survives', () => {
  const sheet = cloneBook(source.sheets[0]), row = sheet.rows[3]
  setCell(sheet, row.id, 9, '25'); setCell(sheet, row.id, 19, '7')
  setCell(sheet, row.id, 13, '2026-09-11')
  const result = sheetValues(sheet)
  assert.equal(result[3][20], 18); assert.equal(result[3][14], '2026-10-02')
  assert.equal(result[3][5], source.sheets[0].rows[3].cells[5])
  assert.throws(() => setCell(sheet, row.id, 13, '2026-02-30'), /invalid_date/)
  assert.throws(() => setCell(sheet, row.id, 0, '=alert(1)'), /unsupported_formula/)
  assert.throws(() => setCell(sheet, row.id, 0, '=SUM()'), /unsupported_formula/)
})
test('clear, zero, leading-zero identifiers, formulas and monthly totals remain distinct', () => {
  const sheet = cloneBook(source.sheets[1]), row = sheet.rows[1]
  setCell(sheet, row.id, 2, '0'); setCell(sheet, row.id, 3, '')
  assert.equal(row.cells[2], 0); assert.equal(row.cells[3], null)
  assert.equal(sheetValues(sheet)[1][14], 113 + 167 + 116 + 174 + 137 + 176 + 107)
  setCell(sheet, row.id, 3, '00010'); assert.equal(row.cells[3], '00010')
  setCell(sheet, row.id, 3, "'=SUM(A1:B2)"); assert.equal(row.cells[3], '=SUM(A1:B2)')
  setCell(sheet, row.id, 3, '=(2+3)*4-1'); assert.equal(sheetValues(sheet)[1][3], 19)
  setCell(sheet, row.id, 3, '=D2'); assert.equal(sheetValues(sheet)[1][3], '#CYCLE!')
})
test('row insertion, deletion and column changes retain stable records and rebase formulas', () => {
  const sheet = cloneBook(source.sheets[0]), firstId = sheet.rows[3].id
  insertRow(sheet, 3)
  assert.equal(sheet.rows[4].id, firstId); assert.equal(sheet.rows[4].formulas[20], '=J5-T5')
  assert.equal(sheetValues(sheet)[4][20], 0)
  deleteRows(sheet, [sheet.rows[3].id]); assert.equal(sheet.rows[3].id, firstId)
  insertColumn(sheet, 9); assert.equal(sheet.rows[3].formulas[21], '=K4-U4')
  deleteColumn(sheet, 9)
  assert.deepEqual(sheetValues(sheet), source.sheets[0].rows.map(r => r.cells))
  deleteRows(sheet, [sheet.rows[0].id]); assert.equal(sheet.rows.length, 1256)
})
test('filters and sorting only change the view; an edit uses the original stable row id', () => {
  const sheet = cloneBook(source.sheets[0]), before = JSON.stringify(sheet), values = sheetValues(sheet)
  const view = filteredRows(sheet, values, '', {25:'NG'}, {col:9,direction:-1})
  assert.ok(view.length > 0); assert.ok(view.every(r => String(values[r.index][25]).includes('NG')))
  assert.equal(JSON.stringify(sheet), before)
  const id = view[0].row.id; setCell(sheet, id, 26, 'filtered edit')
  assert.equal(sheet.rows[view[0].index].cells[26], 'filtered edit')
  const blanks = filteredRows(sheet, sheetValues(sheet), '', {26:'__BLANK__'})
  assert.ok(blanks.every(({row}) => row.cells[26] == null || row.cells[26] === ''))
})
test('column checklists combine exact values, text, blanks and other columns without changing data', () => {
  const sheet = {headerRows:1,rows:[['Material','Qty'],['00010',0],['10',null],['00010',2],['OTHER',0],['',null]].map((cells,i)=>({id:String(i),cells}))}
  const values = sheet.rows.map(r=>r.cells), before = JSON.stringify(sheet)
  const ids = filters => filteredRows(sheet,values,'',filters).map(({row})=>row.id)
  assert.deepEqual(ids({0:{values:['00010']}}),['1','3'])
  assert.deepEqual(ids({0:{values:['00010']},1:{values:['0']}}),['1'])
  assert.deepEqual(ids({0:{query:'other',mode:'nonblank',values:null}}),['4'])
  assert.deepEqual(ids({1:{mode:'blank'}}),['2','5'])
  assert.deepEqual(ids({1:{mode:'nonblank'}}),['1','3','4'])
  assert.deepEqual(ids({0:{values:[]}}),[])
  assert.deepEqual(ids({0:{values:['']}}),['5'])
  assert.equal(JSON.stringify(sheet),before)
})

test('cell fill follows stable row and column identities through edits, sorting and structural changes', () => {
  const sheet = cloneBook(source.sheets[0]), id = sheet.rows[3].id
  const values = sheetValues(sheet)
  setCellFill(sheet,id,9,'#fff2cc')
  assert.equal(cellFill(sheet,sheet.rows[3],9),'#FFF2CC')
  assert.deepEqual(sheetValues(sheet),values)
  const view = filteredRows(sheet,values,'',{}, {col:9,direction:-1})
  assert.equal(cellFill(sheet,view.find(r=>r.row.id===id).row,9),'#FFF2CC')
  insertColumn(sheet,9);insertRow(sheet,3)
  assert.equal(cellFill(sheet,sheet.rows[4],10),'#FFF2CC')
  assert.equal(cellFill(sheet,sheet.rows[4],9),'')
  setCell(sheet,id,10,'12');assert.equal(cellFill(sheet,sheet.rows[4],10),'#FFF2CC')
  const marked = cloneBook(sheet)
  deleteColumn(sheet,10);assert.equal(sheet.rows[4].fills,undefined)
  setCellFill(marked,id,10,'');assert.equal(marked.rows[4].fills,undefined)
  assert.throws(()=>setCellFill(sheet,id,1,'red;position:fixed'),/invalid_fill/)
})

test('row heights and column widths follow stable identities, clamp valid dimensions and reset without changing cells', () => {
  const sheet=cloneBook(source.sheets[0]), values=sheetValues(sheet)
  setDimension(sheet,'column','s0-c8',245);setDimension(sheet,'row','s0-r4',80)
  assert.deepEqual(sheetValues(sheet),values)
  insertRow(sheet,3);insertColumn(sheet,8)
  assert.equal(sheet.rows[4].heightPx,80);assert.equal(sheet.columns[9].widthPx,245)
  deleteRows(sheet,[sheet.rows[3].id]);deleteColumn(sheet,8)
  assert.equal(sheet.rows[3].heightPx,80);assert.equal(sheet.columns[8].widthPx,245)
  setDimension(sheet,'row','s0-r4',9999);assert.equal(sheet.rows[3].heightPx,546)
  setDimension(sheet,'column','s0-c8',0);assert.equal(sheet.columns[8].widthPx,48)
  assert.throws(()=>setDimension(sheet,'column','s0-c8',NaN),/invalid_dimension/)
  setDimension(sheet,'column','s0-c8',null);setDimension(sheet,'row','s0-r4',null)
  assert.equal(sheet.columns[8].widthPx,undefined);assert.equal(sheet.rows[3].heightPx,undefined)
  assert.deepEqual(sheetValues(sheet),values)
})

test('Firebase JSON preserves null cells, formulas, fills and dimensions, rejects concurrent writes and never reseeds existing data', async () => {
  let data = null, version = 0
  const fetcher = async (_url, options = {}) => {
    if (options.method === 'PUT') {
      if (options.headers['If-Match'] !== `"${version}"`) return new Response('', {status:412})
      data = JSON.parse(options.body); data.savedAt = 123456789; version++
    }
    return new Response(JSON.stringify(data), {status:200, headers:{etag:`"${version}"`}})
  }
  const a = createPartsWorkbookStore({fetcher}), b = createPartsWorkbookStore({fetcher})
  const initial = await a.initialize(source), stale = await b.load()
  const next = cloneBook(initial.book); next.sheets[0].rows[3].cells[26] = 'saved'
  setCellFill(next.sheets[0],'s0-r4',8,'#DDEBF7')
  setDimension(next.sheets[0],'column','s0-c8',245);setDimension(next.sheets[0],'row','s0-r4',80)
  const saved = await a.save(next, initial)
  assert.equal(saved.revision,2); assert.equal(saved.savedAt,123456789)
  await assert.rejects(b.save(source, stale), /save_conflict/)
  const reloaded = await a.initialize(source)
  assert.deepEqual(reloaded.book, next)
  assert.equal(reloaded.book.sheets[0].rows[3].formulas[20], '=J4-T4')
})
