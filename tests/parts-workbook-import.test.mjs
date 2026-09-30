import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { parsePartsWorkbookXlsx, base64ToBytes } from '../src/parts-workbook-import.mjs'
import { partsHeaderMapping, sheetValues, cloneBook, setCell, preparePartsReplacement } from '../src/parts-workbook.mjs'
import { buildPartsWorkbookXlsx } from '../src/parts-workbook-export.mjs'
import { createPartsWorkbookStore } from '../src/parts-workbook-store.mjs'
import { sharedWorkbookState } from '../src/parts-workbook-link.mjs'

const template=readFileSync(new URL('../public/parts-workbook-template.xlsx',import.meta.url))
const seed=JSON.parse(readFileSync(new URL('../public/parts-workbook.json',import.meta.url)))
const fixture=({date1904=false,dimension='A1:F3',extra='',doctype=''}={})=>zipSync(Object.fromEntries(Object.entries({
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  'xl/workbook.xml':`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904?1:0}"/><sheets><sheet name="Latest &amp; Parts" sheetId="4" r:id="rId4"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/current.xml"/><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'xl/sharedStrings.xml':'<sst><si><t>0000123</t></si><si><r><t xml:space="preserve">A &amp; </t></r><r><t>B</t></r></si></sst>',
  'xl/styles.xml':'<styleSheet><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  'xl/worksheets/current.xml':`${doctype}<worksheet><dimension ref="${dimension}"/><sheetData><row r="1">${['Stockcode','Qty','Purchase Order','Line No','Order Date','Remarks'].map((v,c)=>`<c r="${String.fromCharCode(65+c)}1" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>0</v></c><c r="C2" t="inlineStr"><is><t>PO-NEW</t></is></c><c r="D2" t="inlineStr"><is><t>0010</t></is></c><c r="E2" s="1"><v>${date1904?44814:46276}</v></c><c r="F2" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>NEW</t></is></c><c r="B3"><f>IF(B2=0,12,3)</f><v>12</v></c><c r="C3" t="inlineStr"><is><t>PO-SECOND</t></is></c><c r="D3"><v>20</v></c></row>${extra}</sheetData></worksheet>`
}).map(([path,value])=>[path,strToU8(value)])))

test('the existing workbook imports every sheet and cached cell, detects its three-row header, and retains its own export template',async()=>{
  const {book,missingCaches}=await parsePartsWorkbookXlsx(template,'Latest parts.xlsx')
  assert.equal(book.sourceHash,seed.sourceHash)
  assert.equal(missingCaches,0)
  assert.deepEqual(base64ToBytes(book.importTemplateBase64),new Uint8Array(template))
  for(let s=0;s<seed.sheets.length;s++) {
    assert.equal(book.sheets[s].headerRows,seed.sheets[s].headerRows)
    // Excel's locale-specific built-in date formats (e.g. 58) were left as
    // serial numbers by the old Python extraction; the browser reads them as dates.
    const expected=seed.sheets[s].rows.map((row,r)=>row.cells.map((value,c)=>typeof value==='number'&&book.sheets[s].rows[r].types[c]==='date'?new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10):value))
    assert.deepEqual(book.sheets[s].rows.map(r=>r.cells),expected)
    const sorted=merges=>[...merges].sort((a,b)=>a.r-b.r||a.c-b.c)
    assert.deepEqual(sorted(book.sheets[s].merges),sorted(seed.sheets[s].merges))
  }
  assert.equal(partsHeaderMapping(book.sheets[0],3).score,27)
})

test('reordered columns, rich strings, leading zeros, dates and unsupported formula caches survive import and re-export',async()=>{
  for(const date1904 of [false,true]) {
    const bytes=fixture({date1904}),{book}=await parsePartsWorkbookXlsx(bytes,'renamed.xlsx'),sheet=book.sheets[0]
    assert.equal(sheet.name,'Latest & Parts')
    assert.equal(sheet.headerRows,1)
    assert.equal(sheet.fieldColumns.po,'s0-c2');assert.equal(sheet.fieldColumns.material,'s0-c0')
    assert.deepEqual(sheet.rows[1].cells,['0000123',0,'PO-NEW','0010','2026-09-11','A & B'])
    assert.equal(sheet.rows[2].formulas[1],'=IF(B2=0,12,3)')
    assert.equal(sheetValues(sheet)[2][1],12)
    const changed=cloneBook(book);setCell(changed.sheets[0],'s0-r2',4,'2026-10-01')
    const exported=buildPartsWorkbookXlsx(changed,bytes,book),reimported=(await parsePartsWorkbookXlsx(exported,'again.xlsx')).book
    assert.equal(reimported.sheets[0].rows[1].cells[4],'2026-10-01')
    assert.equal(reimported.sheets[0].rows[2].cells[1],12)
    assert.ok(unzipSync(exported)['xl/worksheets/current.xml'])
    assert.doesNotMatch(strFromU8(unzipSync(exported)['xl/worksheets/current.xml']),/2026 Parts/)
  }
})

test('invalid files, oversized grids and duplicate or missing required headers cannot silently import',async()=>{
  await assert.rejects(parsePartsWorkbookXlsx(new Uint8Array([1,2,3]),'x.xlsx'),/import_invalid_excel/)
  await assert.rejects(parsePartsWorkbookXlsx(template,'x.xls'),/import_xlsx_only/)
  await assert.rejects(parsePartsWorkbookXlsx(new Uint8Array(11*1024*1024),'x.xlsx'),/import_file_limit/)
  await assert.rejects(parsePartsWorkbookXlsx(fixture({dimension:'A1:XFD1048576'}),'x.xlsx'),/import_grid_limit/)
  await assert.rejects(parsePartsWorkbookXlsx(fixture({doctype:'<!DOCTYPE worksheet [<!ENTITY leak SYSTEM "file:///private">]>'}),'x.xlsx'),/import_invalid_excel/)
  const {book}=await parsePartsWorkbookXlsx(fixture(),'x.xlsx'),sheet=book.sheets[0]
  sheet.rows[0].cells[3]='Purchase Order'
  const mapping=partsHeaderMapping(sheet,1)
  assert.equal(mapping.valid,false);assert.deepEqual(mapping.missing,['line']);assert.deepEqual(mapping.duplicates,['po'])
})

test('replacement updates shared records rather than appending old orders, and generations cannot inherit unrelated row edits',async()=>{
  const {book}=await parsePartsWorkbookXlsx(fixture(),'latest.xlsx');book.importId='import-first'
  const source={orders:[{id:'old',importFields:{po:'REMOVED',line:'0010',material:'OLD'},importEvidence:[]}],shipments:[{id:'old-shipment',order:'old',allocations:[{order:'old',qty:1}]}],issues:[]}
  const first=sharedWorkbookState(source,{},book)
  assert.equal(first.state.orders.length,2);assert.ok(first.hidden.has('old'));assert.equal(first.state.shipments.length,0)
  assert.equal(first.state.orders[0].part,'0000123');assert.equal(first.state.orders[0].qty,0)
  const id=first.state.orders[0].id, overlay={orders:{[id]:{comments:[{text:'old file comment'}]}},shipments:{},issues:{}}
  book.importId='import-second'
  const second=sharedWorkbookState(source,overlay,book)
  assert.notEqual(second.state.orders[0].id,id);assert.deepEqual(second.state.orders[0].comments,[])
  assert.ok(second.hidden.has(id))
})

test('replacement and previous workbook backup are atomic, survive ordinary edits, and reject stale writers',async()=>{
  let stored=null,version=0,fail=false
  const fetcher=async(_,options={})=>{
    if(options.method==='PUT'){
      if(fail)throw new Error('offline')
      if(options.headers['If-Match']!==`v${version}`)return new Response('',{status:412})
      stored=JSON.parse(options.body);stored.savedAt=123;version++
    }
    return new Response(JSON.stringify(stored),{headers:{etag:`v${version}`}})
  }
  const store=createPartsWorkbookStore({fetcher}),old={sourceFile:'old.xlsx',sheets:[{id:'s0'}]},next={sourceFile:'new.xlsx',sheets:[{id:'s1'}]}
  const initial=await store.initialize(old),stale=await store.load()
  fail=true;await assert.rejects(store.replace(next,initial),/offline/);assert.deepEqual((await store.load()).book,old)
  fail=false
  const saved=await store.replace(next,initial)
  assert.deepEqual(saved.book,next);assert.deepEqual(saved.backupBook,old)
  await assert.rejects(store.replace(old,stale),/save_conflict/)
  const edited=await store.save({...next,sourceFile:'edited.xlsx'},saved)
  assert.deepEqual(edited.backupBook,old)
  const restored=await store.replace(edited.backupBook,edited)
  assert.deepEqual(restored.book,old);assert.equal(restored.backupBook.sourceFile,'edited.xlsx')
})


test('verified import identities survive subsequent cell edits, while duplicate keys stay unlinked',async()=>{
  const parsed=(await parsePartsWorkbookXlsx(fixture(),'latest.xlsx')).book
  const book=preparePartsReplacement(parsed,'stable-import')
  const source={orders:[{id:'source-order',importFields:{po:'PO-NEW',line:'0010',material:'0000123'},sapPart:'0000123',sapPo:'PO-NEW',sapItem:'0010',importEvidence:[]}],shipments:[],issues:[]}
  const first=sharedWorkbookState(source,{},book)
  assert.equal(first.state.orders[0].id,'source-order')
  setCell(book.sheets[0],'s0-r2',2,'PO-CHANGED')
  const next=sharedWorkbookState(source,{orders:{'source-order':{comments:[{text:'keep'}]}}},book)
  assert.equal(next.state.orders[0].id,'source-order');assert.equal(next.state.orders[0].po,'PO-CHANGED')
  assert.equal(next.state.orders[0].sapPo,'PO-NEW');assert.equal(next.state.orders[0].comments[0].text,'keep')
  const duplicate=cloneBook(parsed);duplicate.sheets[0].rows[2].cells=cloneBook(duplicate.sheets[0].rows[1].cells)
  const ambiguous=preparePartsReplacement(duplicate,'ambiguous');ambiguous.sheets[0].rows.pop()
  const result=sharedWorkbookState(source,{},ambiguous)
  assert.notEqual(result.state.orders[0].id,'source-order');assert.ok(result.hidden.has('source-order'))
})
