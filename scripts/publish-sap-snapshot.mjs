import { readFile } from 'node:fs/promises'
import { adminDatabase, requirePrivatePath } from './firebase-admin.mjs'
import { buildSnapshot } from './sap-snapshot.mjs'
const path=process.argv[2]
if(!path)throw new Error('Usage: node scripts/publish-sap-snapshot.mjs LOCAL_SNAPSHOT.json [--dry-run]')
const snapshot=buildSnapshot(JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,'')))
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({valid:true,counts:snapshot.counts,hash:snapshot.hash}));process.exit(0)}
await requirePrivatePath('supplierCollaboration/sap')
const db=adminDatabase(),current=db.ref('supplierCollaboration/sap/current'),previous=(await current.get()).val()
if(previous?.hash===snapshot.hash){await db.ref('supplierCollaboration/sync/lastSuccessfulCheck').set(Date.now());console.log('No source changes; existing snapshot retained.');process.exit(0)}
const run=`${snapshot.startedAt}-${crypto.randomUUID()}`
// Whole generation is staged before advancing the pointer. Collaboration is never touched.
await db.ref(`supplierCollaboration/sap/runs/${run}`).set(snapshot)
const result=await current.transaction(old=>old?.startedAt>snapshot.startedAt?undefined:{run,hash:snapshot.hash,startedAt:snapshot.startedAt,finishedAt:snapshot.finishedAt,counts:snapshot.counts})
await db.ref(`supplierCollaboration/sync/runs/${run}`).set({status:result.committed?'complete':'superseded',at:Date.now(),counts:snapshot.counts})
console.log(result.committed?'SAP source snapshot published; collaboration data unchanged.':'A newer run is already current; pointer unchanged.')
process.exit(0)
