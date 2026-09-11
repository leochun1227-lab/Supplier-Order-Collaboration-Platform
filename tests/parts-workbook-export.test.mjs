import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { buildPartsWorkbookXlsx } from '../src/parts-workbook-export.mjs'
import { cloneBook, setCell, insertRow, deleteRows, insertColumn, deleteColumn, setCellFill, setDimension } from '../src/parts-workbook.mjs'

const seed=JSON.parse(readFileSync(new URL('../public/parts-workbook.json',import.meta.url)))
const template=readFileSync(new URL('../public/parts-workbook-template.xlsx',import.meta.url))
const original=unzipSync(template)
test('export retains original styles, themes, external-link caches, print settings, rows and sheet structure',()=>{
  const output=unzipSync(buildPartsWorkbookXlsx(seed,template,seed))
  assert.deepEqual(Object.keys(output).sort(),Object.keys(original).sort())
  for(const path of Object.keys(original))if(!['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/workbook.xml'].includes(path))assert.deepEqual(output[path],original[path],path)
  for(const [path,rows,cols]of [['xl/worksheets/sheet1.xml',1256,27],['xl/worksheets/sheet2.xml',5,15]]) {
    const xml=strFromU8(output[path]),source=strFromU8(original[path])
    assert.equal([...xml.matchAll(/<row\b/g)].length,rows)
    assert.equal([...xml.matchAll(/<c\b/g)].length,rows*cols)
    for(const tag of ['cols','mergeCells','pageMargins','pageSetup','headerFooter']) {
      const pattern=new RegExp(`<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`)
      assert.equal(xml.match(pattern)?.[0],source.match(pattern)?.[0],path+' '+tag)
    }
  }
  const sheet=strFromU8(output['xl/worksheets/sheet1.xml'])
  assert.match(sheet,/<c r="U4"[^>]*><f>J4-T4<\/f><v>0<\/v><\/c>/)
  assert.match(sheet,/<c r="F4"[^>]*t="str"><f>VLOOKUP\(I:I,\[1\]Sheet1!\$J:\$P,7,0\)<\/f>/)
})
test('export uses current data, typed dates, zeros, clears, and literal strings with safe XML encoding',()=>{
  const book=cloneBook(seed),sheet=book.sheets[0]
  setCell(sheet,'s0-r4',9,'30');setCell(sheet,'s0-r4',19,'0');setCell(sheet,'s0-r4',13,'2026-09-11')
  setCell(sheet,'s0-r4',26,"'=literal & <tag>\n_x0041_")
  setCell(sheet,'s0-r5',23,'')
  const output=unzipSync(buildPartsWorkbookXlsx(book,template,seed)),xml=strFromU8(output['xl/worksheets/sheet1.xml'])
  assert.match(xml,/<c r="J4"[^>]*><v>30<\/v><\/c>/)
  assert.match(xml,/<c r="T4"[^>]*><v>0<\/v><\/c>/)
  assert.match(xml,/<c r="U4"[^>]*><f>J4-T4<\/f><v>30<\/v><\/c>/)
  assert.match(xml,/<c r="N4"[^>]*><v>46276<\/v><\/c>/)
  assert.match(xml,/<c r="AA4"[^>]*t="inlineStr"><is><t xml:space="preserve">=literal &amp; &lt;tag&gt;\n_x005F_x0041_<\/t><\/is><\/c>/)
  assert.match(xml,/<c r="X5"[^>]*\/>/)
})
test('insertions and deletions keep original row styles and column widths associated with stable IDs',()=>{
  const book=cloneBook(seed),sheet=book.sheets[0]
  setDimension(sheet,'column','s0-c8',245);setDimension(sheet,'row','s0-r4',80)
  const id=insertRow(sheet,4);setCell(sheet,id,8,'NEW-PART');setCell(sheet,id,9,'12')
  deleteRows(sheet,['s0-r6']);insertColumn(sheet,9);deleteColumn(sheet,0)
  const output=unzipSync(buildPartsWorkbookXlsx(book,template,seed)),xml=strFromU8(output['xl/worksheets/sheet1.xml'])
  assert.match(xml,/<dimension ref="A1:AA1256"\/>/)
  assert.match(xml,/<c r="H5"[^>]*t="inlineStr"><is><t xml:space="preserve">NEW-PART<\/t><\/is><\/c>/)
  assert.match(xml,/<c r="J5"[^>]*><v>12<\/v><\/c>/)
  assert.match(xml,/<f>VLOOKUP\(H:H,\[1\]Sheet1!\$J:\$P,7,0\)<\/f>/)
  assert.match(xml,/<autoFilter ref="A3:AA1256"\/>/)
  assert.equal([...xml.matchAll(/<row\b/g)].length,1256)
  assert.equal([...xml.matchAll(/<col\b/g)].length,27)
  const resizedColumn=xml.match(/<col\b[^>]*min="8"[^>]*\/>/)[0]
  assert.match(resizedColumn,/customWidth="1"/)
  assert.ok(Math.abs(Number(resizedColumn.match(/\bwidth="([^"]+)"/)[1])*7+5-245)<1)
  assert.match(xml,/<row\b[^>]*r="4"[^>]*ht="60"[^>]*customHeight="1"/)
})
test('a different template cannot silently export the wrong workbook',()=>{
  assert.throws(()=>buildPartsWorkbookXlsx({...seed,sourceHash:'wrong'},template,seed),/export_template_mismatch/)
})

test('exported fills preserve all other style properties, include blank and formula cells, and clear back to the template',()=>{
  const book=cloneBook(seed),sheet=book.sheets[0]
  setCellFill(sheet,'s0-r4',9,'#FFF2CC')
  setCellFill(sheet,'s0-r4',5,'#DDEBF7')
  setCell(sheet,'s0-r4',26,'');setCellFill(sheet,'s0-r4',26,'#F4CCCC')
  insertColumn(sheet,9);insertRow(sheet,3)
  const output=unzipSync(buildPartsWorkbookXlsx(book,template,seed))
  const xml=strFromU8(output['xl/worksheets/sheet1.xml']),styles=strFromU8(output['xl/styles.xml'])
  const entries=(xml,tag,child)=>[...xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`))[1].matchAll(new RegExp(`<${child}\\b[^>]*(?:/>|>[\\s\\S]*?</${child}>)`,'g'))].map(m=>m[0])
  const xfs=entries(styles,'cellXfs','xf'),fills=entries(styles,'fills','fill')
  const oldXfs=entries(strFromU8(original['xl/styles.xml']),'cellXfs','xf')
  for(const [address,oldAddress,color] of [['K5','J4','FFFFF2CC'],['F5','F4','FFDDEBF7'],['AB5','AA4','FFF4CCCC']]) {
    const cell=xml.match(new RegExp(`<c r="${address}"[^>]*>`))[0]
    const style=xfs[Number(cell.match(/\bs="(\d+)"/)[1])]
    const originalCell=strFromU8(original['xl/worksheets/sheet1.xml']).match(new RegExp(`<c r="${oldAddress}"[^>]*>`))[0]
    const originalStyle=oldXfs[Number(originalCell.match(/\bs="(\d+)"/)?.[1]||0)]
    const withoutFill=value=>value.replace(/\s(?:fillId|applyFill)="[^"]*"/g,'')
    assert.equal(withoutFill(style),withoutFill(originalStyle))
    assert.match(fills[Number(style.match(/\bfillId="(\d+)"/)[1])],new RegExp(`rgb="${color}"`))
  }
  assert.match(xml,/<c r="F5"[^>]*t="str"><f>VLOOKUP/)
  assert.match(xml,/<c r="AB5"[^>]*\/>/)
  const cleared=cloneBook(seed)
  setCellFill(cleared.sheets[0],'s0-r4',9,'#FFF2CC');setCellFill(cleared.sheets[0],'s0-r4',9,'')
  const restored=unzipSync(buildPartsWorkbookXlsx(cleared,template,seed))
  assert.deepEqual(restored['xl/styles.xml'],original['xl/styles.xml'])
})
