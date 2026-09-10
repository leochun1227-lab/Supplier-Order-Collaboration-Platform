import {mkdir,writeFile} from 'node:fs/promises'
import {classifyOrders,purposeRule} from './order-purpose.mjs'
import {PUBLIC_DATABASE} from '../src/public-firebase-store.mjs'
const url=`${PUBLIC_DATABASE}/supplierCollaboration/workspaces/excel-20260904/source.json`
const response=await fetch(url,{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(45000)})
if(!response.ok)throw new Error(`Read HTTP ${response.status}`)
const source=await response.json(),original=JSON.stringify(source),data=JSON.parse(source.dataJson)
if(source.kind!=='excel'||source.schemaVersion!==1||!Array.isArray(data.orders))throw new Error('Unexpected source')
const changes=classifyOrders(data.orders)
const totals={}
for(const o of data.orders)totals[o.type]=(totals[o.type]||0)+1
console.log(JSON.stringify({plannedChanges:changes.length,totals}))
if(!process.argv.includes('--commit'))process.exit(0)
if(!process.argv.includes('--public-test'))throw new Error('Explicit public-test authorization required')
if(!changes.length){console.log('Already classified; no write needed.');process.exit(0)}
await mkdir('outputs/purpose-classification',{recursive:true})
await writeFile(`outputs/purpose-classification/${Date.now()}-source-before.json`,original)
// The raw Excel import and collaboration revisions remain intact. Type is a
// source-owned field, so stale collaboration snapshots cannot undo this change.
source.dataJson=JSON.stringify(data)
source.purposeClassification={rule:purposeRule,changedRecords:changes.length,at:new Date().toISOString(),changes}
const etag=response.headers.get('etag')
if(!etag)throw new Error('Conditional write unavailable')
const saved=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(source),signal:AbortSignal.timeout(45000)})
if(!saved.ok)throw new Error(`Write HTTP ${saved.status}; source was not overwritten on conflict`)
const checked=await fetch(url,{signal:AbortSignal.timeout(45000)})
if(!checked.ok)throw new Error(`Verification HTTP ${checked.status}`)
const verified=await checked.json()
if(verified.dataJson!==source.dataJson||verified.purposeClassification?.rule!==purposeRule)throw new Error('Read-back mismatch')
console.log(JSON.stringify({verified:true,changed:changes.length,totals}))
