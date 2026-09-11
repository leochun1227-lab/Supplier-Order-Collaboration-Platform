import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { columnName, columnIndex, sheetValues, externalFormula, cellFill } from './parts-workbook.mjs'

const attr = (xml, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1]
const attributes = xml => xml.slice(xml.indexOf(' '), xml.indexOf('>')).replace(/\/$/,'')
function setAttr(attrs, name, value) {
  const pattern = new RegExp(`\\s${name}="[^"]*"`, 'g')
  return attrs.replace(pattern,'') + (value == null ? '' : ` ${name}="${value}"`)
}
const escapeXml = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
// XML 1.0 control characters must be escaped using Excel text escapes.
// eslint-disable-next-line no-control-regex
const excelText = value => escapeXml(String(value).replace(/_x[0-9a-f]{4}_/gi,match=>'_x005F_'+match.slice(1)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,c=>`_x${c.charCodeAt(0).toString(16).padStart(4,'0')}_`))
const dateSerial = value => (Date.parse(value+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000
const sourceRow = (sheet,id) => new RegExp(`^${sheet.id}-r(\\d+)$`).exec(id)?.[1]
const sourceColumn = (sheet,id) => { const match=new RegExp(`^${sheet.id}-c(\\d+)$`).exec(id); return match?Number(match[1]):null }

function readTemplateSheet(xml) {
  const rows=new Map()
  for(const match of xml.matchAll(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
    const raw=match[0],cells=new Map()
    for(const cell of raw.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g))cells.set(attr(cell[0],'r'),cell[0])
    rows.set(Number(attr(raw,'r')),{attrs:attributes(raw),cells})
  }
  const cols=[...xml.matchAll(/<col\b[^>]*\/>/g)].map(m=>({min:Number(attr(m[0],'min')),max:Number(attr(m[0],'max')),attrs:attributes(m[0])}))
  return {rows,cols}
}
function originColStyle(template,c){return template.cols.find(col=>c+1>=col.min&&c+1<=col.max)?.attrs||''}
function closestRow(sheet,index,template) {
  for(let offset=0;offset<sheet.rows.length;offset++)for(const r of [index-offset,index+offset]) {
    if(r<sheet.headerRows||r>=sheet.rows.length)continue
    const row=template.rows.get(Number(sourceRow(sheet,sheet.rows[r].id)))
    if(row)return row
  }
  return template.rows.get(sheet.headerRows+1)||{attrs:'',cells:new Map()}
}
function closestCol(sheet,index) {
  for(let offset=0;offset<sheet.columns.length;offset++)for(const c of [index-offset,index+offset]) {
    if(c<0||c>=sheet.columns.length)continue
    const col=sourceColumn(sheet,sheet.columns[c].id)
    if(col!=null)return col
  }
  return 0
}
function lookupFormula(formula,sheet) {
  // Only the local lookup argument moves. External workbook ranges stay intact.
  if(!externalFormula(formula))return formula
  return formula.replace(/^(=VLOOKUP\()(\$?)([A-Z]+):(\$?)([A-Z]+)(,)/i,(all,p,a,left,b,right,end)=>{
    const mapped=name=>sheet.columns.findIndex(c=>c.id===`${sheet.id}-c${columnIndex(name)}`)
    const l=mapped(left),r=mapped(right)
    return l<0||r<0?p+'#REF!'+end:p+a+columnName(l)+':'+b+columnName(r)+end
  })
}
function makeCell(address,style,value,formula,type) {
  const s=style?` s="${style}"`:''
  let content='',cellType=''
  if(formula)content=`<f>${escapeXml(formula.slice(1))}</f>`
  if(value!=null&&value!=='') {
    if(type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(value))value=dateSerial(value)
    if(typeof value==='number'&&Number.isFinite(value))content+=`<v>${value}</v>`
    else if(typeof value==='boolean'){cellType='b';content+=`<v>${value?1:0}</v>`}
    else if(formula&&String(value).startsWith('#')){cellType='e';const error=['#NULL!','#DIV/0!','#VALUE!','#REF!','#NAME?','#NUM!','#N/A'].includes(value)?value:'#VALUE!';content+=`<v>${error}</v>`}
    else if(formula){cellType='str';content+=`<v>${excelText(value)}</v>`}
    else{cellType='inlineStr';content+=`<is><t xml:space="preserve">${excelText(value)}</t></is>`}
  }
  return `<c r="${address}"${s}${cellType?` t="${cellType}"`:''}${content?'>'+content+'</c>':'/>'}`
}

function fillStyles(xml) {
  const fillsBlock = xml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/)
  const stylesBlock = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!fillsBlock || !stylesBlock) throw new Error('export_styles_missing')
  const fills = [...fillsBlock[1].matchAll(/<fill\b[^>]*(?:\/>|>[\s\S]*?<\/fill>)/g)].map(m=>m[0])
  const styles = [...stylesBlock[1].matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0])
  const fillIds = new Map(), styleIds = new Map()
  let changed = false
  return {
    style(base, color) {
      if (!color) return base
      const key = `${base || 0}:${color}`
      if (styleIds.has(key)) return styleIds.get(key)
      let fillId = fillIds.get(color)
      if (fillId == null) { fillId = fills.length; fillIds.set(color,fillId); fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${color.slice(1)}"/><bgColor indexed="64"/></patternFill></fill>`) }
      const source = styles[Number(base || 0)]
      if (!source) throw new Error('export_styles_missing')
      const next = source.replace(/^<xf\b[^>]*>/,tag=> {
        const attrs = setAttr(setAttr(attributes(tag),'fillId',fillId),'applyFill',1)
        return `<xf${attrs}${tag.endsWith('/>')?'/':''}>`
      })
      const id = styles.length; styles.push(next); styleIds.set(key,id); changed = true; return String(id)
    },
    xml() { return changed ? xml.replace(fillsBlock[0],`<fills count="${fills.length}">${fills.join('')}</fills>`).replace(stylesBlock[0],`<cellXfs count="${styles.length}">${styles.join('')}</cellXfs>`) : xml }
  }
}

function exportSheet(xml,sheet,baseline,styles) {
  const template=readTemplateSheet(xml),values=sheetValues(sheet),baselineRows=new Map(baseline.rows.map(row=>[row.id,row]))
  const data=[]
  for(let r=0;r<sheet.rows.length;r++) {
    const row=sheet.rows[r],origin=Number(sourceRow(sheet,row.id)),original=template.rows.get(origin),styleRow=original||closestRow(sheet,r,template)
    let rowAttrs=setAttr(styleRow.attrs,'r',r+1)
    rowAttrs=setAttr(rowAttrs,'spans',`1:${sheet.columns.length}`)
    if (Number.isFinite(row.heightPx)) rowAttrs=setAttr(setAttr(rowAttrs,'ht',row.heightPx*0.75),'customHeight',1)
    const cells=[]
    for(let c=0;c<sheet.columns.length;c++) {
      const oc=sourceColumn(sheet,sheet.columns[c].id),styleCol=oc??closestCol(sheet,c),baseRow=baselineRows.get(row.id)
      const sourceAddress=columnName(styleCol)+(original?origin:Number(attr('<row'+styleRow.attrs+'>','r'))||sheet.headerRows+1)
      const sourceCell=styleRow.cells.get(sourceAddress),address=columnName(c)+(r+1)
      const formula=row.formulas[c]
      const style=styles.style(sourceCell?attr(sourceCell,'s'):attr('<col'+originColStyle(template,styleCol)+'>','style'),cellFill(sheet,row,c))
      // Preserve original rich text, blank styles and native cell metadata verbatim.
      if(original&&oc!=null&&sourceCell&&!formula&&!baseRow?.formulas[oc]&&Object.is(row.cells[c],baseRow?.cells[oc])) {
        let cell=sourceCell.replace(/\br="[^"]*"/,`r="${address}"`)
        if (cellFill(sheet,row,c)) cell=cell.replace(/^<c\b[^>]*>/,tag=>`<c${setAttr(attributes(tag),'s',style)}${tag.endsWith('/>')?'/':''}>`)
        cells.push(cell);continue
      }
      cells.push(makeCell(address,style,values[r][c],lookupFormula(formula||'',sheet),row.types[c]))
    }
    data.push(`<row${rowAttrs}>${cells.join('')}</row>`)
  }
  xml=xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,`<sheetData>${data.join('')}</sheetData>`)
  const last=columnName(sheet.columns.length-1)+sheet.rows.length
  xml=xml.replace(/<dimension\b[^>]*\/>/,`<dimension ref="A1:${last}"/>`)
  if(!sheet.columns.every((col,c)=>col.id===baseline.columns[c]?.id)||sheet.columns.length!==baseline.columns.length||sheet.columns.some(col=>Number.isFinite(col.widthPx))) {
    const cols=sheet.columns.map((col,c)=>{
      let attrs=originColStyle(template,sourceColumn(sheet,col.id)??closestCol(sheet,c))
      attrs=setAttr(setAttr(attrs,'min',c+1),'max',c+1)
      // Excel column width uses Normal-font character units (7 px at 11 pt Calibri), plus 5 px padding.
      if (Number.isFinite(col.widthPx)) attrs=setAttr(setAttr(setAttr(attrs,'width',Math.round((col.widthPx-5)/7*256)/256),'customWidth',1),'bestFit',null)
      return `<col${attrs}/>`
    }).join('')
    xml=xml.replace(/<cols>[\s\S]*?<\/cols>/,`<cols>${cols}</cols>`)
  }
  const merges=sheet.merges.length?`<mergeCells count="${sheet.merges.length}">${[...sheet.merges].sort((a,b)=>a.r-b.r||a.c-b.c).map(m=>`<mergeCell ref="${columnName(m.c)}${m.r+1}:${columnName(m.c+m.cols-1)}${m.r+m.rows}"/>`).join('')}</mergeCells>`:''
  if(/<mergeCells\b/.test(xml))xml=xml.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/,merges)
  else if(merges)xml=xml.replace('<pageMargins',merges+'<pageMargins')
  // Export the whole workbook, independent of the current page's filters/sort.
  xml=xml.replace(/<autoFilter\b[^>]*(?:\/>|>[\s\S]*?<\/autoFilter>)/,`<autoFilter ref="A${sheet.headerRows}:${last}"/>`)
  xml=xml.replace(/<sortState\b[^>]*(?:\/>|>[\s\S]*?<\/sortState>)/g,'')
  xml=xml.replace(/<pane\b[^>]*\/>/,m=>m.replace(/topLeftCell="[^"]*"/,`topLeftCell="A${sheet.headerRows+1}"`))
  xml=xml.replace(/<selection\b[^>]*\/>/g,m=>m.replace(/activeCell="[^"]*"/,`activeCell="A${sheet.headerRows+1}"`).replace(/sqref="[^"]*"/,`sqref="A${sheet.headerRows+1}"`))
  return xml
}

/** Preserve the original OOXML package; replace only current worksheet content. */
export function buildPartsWorkbookXlsx(book,templateBytes,baseline) {
  if(book.sourceHash!==baseline.sourceHash||book.sheets.length!==baseline.sheets.length)throw new Error('export_template_mismatch')
  const files=unzipSync(templateBytes)
  const styles=fillStyles(strFromU8(files['xl/styles.xml']))
  for(let i=0;i<baseline.sheets.length;i++) {
    const source=baseline.sheets[i],sheet=book.sheets.find(s=>s.id===source.id),path=`xl/worksheets/sheet${i+1}.xml`
    if(!sheet||!files[path]||!sheet.rows.length||!sheet.columns.length)throw new Error('export_template_mismatch')
    if(sheet.rows.length>1048576||sheet.columns.length>16384)throw new Error('export_excel_limit')
    files[path]=strToU8(exportSheet(strFromU8(files[path]),sheet,source,styles))
  }
  files['xl/styles.xml']=strToU8(styles.xml())
  let workbookXml=strFromU8(files['xl/workbook.xml'])
  workbookXml=workbookXml.replace(/<definedName\b[^>]*name="_xlnm\._FilterDatabase"[^>]*>[\s\S]*?<\/definedName>/g,tag=>{
    const sheet=book.sheets[Number(attr(tag,'localSheetId'))]
    return tag.replace(/>[\s\S]*<\/definedName>/,`>${escapeXml(sheet.name)}!$A$${sheet.headerRows}:$${columnName(sheet.columns.length-1)}$${sheet.rows.length}</definedName>`)
  })
  files['xl/workbook.xml']=strToU8(workbookXml)
  return zipSync(files,{level:6})
}
