import { cloneBook, PARTS_FIELDS } from './parts-workbook.mjs'
import { normalizedIdentity } from './sap-reference.mjs'

const lineKey = (po, item) => `${normalizedIdentity(po)}/${normalizedIdentity(item)}`

// SAP supplies reference facts. Existing China workbook cells, formulas, status,
// notes and formatting are never rewritten by a refresh.
export function mergeSapWorkbook(book, orders, rows, run) {
  if (!book || !run || book.sapRefreshRun === run) return book
  const next = cloneBook(book), sheet = next.sheets.find(s => s.id === (next.mainSheetId || 's0'))
  if (!sheet) return book
  const columns = Object.fromEntries(PARTS_FIELDS.map((field, c) => [field,
    sheet.columns.findIndex(col => col.id === (book.importId ? sheet.fieldColumns?.[field] : `s0-c${c}`))]))
  if (['po', 'line', 'material', 'qty'].some(field => columns[field] < 0)) return book
  const byRow = new Map(orders.map(o => [o.workbookRowId, o])), represented = new Set()
  for (const row of sheet.rows.slice(sheet.headerRows)) {
    const order = byRow.get(row.id)
    const anchor = row.sapAnchor || order?.sapAnchor
    if (anchor) {
      represented.add(lineKey(anchor.po, anchor.item))
      row.sapAnchor = cloneBook(anchor)
      row.sapLineConvention ||= order?.sapLineConvention || 'sap'
    }
    // An edited anchored PO remains linked to its original SAP line.
    if (!anchor) represented.add(lineKey(row.cells[columns.po], row.cells[columns.line]))
  }
  // Ambiguous links remain review items; do not inflate the workbook by adding
  // every possible SAP candidate as a supposedly new order.
  for (const order of orders.filter(o => o.sapReferenceReason === 'ambiguous')) {
    for (const sap of rows) if (normalizedIdentity(sap.EBELN) === normalizedIdentity(order.po) &&
      String(sap.MATNR) === String(order.part) && sap.MENGE === order.qty) represented.add(lineKey(sap.EBELN, sap.EBELP))
  }
  const existingIds = new Set(sheet.rows.map(row => row.id))
  let sequence = Math.max(0, ...sheet.rows.slice(sheet.headerRows).map(r => Number(r.cells[columns.seq]) || 0))
  for (const sap of rows) {
    const key = lineKey(sap.EBELN, sap.EBELP)
    if (represented.has(key)) continue
    const id = `sap-${normalizedIdentity(sap.EBELN)}-${normalizedIdentity(sap.EBELP)}`
    // A deleted/replaced source is never silently overwritten by a generated ID.
    if (existingIds.has(id)) continue
    const fields = {seq: ++sequence, po: sap.EBELN, line: sap.EBELP, material: sap.MATNR,
      description_en: sap.TXZ01 || '', qty: sap.MENGE, ordered: sap.BEDAT || '',
      completion: 'NG'}
    const cells = sheet.columns.map(() => null)
    for (const [field, value] of Object.entries(fields)) if (columns[field] >= 0) cells[columns[field]] = value
    sheet.rows.push({id, cells, formulas: {}, types: {}, sapOrigin: true, sapNewRun: run,
      sapAnchor: {po: String(sap.EBELN), item: String(sap.EBELP)}, sapLineConvention: 'sap',
      importKey: JSON.stringify([String(sap.EBELN), String(sap.EBELP), String(sap.MATNR || '')])})
    represented.add(key)
  }
  next.sapRefreshRun = run
  return next
}
