import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync,strFromU8 } from 'fflate'
import { exceptionExportRows,buildExceptionExport } from '../src/exception-export.mjs'

const options={language:'zh',exportedAt:'2026-09-11T03:00:00.000Z'}
const orders=[{id:'order-a',po:'00001234',item:'0010',sapPo:'00009999',sapItem:'00020',so:'SO-1',sapPart:'SAP-OLD',soPart:'NEW-PART',unit:'EA',soUnit:'PCS',sapAsOf:'2026-09-10',importEvidence:[{file:'original.xlsx',sheet:'Sheet1',row:4}]}]
const task={id:'CHECK-1',order:'order-a',kind:'material',title:{zh:'物料待核对',en:'Material review'},detail:'SAP-OLD ↔ NEW-PART',priority:'高',status:'待处理',owner:'Leo',due:'2026-09-15',note:'请保留备注',noteUserEntered:true}

test('exception export includes both material originals and provenance without mutating records',()=>{
  const before=JSON.stringify({orders,task}),rows=exceptionExportRows([task],orders,options)
  const record=Object.fromEntries(rows[0].map((header,i)=>[header,rows[1][i]]))
  assert.equal(record['当前 SAP 料号'],'SAP-OLD');assert.equal(record['当前总表／业务料号'],'NEW-PART')
  assert.equal(record['总表／业务 PO'],'00001234');assert.equal(record['总表／业务订单行'],'0010')
  assert.equal(record['SAP PO'],'00009999');assert.equal(record['SAP 订单行'],'00020')
  assert.equal(record['处理备注'],'请保留备注');assert.match(record['来源文件／工作表／原行号'],/original.xlsx \/ Sheet1 \/ 4/)
  assert.equal(record['SAP 数据时间'],'2026-09-10');assert.equal(record['导出时间 (UTC)'],options.exportedAt)
  assert.equal(JSON.stringify({orders,task}),before)
})

test('missing SAP data stays blank and resolved evidence is separate from current material values',()=>{
  const rows=exceptionExportRows([{...task,status:'已解决',closure:{zh:'映射已确认',en:'Mapping confirmed'}}],[{id:'order-a',part:'CURRENT'}],{...options,language:'en'})
  const record=Object.fromEntries(rows[0].map((header,i)=>[header,rows[1][i]]))
  assert.equal(record['Current SAP material'],'');assert.equal(record['Current workbook / business material'],'CURRENT')
  assert.equal(record['Closure evidence'],'Mapping confirmed');assert.equal(record['SAP data as of'],'')
  assert.equal(record['Review notes'],'请保留备注')
})

test('real XLSX has all result rows, frozen filter headers, and literal safe text cells',()=>{
  const tasks=Array.from({length:83},(_,i)=>({...task,id:'CHECK-'+i,note:i===0?'=HYPERLINK("https://example.test") & <tag>\n_x0041_':task.note}))
  const files=unzipSync(buildExceptionExport(tasks,orders,options)),sheet=strFromU8(files['xl/worksheets/sheet1.xml'])
  assert.equal([...sheet.matchAll(/<row\b/g)].length,84)
  assert.match(sheet,/<autoFilter ref="A1:V84"\/>/)
  assert.match(sheet,/<pane ySplit="1" topLeftCell="A2"/)
  assert.match(sheet,/CHECK-82/);assert.match(sheet,/>00001234<\/t>/)
  assert.match(sheet,/=HYPERLINK\(&quot;https:\/\/example.test&quot;\) &amp; &lt;tag&gt;\n_x005F_x0041_/)
  assert.doesNotMatch(sheet,/<f[ >]/)
  assert.match(strFromU8(files['[Content_Types].xml']),/spreadsheetml.sheet.main\+xml/)
})
