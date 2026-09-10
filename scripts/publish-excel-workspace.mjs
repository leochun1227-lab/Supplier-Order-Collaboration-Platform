import { readFile } from 'node:fs/promises'
import { excelWorkspace } from './excel-workspace.mjs'
import { databaseURL } from './firebase-admin.mjs'
const batch=JSON.parse(await readFile(process.argv[2],'utf8')),source=excelWorkspace(batch)
if(!process.argv.includes('--public-test'))throw new Error('Explicit --public-test authorization is required.')
const url=`${databaseURL}/supplierCollaboration/workspaces/excel-20260904/source.json`
const read=await fetch(url,{headers:{'X-Firebase-ETag':'true'}})
if(!read.ok)throw new Error(`Read HTTP ${read.status}`)
const old=await read.json()
if(old){
  if(old.generation===source.generation){console.log('Workspace already initialized.');process.exit(0)}
  if(!process.argv.includes('--update-empty')||old.importBatch!==source.importBatch)throw new Error('Existing workspace source differs; do not overwrite.')
  const versions=await fetch(`${databaseURL}/supplierCollaboration/workspaces/excel-20260904/versions.json?shallow=true`)
  if(!versions.ok||await versions.json()!==null)throw new Error('Workspace has operations; source migration requires review.')
}
const {data,...metadata}=source
const result=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':read.headers.get('etag')},body:JSON.stringify({...metadata,dataJson:JSON.stringify(data)}),signal:AbortSignal.timeout(60000)})
if(!result.ok)throw new Error(`Write HTTP ${result.status}`)
const verified=await (await fetch(url)).json(),loaded=JSON.parse(verified.dataJson)
if(loaded.orders.length!==1253||verified.generation!==source.generation)throw new Error('Verification failed')
console.log(JSON.stringify({verified:true,orders:loaded.orders.length,dispatchSummaries:loaded.shipments.length,completion:source.summary.masterCompletion}))
