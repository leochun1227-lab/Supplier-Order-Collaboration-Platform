import { PUBLIC_DATABASE } from './public-firebase-store.mjs'
export const PARTS_WORKBOOK_PATH = 'supplierCollaboration/workspaces/excel-20260904/partsWorkbook'

export function createPartsWorkbookStore({ fetcher = fetch, databaseURL = PUBLIC_DATABASE, path = PARTS_WORKBOOK_PATH } = {}) {
  const url = `${databaseURL}/${path}.json`
  async function request(options = {}) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(45000), ...options })
    if (!response.ok) throw new Error(response.status === 412 ? 'save_conflict' : `firebase_http_${response.status}`)
    return response
  }
  function packet(data, etag) {
    if (!data || data.schemaVersion !== 1 || typeof data.bookJson !== 'string') throw new Error('invalid_workbook')
    const book = JSON.parse(data.bookJson)
    if (!book.sheets?.length) throw new Error('invalid_workbook')
    return { book, revision: data.revision, savedAt: data.savedAt, operationId: data.operationId, etag }
  }
  async function load() {
    const response = await request({ headers: { 'X-Firebase-ETag': 'true' } })
    const data = await response.json()
    return data === null ? { book: null, revision: 0, etag: response.headers.get('etag') } : packet(data, response.headers.get('etag'))
  }
  async function save(book, base) {
    if (!base.etag) throw new Error('missing_etag')
    const operationId = crypto.randomUUID()
    const body = { schemaVersion: 1, revision: base.revision + 1, operationId, savedAt: { '.sv': 'timestamp' }, bookJson: JSON.stringify(book) }
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
  return { load, save, initialize }
}
