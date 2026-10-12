import { pathToFileURL } from 'node:url'
import { connectPublicWorkspace, PUBLIC_DATABASE } from '../src/public-firebase-store.mjs'
import { createPartsWorkbookStore } from '../src/parts-workbook-store.mjs'

// This process talks only to Firebase. SAP extraction runs separately in Python.
// Reuse the web application's append-only merge and conditional workbook saves.
export async function syncWorkbookFromSap({fetcher=fetch,databaseURL=PUBLIC_DATABASE,workspace='excel-20260904',connect=connectPublicWorkspace}={}) {
  if(!/^[a-z0-9-]+$/.test(workspace))throw new Error('invalid_workspace')
  const store=createPartsWorkbookStore({fetcher,databaseURL,path:`supplierCollaboration/workspaces/${workspace}/partsWorkbook`})
  for(let attempt=0;attempt<3;attempt++) {
    let cloud,packet
    const errors=[]
    try {
      cloud=await connect(value=>{packet=value},error=>{errors.push(error)},
        {workspace,fetcher,databaseURL,interval:3600000})
      if(errors.length)throw errors[0]
      if(!packet?.summary?.workbookRevision)throw new Error('workbook_not_ready')
      if(packet.state.orders.some(o=>o.sapReferenceRefreshError))throw new Error('sap_snapshot_unavailable')
      const [saved,response]=await Promise.all([store.load(),fetcher(`${databaseURL}/supplierCollaboration/sap/current.json`,{signal:AbortSignal.timeout(45000)})])
      if(!response.ok)throw new Error('sap_snapshot_unavailable')
      const pointer=await response.json()
      if(!pointer?.run||saved.book?.sapRefreshRun!==pointer.run)throw new Error('save_conflict')
      const result={status:'complete',checkedAt:Date.now(),workspace,sapRun:pointer.run,workbookRevision:saved.revision,
        records:packet.summary.masterRecords,completion:packet.summary.masterCompletion}
      const published=await fetcher(`${databaseURL}/supplierCollaboration/sync/workbookLastCheck.json`,{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(result),signal:AbortSignal.timeout(45000)})
      if(!published.ok)throw new Error('workbook_check_publish_failed')
      return result
    } catch(error) {
      if(error.message!=='save_conflict'||attempt===2)throw error
    } finally { await cloud?.disconnect() }
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await syncWorkbookFromSap())) }
  catch(error) {
    const allowed=new Set(['invalid_workspace','workbook_not_ready','sap_snapshot_unavailable','save_conflict','workbook_check_publish_failed'])
    console.error(JSON.stringify({status:'failed',stage:'firebase_workbook',error:allowed.has(error.message)?error.message:'workbook_sync_failed'}))
    process.exitCode=1
  }
}
