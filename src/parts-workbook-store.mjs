import { PUBLIC_DATABASE } from './public-firebase-store.mjs'
import { retainSapWorkbookRows } from './sap-workbook-sync.mjs'
export const PARTS_WORKBOOK_PATH = 'supplierCollaboration/workspaces/excel-20260904/partsWorkbook'
// Keep the original XLSX package separate from cell JSON: RTDB limits each
// individual string to 10 MiB, even when the overall request is smaller than its limit.
export function decodePartsWorkbook(data, previous = false) {
  const json = data?.[previous ? 'previousBookJson' : 'bookJson']
  if (!json) return null
  const book = JSON.parse(json), template = data[previous ? 'previousTemplateBase64' : 'templateBase64']
  if (typeof template === 'string') book.importTemplateBase64 = template
  else if (Array.isArray(template)) book.importTemplateBase64 = template.join('')
  return book
}
function encodePartsWorkbook(book) {
  const {importTemplateBase64, ...cells} = book
  const template = typeof importTemplateBase64 === 'string' ? [] : undefined
  if (template) for(let i=0;i<importTemplateBase64.length;i+=4000000)template.push(importTemplateBase64.slice(i,i+4000000))
  return {json:JSON.stringify(cells),template}
}

export function createPartsWorkbookStore({ fetcher = fetch, databaseURL = PUBLIC_DATABASE, path = PARTS_WORKBOOK_PATH } = {}) {
  const url = `${databaseURL}/${path}.json`
  const templateUrl = key => `${databaseURL}/${path}Templates/${key}.json`
  async function restoreTemplate(book) {
    if (!book || book.importTemplateBase64 || !/^[a-f0-9]{64}$/.test(book.templateRef || '')) return
    const response = await fetcher(templateUrl(book.templateRef),{signal:AbortSignal.timeout(45000)})
    if (!response.ok) throw new Error('workbook_template_unavailable')
    const chunks = await response.json()
    if (!Array.isArray(chunks) || !chunks.every(c=>typeof c==='string')) throw new Error('workbook_template_unavailable')
    book.importTemplateBase64 = chunks.join('')
  }
  async function request(options = {}) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(45000), ...options })
    if (!response.ok) throw new Error(response.status === 412 ? 'save_conflict' : `firebase_http_${response.status}`)
    return response
  }
  function packet(data, etag) {
    if (!data || data.schemaVersion !== 1 || typeof data.bookJson !== 'string') throw new Error('invalid_workbook')
    const book = decodePartsWorkbook(data)
    if (!book.sheets?.length) throw new Error('invalid_workbook')
    return { book, revision: data.revision, savedAt: data.savedAt, operationId: data.operationId, etag, backupBook: decodePartsWorkbook(data, true) }
  }
  async function load() {
    const response = await request({ headers: { 'X-Firebase-ETag': 'true' } })
    const data = await response.json()
    if (data === null) return { book: null, revision: 0, etag: response.headers.get('etag') }
    const result = packet(data, response.headers.get('etag'))
    await Promise.all([restoreTemplate(result.book),restoreTemplate(result.backupBook)])
    return result
  }
  async function save(book, base, backupBook = base.backupBook) {
    if (!base.etag) throw new Error('missing_etag')
    const operationId = crypto.randomUUID()
    // A content-addressed copy survives older open clients saving just bookJson.
    // Publish it before the conditional workbook write; an unused immutable
    // template after a conflict is harmless and never changes workbook cells.
    if (book.importTemplateBase64 && /^[a-f0-9]{64}$/.test(book.sourceHash || '')) {
      if (base.book?.templateRef !== book.sourceHash) {
        const response = await fetcher(templateUrl(book.sourceHash),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(encodePartsWorkbook(book).template),signal:AbortSignal.timeout(45000)})
        if(!response.ok)throw new Error('workbook_template_save_failed')
      }
      book = {...book,templateRef:book.sourceHash}
    }
    const encoded = encodePartsWorkbook(book)
    const body = { schemaVersion: 1, revision: base.revision + 1, operationId, savedAt: { '.sv': 'timestamp' }, bookJson: encoded.json }
    if (encoded.template) body.templateBase64 = encoded.template
    if (backupBook) {
      const previous = encodePartsWorkbook(backupBook)
      body.previousBookJson = previous.json
      if (previous.template) body.previousTemplateBase64 = previous.template
    }
    try {
      await request({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': base.etag }, body: JSON.stringify(body) })
    } catch (error) {
      // Resolve an interrupted acknowledgement without submitting the edit twice.
      const current = await load().catch(() => null)
      if (current?.operationId === operationId) return current
      throw error
    }
    const current = await load()
    if (current.operationId !== operationId) throw new Error('save_conflict')
    return current
  }
  async function initialize(seed) {
    const current = await load()
    if (current.book) return current
    try { return await save(seed, current) } catch (error) { if (error.message === 'save_conflict') return load(); throw error }
  }
  // Backup and replacement share one conditional write: no partially replaced workbook.
  async function replace(book, base, { preserveSap = true } = {}) {
    return save(preserveSap ? retainSapWorkbookRows(book, base.book) : book, base, base.book)
  }
  return { load, save, initialize, replace }
}
