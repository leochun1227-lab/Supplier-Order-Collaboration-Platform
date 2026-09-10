import { readFile } from 'node:fs/promises'
import { adminDatabase, requirePrivatePath } from './firebase-admin.mjs'
const file=process.argv[2]
if(!file)throw new Error('Usage: node scripts/publish-excel-import.mjs LOCAL_IMPORT.json [--commit]')
const batch=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''))
if(batch.schemaVersion!==1||batch.kind!=='excel-initialization-staging'||!/^excel-[a-f0-9]{24}$/.test(batch.batchId)||!batch.records||Object.keys(batch.records).length!==batch.summary?.masterRecords)throw new Error('Invalid import package.')
if(!process.argv.includes('--commit')){console.log(JSON.stringify({mode:'validation_only',batchId:batch.batchId,summary:batch.summary}));process.exit(0)}
await requirePrivatePath('supplierCollaboration/imports')
const db=adminDatabase(),target=db.ref(`supplierCollaboration/imports/${batch.batchId}`)
// Same files produce the same ID. Never overwrite a prior import or web operations.
const old=(await target.get()).val()
if(old){if(old.contentHash!==batch.contentHash)throw new Error('Import identity conflict.');console.log('This import already exists; no changes made.');process.exit(0)}
const result=await target.transaction(value=>value===null?{contentHash:batch.contentHash,importedAt:Date.now(),schemaVersion:1,summary:batch.summary,payloadJson:JSON.stringify(batch)}:undefined)
if(!result.committed)throw new Error('Concurrent import detected; retry to verify the existing hash.')
console.log(JSON.stringify({imported:true,batchId:batch.batchId,summary:batch.summary}))
process.exit(0)
