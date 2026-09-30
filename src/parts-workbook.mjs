export const cloneBook = value => JSON.parse(JSON.stringify(value))
export const PARTS_FIELDS = ['seq','mode','po','line','van','description_zh','description_en','supplier_reference','material','qty','category','so','buyer','ordered','agreed_etd','planned_etd','manager','eta_china','actual_ship','shipped','remaining','loaded_van','location','container','awb','completion','notes']
const headerAliases = [
  ['序号No.','序号','No.'],['属性Attribute','属性','Attribute','运输方式'],['订单号Purchase Order','订单号','Purchase Order','PO'],['Line No','行号','订单行','PO Item'],
  ['车架号Van number:','车架号','Van number'],['物品名称Description','物品名称','中文名称'],['Description','英文名称'],['供应商Supplier（历史来料数据 仅供参考）','供应商Supplier','供应商','Supplier'],
  ['SAP料号Stockcode','SAP料号','Stockcode','Material','料号'],['需求数量Qty','需求数量','Qty','Quantity'],['分类Category','分类','Category'],['销售凭证Sales Doc','销售凭证','Sales Doc'],
  ['订货人Order By','订货人','Order By'],['订货时间Order Date','订货时间','Order Date'],['约定发运时间Agreed ETD','约定发运时间','Agreed ETD'],['计划发运时间ETD','计划发运时间','ETD'],
  ['采购经理Purchase Manager','采购经理','Purchase Manager'],['计划到货时间（采购提供的到货时间）ETA China','计划到货时间ETA China','计划到货时间','ETA China'],
  ['实际发运时间Actual Ship Date','实际发运时间','Actual Ship Date'],['实发数量Shipped Qty','实发数量','Shipped Qty'],['剩余未发数量Remaining Qty','剩余未发数量','Remaining Qty'],
  ['海运车架号VAN(Container)','海运车架号','VAN(Container)'],['位置Location','位置','Location'],['集装箱号Container No.','集装箱号','Container No.'],['空运单号AWB No.','空运单号','AWB No.'],
  ['评价Completion Status','评价','Completion Status'],['备注Remarks','备注','Remarks']
]
const normalizeHeader = value => String(value??'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')
export function partsHeaderMapping(sheet,headerRows) {
  const columns={},duplicates=[]
  const row=sheet?.rows[headerRows-1]
  if(row)row.cells.forEach((value,c)=>{
    const key=normalizeHeader(value), index=headerAliases.findIndex(aliases=>aliases.some(alias=>normalizeHeader(alias)===key))
    if(!key||index<0)return
    const field=PARTS_FIELDS[index]
    if(columns[field])duplicates.push(field)
    columns[field]=sheet.columns[c].id
  })
  const missing=['po','line','material','qty'].filter(field=>!columns[field])
  return {columns,missing,duplicates,score:Object.keys(columns).length,valid:!missing.length&&!duplicates.length}
}
export function preparePartsReplacement(book,importId) {
  const result=cloneBook(book)
  result.importId=importId;result.importedAt=new Date().toISOString()
  for(const sheet of result.sheets) {
    sheet.fieldColumns=partsHeaderMapping(sheet,sheet.headerRows).columns
    const positions=new Map(sheet.columns.map((col,c)=>[col.id,c])),keys=new Map()
    for(const row of sheet.rows.slice(sheet.headerRows)) {
      const fields=['po','line','material'].map(field=>String(row.cells[positions.get(sheet.fieldColumns[field])]??'').trim())
      row.importKey=fields.every(value=>value&&!['/','—','-'].includes(value))?JSON.stringify(fields):null
      if(row.importKey)keys.set(row.importKey,(keys.get(row.importKey)||0)+1)
    }
    // Ambiguous source identities must not acquire a match later just because a
    // duplicate row is removed. Anchors survive subsequent edits and row movement.
    for(const row of sheet.rows.slice(sheet.headerRows))if(keys.get(row.importKey)>1)row.importKey=null
  }
  return result
}
export const dimensionLimits = {column:{min:48,max:1200},row:{min:24,max:546}}
export function setDimension(sheet, axis, id, pixels) {
  if (!dimensionLimits[axis]) throw new Error('invalid_dimension')
  const target = (axis === 'column' ? sheet.columns : sheet.rows).find(item => item.id === id)
  if (!target) throw new Error('missing_dimension')
  const key = axis === 'column' ? 'widthPx' : 'heightPx'
  if (pixels == null) { delete target[key]; return }
  if (typeof pixels !== 'number' || !Number.isFinite(pixels)) throw new Error('invalid_dimension')
  const {min,max} = dimensionLimits[axis]
  target[key] = Math.max(min, Math.min(max, Math.round(pixels)))
}
export const validCellFill = color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
export function cellFill(sheet, row, col) {
  const color = row?.fills?.[sheet.columns[col]?.id]
  return validCellFill(color) ? color.toUpperCase() : ''
}
export function setCellFill(sheet, rowId, col, color) {
  const row = sheet.rows.find(row => row.id === rowId), column = sheet.columns[col]
  if (!row || !column) throw new Error('missing_cell')
  if (color !== '' && !validCellFill(color)) throw new Error('invalid_fill')
  if (color) { row.fills ||= {}; row.fills[column.id] = color.toUpperCase() }
  else if (row.fills) { delete row.fills[column.id]; if (!Object.keys(row.fills).length) delete row.fills }
}
export function columnName(index) {
  let name = ''
  for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name
  return name
}
export function columnIndex(name) { return [...name.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 }
const dateSerial = value => (Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000
const serialDate = value => new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10)
export const externalFormula = formula => /\[|VLOOKUP/i.test(formula || '')

// A deliberately bounded parser. Never execute workbook text as JavaScript.
function calculate(formula, resolve) {
  const input = formula.slice(1).toUpperCase().replace(/\$/g, '').replace(/\s/g, '')
  const tokens = input.match(/#REF!|SUM|[A-Z]+[1-9]\d*|(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/,:]/g) || []
  if (tokens.join('') !== input) throw new Error('unsupported_formula')
  let at = 0
  const numeric = v => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return dateSerial(v); if (typeof v === 'string' && v.startsWith('#')) throw new Error(v); throw new Error('#VALUE!') }
  const reference = token => { const m = /^([A-Z]+)([1-9]\d*)$/.exec(token || ''); if (!m) throw new Error('unsupported_formula'); return [Number(m[2]) - 1, columnIndex(m[1])] }
  function primary() {
    const token = tokens[at++]
    if (token === '#REF!') throw new Error('#REF!')
    if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * primary()
    if (token === '(') { const n = expression(); if (tokens[at++] !== ')') throw new Error('unsupported_formula'); return n }
    if (token === 'SUM') {
      if (tokens[at++] !== '(') throw new Error('unsupported_formula')
      let sum = 0
      do {
        const start = reference(tokens[at++]); let end = start
        if (tokens[at] === ':') { at++; end = reference(tokens[at++]) }
        if ((Math.abs(end[0] - start[0]) + 1) * (Math.abs(end[1] - start[1]) + 1) > 100000) throw new Error('#REF!')
        for (let r = Math.min(start[0], end[0]); r <= Math.max(start[0], end[0]); r++) for (let c = Math.min(start[1], end[1]); c <= Math.max(start[1], end[1]); c++) {
          const value = resolve(r, c)
          if (typeof value === 'number') sum += value
          else if (typeof value === 'string' && value.startsWith('#')) throw new Error(value)
        }
      } while (tokens[at] === ',' && ++at)
      if (tokens[at++] !== ')') throw new Error('unsupported_formula')
      return sum
    }
    if (/^[A-Z]+\d+$/.test(token || '')) return numeric(resolve(...reference(token)))
    if (token && /^\d|^\.\d/.test(token)) return Number(token)
    throw new Error('unsupported_formula')
  }
  function product() { let n = primary(); while (tokens[at] === '*' || tokens[at] === '/') { const op = tokens[at++], right = primary(); if (op === '/' && right === 0) throw new Error('#DIV/0!'); n = op === '*' ? n * right : n / right } return n }
  function expression() { let n = product(); while (tokens[at] === '+' || tokens[at] === '-') { const op = tokens[at++], right = product(); n = op === '+' ? n + right : n - right } return n }
  const result = expression()
  if (at !== tokens.length || !Number.isFinite(result)) throw new Error('unsupported_formula')
  return result
}
export function sheetValues(sheet) {
  const memo = new Map(), visiting = new Set()
  function get(r, c) {
    if (!sheet.rows[r] || !sheet.columns[c]) return '#REF!'
    const key = `${r}:${c}`, row = sheet.rows[r], formula = row.formulas[c]
    if (memo.has(key)) return memo.get(key)
    if (!formula || externalFormula(formula)) return row.cells[c]
    if (visiting.has(key)) return '#CYCLE!'
    visiting.add(key)
    let value
    try { value = calculate(formula, get); if (row.types[c] === 'date') value = serialDate(value) }
    catch (error) { value = error.message === 'unsupported_formula' ? (sheet.preserveFormulaCache ? row.cells[c] : '#FORMULA!') : error.message }
    visiting.delete(key); memo.set(key, value); return value
  }
  return sheet.rows.map((row, r) => row.cells.map((_, c) => get(r, c)))
}
export function setCell(sheet, rowId, col, input) {
  const row = sheet.rows.find(r => r.id === rowId)
  if (!row || !sheet.columns[col]) throw new Error('missing_cell')
  const text = String(input)
  if (text.startsWith('=')) {
    if (externalFormula(text)) throw new Error('unsupported_formula')
    try { calculate(text, () => 1) } catch (e) { if (e.message === 'unsupported_formula') throw e }
    row.formulas[col] = text
    return
  }
  delete row.formulas[col]
  if (text.startsWith("'")) { row.cells[col] = text.slice(1); delete row.types[col]; return }
  if (text === '') { row.cells[col] = null; return }
  if (row.types[col] === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) throw new Error('invalid_date')
    row.cells[col] = text; return
  }
  row.cells[col] = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && Number.isSafeInteger(Number(text.split('.')[0])) ? Number(text) : text
}

function shiftReferences(sheet, axis, at, delta) {
  for (const row of sheet.rows) for (const c of Object.keys(row.formulas)) {
    const formula = row.formulas[c]
    if (externalFormula(formula)) continue
    row.formulas[c] = formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (all, ac, name, ar, number) => {
      let index = axis === 'row' ? Number(number) - 1 : columnIndex(name)
      if (delta < 0 && index === at) return '#REF!'
      if (index >= at) index += delta
      return axis === 'row' ? `${ac}${name}${ar}${index + 1}` : `${ac}${columnName(index)}${ar}${number}`
    })
  }
  for (const merge of sheet.merges) {
    const start = axis === 'row' ? 'r' : 'c', span = axis === 'row' ? 'rows' : 'cols'
    if (at < merge[start]) merge[start] += delta
    else if (at < merge[start] + merge[span]) merge[span] += delta
  }
  sheet.merges = sheet.merges.filter(m => m.rows > 0 && m.cols > 0)
}
export function insertRow(sheet, at = sheet.rows.length) {
  at = Math.max(sheet.headerRows, Math.min(at, sheet.rows.length))
  shiftReferences(sheet, 'row', at, 1)
  const row = { id: crypto.randomUUID(), cells: sheet.columns.map(() => null), formulas: {}, types: {} }
  sheet.rows.splice(at, 0, row); return row.id
}
export function deleteRows(sheet, ids) {
  for (let r = sheet.rows.length - 1; r >= sheet.headerRows; r--) if (ids.includes(sheet.rows[r].id)) { shiftReferences(sheet, 'row', r, -1); sheet.rows.splice(r, 1) }
}
export function insertColumn(sheet, at = sheet.columns.length) {
  shiftReferences(sheet, 'column', at, 1)
  sheet.columns.splice(at, 0, { id: crypto.randomUUID() })
  for (const row of sheet.rows) { row.cells.splice(at, 0, null); for (const key of ['formulas', 'types']) row[key] = Object.fromEntries(Object.entries(row[key]).map(([c, v]) => [Number(c) >= at ? Number(c) + 1 : c, v])) }
}
export function deleteColumn(sheet, at) {
  if (sheet.columns.length <= 1) throw new Error('last_column')
  for (const row of sheet.rows) if (row.fills) { delete row.fills[sheet.columns[at].id]; if (!Object.keys(row.fills).length) delete row.fills }
  shiftReferences(sheet, 'column', at, -1); sheet.columns.splice(at, 1)
  for (const row of sheet.rows) { row.cells.splice(at, 1); for (const key of ['formulas', 'types']) row[key] = Object.fromEntries(Object.entries(row[key]).filter(([c]) => Number(c) !== at).map(([c, v]) => [Number(c) > at ? Number(c) - 1 : c, v])) }
}
export function filteredRows(sheet, values, search = '', filters = {}, sort = null) {
  const query = search.toLocaleLowerCase()
  const result = sheet.rows.map((row, index) => ({ row, index })).slice(sheet.headerRows).filter(({ index }) => {
    const cells = values[index]
    return (!query || cells.some(v => String(v ?? '').toLocaleLowerCase().includes(query))) && Object.entries(filters).every(([c, filter]) => {
      const value = String(cells[c] ?? '')
      if (filter && typeof filter === 'object') {
        return (filter.mode !== 'blank' || value === '') && (filter.mode !== 'nonblank' || value !== '') &&
          (!filter.query || value.toLocaleLowerCase().includes(filter.query.toLocaleLowerCase())) &&
          (filter.values == null || filter.values.includes(value))
      }
      return filter === '__BLANK__' ? value === '' : filter === '__NONBLANK__' ? value !== '' : value.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    })
  })
  if (sort) result.sort((a, b) => { const x = values[a.index][sort.col], y = values[b.index][sort.col]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'zh-CN', { numeric: true })) * sort.direction })
  return result
}
