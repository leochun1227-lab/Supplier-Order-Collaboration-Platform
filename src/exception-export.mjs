import { zipSync, strToU8 } from 'fflate'
import { translate } from './translations.mjs'
import { KINDS, workbookIdentity } from './reconciliation.mjs'
import { columnName } from './parts-workbook.mjs'

const columns = [
  ['异常编号','Issue ID',28], ['问题类型','Issue type',24], ['问题标题','Issue title',30],
  ['比对摘要／异常记录','Comparison / recorded issue',60], ['优先级','Priority',12], ['处理状态','Status',16],
  ['总表／业务 PO','Workbook / business PO',20], ['总表／业务订单行','Workbook / business line',18],
  ['SAP PO','SAP PO',20], ['SAP 订单行','SAP line',16], ['SO','SO',20],
  ['当前 SAP 料号','Current SAP material',24], ['当前总表／业务料号','Current workbook / business material',28],
  ['SAP 单位','SAP unit',12], ['总表／业务单位','Workbook / business unit',18],
  ['责任人','Owner',22], ['处理期限','Due date',16], ['处理备注','Review notes',48], ['关闭依据','Closure evidence',44],
  ['来源文件／工作表／原行号','Source file / sheet / original row',56], ['SAP 数据时间','SAP data as of',24], ['导出时间 (UTC)','Exported at (UTC)',28],
]

export function exceptionExportRows(tasks, orders, {language='zh', exportedAt=new Date().toISOString()}={}) {
  const tr=value=>translate(value,language), byId=new Map(orders.map(order=>[order.id,order]))
  const text=(value,userEntered=false)=>userEntered&&typeof value==='string'?value:tr(value??'')
  return [columns.map(col=>col[language==='en'?1:0]), ...tasks.map(task=>{
    const order=byId.get(task.order)||task.sourceRecord||{}
    return [task.id, tr(KINDS[task.kind]||task.category||''), text(task.title,task.userEntered),
      text(task.detail,task.userEntered), tr(task.priority||''), tr(task.status||''),
      workbookIdentity(order).po,workbookIdentity(order).item,order.sapPo??'',order.sapItem??'',order.so??'',order.sapPart??'',order.soPart??order.part??'',
      order.sapUnit??order.unit??'',order.soUnit??'',task.owner??'',task.due??'',
      text(task.note,task.noteUserEntered||task.rule),tr(task.closure||''),
      (order.importEvidence||[]).map(e=>[e.file,e.sheet,e.row].filter(v=>v!=null&&v!=='').join(' / ')).join('\n'),
      order.sapAsOf??'',exportedAt]
  })]
}

const xml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
// XML 1.0 control characters must be escaped using Excel text escapes.
// eslint-disable-next-line no-control-regex
const cellText=value=>xml(String(value??'').replace(/_x[0-9a-f]{4}_/gi,m=>'_x005F_'+m.slice(1)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,c=>`_x${c.charCodeAt(0).toString(16).padStart(4,'0')}_`))
const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'

export function buildExceptionExport(tasks,orders,options={}) {
  const rows=exceptionExportRows(tasks,orders,options)
  if(rows.length>1048576)throw new Error('export_excel_limit')
  const name=options.language==='en'?'Exception comparison':'异常对比清单'
  const last=`${columnName(columns.length-1)}${rows.length}`
  const sheetRows=rows.map((row,r)=>{
    const lines=Math.max(...row.map((value,c)=>String(value??'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(Array.from(line).reduce((width,char)=>width+(char.charCodeAt(0)>255?2:1),0)/columns[c][2])),0)))
    const height=r===0?36:Math.min(120,Math.max(30,lines*15+6))
    // Explicit text cells preserve codes/leading zeros and cannot execute spreadsheet formulas.
    return `<row r="${r+1}" ht="${height}" customHeight="1">${row.map((value,c)=>`<c r="${columnName(c)}${r+1}" s="${r===0?1:r%2?0:2}" t="inlineStr"><is><t xml:space="preserve">${cellText(value)}</t></is></c>`).join('')}</row>`
  }).join('')
  const files={
    '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><color rgb="FF243E50"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF246474"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F5F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE6EB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3">${[[0,0],[1,2],[0,3]].map(([font,fill])=>`<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${columns.map((col,c)=>`<col min="${c+1}" max="${c+1}" width="${col[2]}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`,
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([path,body])=>[path,strToU8(declaration+body)])),{level:6})
}

export function downloadExceptions(tasks,orders,options={}) {
  const exportedAt=new Date().toISOString(),bytes=buildExceptionExport(tasks,orders,{...options,exportedAt})
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  const link=document.createElement('a')
  try {
    link.href=url;link.download=`Regent-${options.language==='en'?'Exceptions':'异常对比清单'}-${exportedAt.slice(0,10)}.xlsx`
    document.body.appendChild(link);link.click()
  } finally {link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
