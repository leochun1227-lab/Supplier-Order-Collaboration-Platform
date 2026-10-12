import { PARTS_FIELDS, sheetValues } from './parts-workbook.mjs'

export function orderDate(value) {
  let date = String(value ?? '').trim()
  if (/^\d{8}$/.test(date)) date = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date)) return ''
  date = date.slice(0,10)
  const time = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === date ? date : ''
}

export function eligibleSapDate(value, cutoff) {
  const date = orderDate(value)
  return !!cutoff && !!date && date > cutoff
}

export function hiddenSapSupplement(row, dateScope) {
  return dateScope.hidden.has(row.id) || (row.sapOrigin && row.sapOpenPo?.eligible === false)
}

// Only strictly later, verified dates qualify. Keep excluded rows, formulas
// and human work in storage; missing dates never bypass the date boundary.
export function sapWorkbookDateScope(book, sheet = book?.sheets.find(s => s.id === (book.mainSheetId || 's0')), values) {
  const hidden = new Set()
  if (!sheet || sheet.id !== (book.mainSheetId || 's0')) return {cutoff:'',hidden}
  const id = book.importId ? sheet.fieldColumns?.ordered : `s0-c${PARTS_FIELDS.indexOf('ordered')}`
  const column = sheet.columns.findIndex(c => c.id === id)
  values ||= sheetValues(sheet)
  let cutoff = ''
  for (let r = sheet.headerRows; r < sheet.rows.length; r++) {
    if (sheet.rows[r].sapOrigin) continue
    const date = orderDate(values[r][column])
    if (date && (!cutoff || date < cutoff)) cutoff = date
  }
  for (let r = sheet.headerRows; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    if (row.sapOrigin && !eligibleSapDate(values[r][column], cutoff)) hidden.add(row.id)
  }
  return {cutoff,hidden}
}
