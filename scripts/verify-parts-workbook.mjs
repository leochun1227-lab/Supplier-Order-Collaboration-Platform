import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPartsWorkbookStore } from '../src/parts-workbook-store.mjs'
import { PUBLIC_DATABASE } from '../src/public-firebase-store.mjs'
import { cloneBook, setCell, insertRow, deleteRows, insertColumn, deleteColumn } from '../src/parts-workbook.mjs'
const seed = JSON.parse(readFileSync(new URL('../public/parts-workbook.json', import.meta.url)))
const path = `supplierCollaboration/workspaces/verification-parts-${crypto.randomUUID()}/partsWorkbook`
const store = createPartsWorkbookStore({path}), peer = createPartsWorkbookStore({path})
let created = false
try {
  const initial = await store.initialize(seed); created = true
  const stale = await peer.load(), edited = cloneBook(initial.book), sheet = edited.sheets[0]
  setCell(sheet, sheet.rows[3].id, 26, 'VERIFICATION ONLY')
  setCell(sheet, sheet.rows[3].id, 19, '0')
  const added = insertRow(sheet); insertColumn(sheet)
  const saved = await store.save(edited, initial)
  assert.deepEqual((await peer.load()).book, edited)
  await assert.rejects(peer.save(seed, stale), /save_conflict/)
  deleteRows(sheet, [added]); deleteColumn(sheet, sheet.columns.length - 1)
  setCell(sheet, sheet.rows[3].id, 26, '')
  await store.save(edited, saved)
  assert.deepEqual((await peer.load()).book, edited)
  console.log('PASS: actual Firebase write, reload, zero/blank, add/delete rows and columns, stale-write rejection.')
} finally {
  if (created) {
    const removed = await fetch(`${PUBLIC_DATABASE}/${path}.json`, {method:'DELETE'})
    if (!removed.ok) throw new Error(`Verification cleanup failed: ${removed.status}`)
    console.log('Temporary verification workbook removed.')
  }
}
if (process.argv.includes('--initialize')) {
  const live = await createPartsWorkbookStore().initialize(seed)
  assert.equal(live.book.sourceHash, seed.sourceHash)
  console.log(`Parts workbook ready in Firebase, revision ${live.revision}; existing data preserved.`)
}
