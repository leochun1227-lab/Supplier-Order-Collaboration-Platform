import { readFile } from 'node:fs/promises'
import { adminDatabase, requirePrivatePath } from './firebase-admin.mjs'
import { databaseURL } from './firebase-admin.mjs'
const file=process.argv[2]
if(!file)throw new Error('Usage: node scripts/publish-excel-import.mjs LOCAL_IMPORT.json [--commit]')
const batch=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''))
if(batch.schemaVersion!==1||batch.kind!=='excel-initialization-staging'||!/^excel-[a-f0-9]{24}$/.test(batch.batchId)||!batch.records||Object.keys(batch.records).length!==batch.summary?.masterRecords)throw new Error('Invalid import package.')
if(!process.argv.includes('--commit')){console.log(JSON.stringify({mode:'validation_only',batchId:batch.batchId,summary:batch.summary}));process.exit(0)}
if(process.argv.includes('--public-test')){
  // Explicit user-authorized public test mode. Never an automatic auth fallback.
  const url=`${databaseURL}/supplierCollaboration/imports/${batch.batchId}.json`
  const response=await fetch(url,{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw new Error(`Import read HTTP ${response.status}`)
  const old=await response.json()
  if(old){if(old.contentHash!==batch.contentHash)throw new Error('Import identity conflict');console.log('Identical import already exists; unchanged.');process.exit(0)}
  const write=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':response.headers.get('etag')},body:JSON.stringify({contentHash:batch.contentHash,importedAt:{'.sv':'timestamp'},schemaVersion:1,summary:batch.summary,payloadJson:JSON.stringify(batch)}),signal:AbortSignal.timeout(60000)})
  if(!write.ok)throw new Error(`Import write HTTP ${write.status}`)
  const verified=await (await fetch(`${databaseURL}/supplierCollaboration/imports/${batch.batchId}/contentHash.json`)).json()
  if(verified!==batch.contentHash)throw new Error('Import verification failed')
  console.log(JSON.stringify({imported:true,verified:true,access:'public-test',batchId:batch.batchId,summary:batch.summary}));process.exit(0)
}
await requirePrivatePath('supplierCollaboration/imports')
const db=adminDatabase(),target=db.ref(`supplierCollaboration/imports/${batch.batchId}`)
// Same files produce the same ID. Never overwrite a prior import or web operations.
const old=(await target.get()).val()
if(old){if(old.contentHash!==batch.contentHash)throw new Error('Import identity conflict.');console.log('This import already exists; no changes made.');process.exit(0)}
const result=await target.transaction(value=>value===null?{contentHash:batch.contentHash,importedAt:Date.now(),schemaVersion:1,summary:batch.summary,payloadJson:JSON.stringify(batch)}:undefined)
if(!result.committed)throw new Error('Concurrent import detected; retry to verify the existing hash.')
console.log(JSON.stringify({imported:true,batchId:batch.batchId,summary:batch.summary}))
process.exit(0)
