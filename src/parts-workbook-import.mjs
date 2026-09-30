import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { columnIndex, partsHeaderMapping } from './parts-workbook.mjs'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const MAX_CELLS = 500000, MAX_ROWS = 20000, MAX_COLS = 256
const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
const text = value => typeof value === 'object' ? value?.['#text'] ?? '' : value ?? ''
const decodeText = value => String(value).replace(/_x([0-9a-f]{4})_/gi, (_,code) => String.fromCharCode(parseInt(code,16)))
const richText = node => decodeText(node?.t != null ? text(node.t) : list(node?.r).map(run=>text(run.t)).join(''))
// This pinned parser's compatibility option decodes Excel numeric XML entities.
// eslint-disable-next-line typescript/no-deprecated
const parser = new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,removeNSPrefix:true,htmlEntities:true})
function xml(files,path) {
  if (!files[path]) throw new Error('import_invalid_excel')
  const source = strFromU8(files[path])
  // The bundled validator checks syntax; DTDs are rejected before parsing.
  // eslint-disable-next-line typescript/no-deprecated
  if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) throw new Error('import_invalid_excel')
  return parser.parse(source)
}
function address(ref) {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref || '')
  if (!match) throw new Error('import_invalid_excel')
  const c = columnIndex(match[1].toUpperCase()), r = Number(match[2])-1
  if (r < 0 || r >= MAX_ROWS || c >= MAX_COLS) throw new Error('import_grid_limit')
  return {r,c}
}
function range(ref) {
  const [first,last=first] = String(ref).split(':')
  const start=address(first), end=address(last)
  if (end.r < start.r || end.c < start.c) throw new Error('import_invalid_excel')
  return {...start,rows:end.r-start.r+1,cols:end.c-start.c+1}
}
function resolvePath(target) {
  const parts=[]
  for (const segment of (target.startsWith('/') ? target.slice(1) : 'xl/'+target).split('/')) {
    if(segment==='..')parts.pop();else if(segment!=='.')parts.push(segment)
  }
  const path=parts.join('/')
  if(!path.startsWith('xl/'))throw new Error('import_invalid_excel')
  return path
}
function isDateFormat(id,formats) {
  if ([14,15,16,17,22,27,28,29,30,31,34,35,36,50,51,52,53,54,55,56,57,58].includes(id)) return true
  const format = (formats.get(id)||'').replace(/"[^"]*"|\\.|\[[^\]]*\]/g,'')
  return /[yd]/i.test(format)
}
function dateValue(value,date1904) {
  const time=(date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,30))+Math.round(value*86400000)
  if (!Number.isFinite(time) || Math.abs(time)>8640000000000000) throw new Error('import_invalid_excel')
  return new Date(time).toISOString().slice(0,10)
}
function sharedFormula(formula,from,to) {
  return formula.split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2 ? part : part.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (match,ac,col,ar,row)=>{
    const c=columnIndex(col)+(ac?0:to.c-from.c),r=Number(row)+(ar?0:to.r-from.r)
    if(c<0||r<1)return '#REF!'
    let name='',index=c+1
    while(index){index--;name=String.fromCharCode(65+index%26)+name;index=Math.floor(index/26)}
    return ac+name+ar+r
  })).join('')
}
export function bytesToBase64(bytes) {
  let binary=''
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768))
  return btoa(binary)
}
export function base64ToBytes(value) { return Uint8Array.from(atob(value),c=>c.charCodeAt(0)) }

/** Parse locally; no upload or workbook mutation occurs during preview. */
export async function parsePartsWorkbookXlsx(input,filename) {
  const bytes=input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!/\.xlsx$/i.test(filename)) throw new Error('import_xlsx_only')
  if (!bytes.length || bytes.length>MAX_IMPORT_BYTES) throw new Error('import_file_limit')
  let expanded=0,files
  try {
    files=unzipSync(bytes,{filter:file=>{
      expanded+=file.originalSize
      if(file.originalSize>40*1024*1024||expanded>80*1024*1024)throw new Error('import_file_limit')
      return true
    }})
  } catch(error) {throw new Error(error.message==='import_file_limit'?error.message:'import_invalid_excel')}
  if (Object.keys(files).some(path=>/vbaProject\.bin$/i.test(path))) throw new Error('import_xlsx_only')
  const workbook=xml(files,'xl/workbook.xml').workbook
  if (!workbook) throw new Error('import_invalid_excel')
  const relationships=list(xml(files,'xl/_rels/workbook.xml.rels').Relationships?.Relationship)
  const relations=new Map(relationships.map(r=>[r['@_Id'],r]))
  const partPath=(type,fallback)=>{const rel=relationships.find(r=>r['@_Type']?.endsWith('/'+type));if(rel?.['@_TargetMode']==='External')throw new Error('import_invalid_excel');return rel?resolvePath(rel['@_Target']):fallback}
  const stringsPath=partPath('sharedStrings','xl/sharedStrings.xml'),stylesPath=partPath('styles','xl/styles.xml')
  const strings=files[stringsPath]?list(xml(files,stringsPath).sst?.si).map(richText):[]
  const style=files[stylesPath]?xml(files,stylesPath).styleSheet:{}
  const formats=new Map(list(style.numFmts?.numFmt).map(f=>[Number(f['@_numFmtId']),f['@_formatCode']]))
  const dateStyles=list(style.cellXfs?.xf).map(xf=>isDateFormat(Number(xf['@_numFmtId']),formats))
  const date1904=['1','true'].includes(workbook.workbookPr?.['@_date1904'])
  const sourceHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')
  const book={schemaVersion:1,sourceFile:filename,sourceHash,date1904,stylesPath,sheets:[]}
  const sheets=list(workbook.sheets?.sheet)
  if(!sheets.length||sheets.length>30)throw new Error('import_grid_limit')
  let cellsTotal=0,formulaCount=0,missingCaches=0
  for(const [index,entry] of sheets.entries()) {
    const relation=relations.get(entry['@_id'])
    if(!relation||relation['@_TargetMode']==='External'||!relation['@_Type']?.endsWith('/worksheet'))throw new Error('import_invalid_excel')
    const sourcePath=resolvePath(relation['@_Target']), data=xml(files,sourcePath).worksheet
    if(!data)throw new Error('import_invalid_excel')
    const merges=list(data.mergeCells?.mergeCell).map(m=>range(m['@_ref']))
    const rawRows=list(data.sheetData?.row), entries=[], shared=new Map()
    let maxRow=1,maxCol=1
    // The declared range can include formatted empty cells; retain it within explicit limits.
    if(data.dimension?.['@_ref']){const d=range(data.dimension['@_ref']);maxRow=d.r+d.rows;maxCol=d.c+d.cols}
    for(const row of rawRows)for(const cell of list(row.c)) {
      const pos=address(cell['@_r']);maxRow=Math.max(maxRow,pos.r+1);maxCol=Math.max(maxCol,pos.c+1)
      entries.push({cell,...pos})
      if(cell.f?.['@_t']==='shared'&&text(cell.f)!=='')shared.set(cell.f['@_si'],{formula:String(text(cell.f)),...pos})
    }
    for(const m of merges){maxRow=Math.max(maxRow,m.r+m.rows);maxCol=Math.max(maxCol,m.c+m.cols)}
    cellsTotal+=maxRow*maxCol
    if(cellsTotal>MAX_CELLS)throw new Error('import_grid_limit')
    const id='s'+index,columns=Array.from({length:maxCol},(_,c)=>({id:`${id}-c${c}`}))
    const rows=Array.from({length:maxRow},(_,r)=>({id:`${id}-r${r+1}`,cells:Array(maxCol).fill(null),formulas:{},types:{}}))
    const seen=new Set()
    for(const {cell,r,c} of entries) {
      const key=r+':'+c
      if(seen.has(key))throw new Error('import_invalid_excel');seen.add(key)
      const row=rows[r],type=cell['@_t'],raw=text(cell.v)
      let value=null
      if(type==='s') {if(!/^\d+$/.test(raw)||Number(raw)>=strings.length)throw new Error('import_invalid_excel');value=strings[Number(raw)]}
      else if(type==='inlineStr')value=richText(cell.is)
      else if(type==='str'||type==='e')value=decodeText(raw)
      else if(type==='b')value=raw==='1'
      else if(type==='d'){value=String(raw).slice(0,10);row.types[c]='date'}
      else if(raw!=='') {value=Number(raw);if(!Number.isFinite(value))throw new Error('import_invalid_excel')}
      if(typeof value==='number'&&dateStyles[Number(cell['@_s']||0)]){value=dateValue(value,date1904);row.types[c]='date'}
      row.cells[c]=value
      if(cell.f!=null) {
        let formula=String(text(cell.f))
        if(cell.f?.['@_t']==='shared'&&!formula){const origin=shared.get(cell.f['@_si']);if(!origin)throw new Error('import_invalid_excel');formula=sharedFormula(origin.formula,origin,{r,c})}
        if(!formula)throw new Error('import_invalid_excel')
        row.formulas[c]='='+formula;formulaCount++;if(cell.v==null)missingCaches++
      }
    }
    const sheet={id,name:entry['@_name'],sourcePath,originalRows:maxRow,originalColumns:maxCol,headerRows:1,columns,merges,rows,preserveFormulaCache:true}
    let best=0
    for(let r=0;r<Math.min(20,rows.length);r++) {const mapping=partsHeaderMapping(sheet,r+1);if(mapping.score>best){best=mapping.score;sheet.headerRows=r+1}}
    sheet.fieldColumns=partsHeaderMapping(sheet,sheet.headerRows).columns
    book.sheets.push(sheet)
  }
  const candidate=book.sheets.find(s=>partsHeaderMapping(s,s.headerRows).valid)
  book.mainSheetId=candidate?.id||book.sheets[0].id
  book.importTemplateBase64=bytesToBase64(bytes)
  return {book,formulaCount,missingCaches}
}
