import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PUBLIC_DATABASE,connectPublicWorkspace} from '../src/public-firebase-store.mjs'
import {createPartsWorkbookStore} from '../src/parts-workbook-store.mjs'
import {cloneBook,setCell,deleteRows} from '../src/parts-workbook.mjs'

const id=`verification-link-${crypto.randomUUID()}`
const base=`${PUBLIC_DATABASE}/supplierCollaboration/workspaces/${id}`
const clients=[]
let created=false
async function json(url,options){const response=await fetch(url,{signal:AbortSignal.timeout(45000),...options});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}
try{
  const source=await json(`${PUBLIC_DATABASE}/supplierCollaboration/workspaces/excel-20260904/source.json`)
  await json(`${base}/source.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...source,generation:id})});created=true
  const book=JSON.parse(readFileSync(new URL('../public/parts-workbook.json',import.meta.url)))
  const store=createPartsWorkbookStore({path:`supplierCollaboration/workspaces/${id}/partsWorkbook`})
  let stored=await store.initialize(book),a,b
  const errors=[]
  clients.push(await connectPublicWorkspace(p=>a=p,e=>errors.push(e),{workspace:id,interval:60000}))
  clients.push(await connectPublicWorkspace(p=>b=p,e=>errors.push(e),{workspace:id,interval:60000}))
  const originalCount=a.state.orders.length,order=a.state.orders.find(o=>o.workbookRowId==='s0-r4'),orderId=order.id,originalSap=order.sapPart
  setCell(book.sheets[0],'s0-r4',8,'LINK-VERIFICATION-MATERIAL')
  stored=await store.save(book,stored);clients[0].updateWorkbook(stored)
  assert.equal(a.state.orders.find(o=>o.id===orderId).part,'LINK-VERIFICATION-MATERIAL')
  assert.equal(a.state.orders.find(o=>o.id===orderId).sapPart,originalSap)
  await clients[1].refresh()
  assert.equal(b.state.orders.find(o=>o.id===orderId).part,'LINK-VERIFICATION-MATERIAL')
  const comments=cloneBook(b.state);comments.orders.find(o=>o.id===orderId).comments.push({text:'Linked verification note'})
  await clients[1].save(comments,'verification-note',b.revision,id,b.workbookRevision)
  setCell(book.sheets[0],'s0-r4',17,'2026-10-15')
  stored=await store.save(book,stored)
  await clients[0].refresh()
  assert.equal(a.state.orders.find(o=>o.id===orderId).chinaEta,'2026-10-15')
  assert.equal(a.state.orders.find(o=>o.id===orderId).comments.at(-1).text,'Linked verification note')
  await assert.rejects(clients[1].save(comments,'verification-stale',b.revision,id,b.workbookRevision),/save_conflict/)
  const restorable=cloneBook(book)
  deleteRows(book.sheets[0],['s0-r4']);stored=await store.save(book,stored);clients[0].updateWorkbook(stored)
  assert.equal(a.state.orders.length,originalCount-1);assert.equal(a.summary.masterRecords,originalCount-1)
  assert.ok(!a.state.shipments.some(s=>s.allocations?.some(x=>x.order===orderId)))
  const later=cloneBook(a.state);later.orders[0].comments.push({text:'Another record remains editable'})
  await clients[0].save(later,'verification-after-delete',a.revision,id,a.workbookRevision)
  stored=await store.save(restorable,stored)
  await clients[1].refresh()
  const restored=b.state.orders.find(o=>o.id===orderId)
  assert.equal(b.state.orders.length,originalCount)
  assert.equal(restored.comments.at(-1).text,'Linked verification note')
  assert.equal(restored.chinaEta,'2026-10-15')
  assert.equal(errors.length,0)
  console.log('PASS: Firebase workbook edits update both workspace clients, material/SAP separation, dates, retained notes, stale-editor conflicts, row deletion/counts, and undo after another save.')
}finally{
  await Promise.all(clients.map(c=>c.disconnect()))
  if(created&&await json(`${base}/source/generation.json`)===id){await json(`${base}.json`,{method:'DELETE'});console.log('Temporary workspace removed. Live orders and workbook unchanged.')}
}
