import { projectState,hydrateState,changeSummary } from './persistence.mjs'
import { sharedWorkbookState, retainHiddenWorkbookRecords } from './parts-workbook-link.mjs'
import { sheetValues } from './parts-workbook.mjs'
import { loadSapReferences, refreshSapSnapshot, applySapSnapshotReferences } from './sap-reference.mjs'
import { createSapAnchorStore } from './sap-anchor-store.mjs'
import { createPartsWorkbookStore, decodePartsWorkbook } from './parts-workbook-store.mjs'
import { mergeSapWorkbook } from './sap-workbook-sync.mjs'
import { sapWorkbookDateScope } from './parts-workbook-scope.mjs'
export const PUBLIC_DATABASE='https://supplier-collaboration-30ddf-default-rtdb.asia-southeast1.firebasedatabase.app'
export async function connectPublicWorkspace(onChange,onError,{workspace='excel-20260904',fetcher=fetch,interval=15000,databaseURL=PUBLIC_DATABASE,persistSapLinks=true}={}){
  if(!/^[a-z0-9-]+$/.test(workspace))throw new Error('invalid_workspace')
  const base=`${databaseURL}/supplierCollaboration/workspaces/${workspace}`
  async function request(path,options={}){const r=await fetcher(`${base}/${path}.json`,{signal:AbortSignal.timeout(45000),...options});if(!r.ok)throw new Error(r.status===412?'save_conflict':`firebase_http_${r.status}`);return r}
  const source=await (await request('source')).json()
  if(source?.kind!=='excel'||source.schemaVersion!==1)throw new Error('source_not_ready')
  const data=JSON.parse(source.dataJson);let revision=-1,latest={},stopped=false,refreshing=null,workbook=null,workbookRevision=0,workbookSavedAt=null
  await loadSapReferences(data,source,{databaseURL,fetcher})
  let sapRun=null,sapRefreshFailed=false
  const anchorStore=persistSapLinks?createSapAnchorStore({base,generation:source.generation,fetcher}):undefined
  const workbookStore=createPartsWorkbookStore({databaseURL,fetcher,path:`supplierCollaboration/workspaces/${workspace}/partsWorkbook`})
  const compose=()=>{
    const result=sharedWorkbookState(data,latest.stateJson?JSON.parse(latest.stateJson):{},workbook,latest.workbookBaseline)
    if(data.sapRows)applySapSnapshotReferences(result.state,data.sapRows,data.sapSnapshotFinishedAt)
    for(const order of result.state.orders)order.sapReferenceRefreshError=sapRefreshFailed
    return result
  }
  function deliver(){
    const {state}=compose(), summary={...source.summary}
    if(workbook){summary.masterRecords=state.orders.length;summary.masterCompletion={NG:0,OK:0,'澳洲取消订单':0,SAP:0};for(const o of state.orders){const key=o.sapPending?'SAP':o.cancelled?'澳洲取消订单':o.importCompletion||'未评价';summary.masterCompletion[key]=(summary.masterCompletion[key]||0)+1};summary.workbookSheets=workbook.sheets.filter(s=>s.id!==(workbook.mainSheetId||'s0')).map(s=>({name:s.name,values:sheetValues(s)}));summary.workbookRevision=workbookRevision}
    onChange({state,revision,generation:source.generation,savedAt:Math.max(latest.at||0,workbookSavedAt||0)||null,email:'Public test',summary,workbookRevision})
  }
  async function refresh(){
    if(stopped)return
    if(refreshing)return refreshing
    refreshing=(async()=>{
      const response=await fetcher(`${base}/versions.json?shallow=true`,{signal:AbortSignal.timeout(20000)})
      if(!response.ok)throw new Error(`firebase_http_${response.status}`)
      const keys=Object.keys(await response.json()||{}).filter(k=>/^r\d{12}$/.test(k)).sort(),key=keys.at(-1),next=key?Number(key.slice(1)):0
      const [version,parts]=await Promise.all([next>revision&&key?request(`versions/${key}`).then(r=>r.json()):null,request('partsWorkbook').then(r=>r.json())])
      if(stopped)return
      let changed=false
      try{const nextRun=await refreshSapSnapshot(data,{databaseURL,fetcher,previousRun:sapRun,anchorStore});if(nextRun!==sapRun){sapRun=nextRun;changed=true}if(sapRefreshFailed)changed=true;sapRefreshFailed=false;for(const o of data.orders)if(o.sapReferenceRefreshError){o.sapReferenceRefreshError=false;changed=true}}catch{sapRefreshFailed=true;for(const o of data.orders)o.sapReferenceRefreshError=true;changed=true}
      if(next>revision){if(key&&version?.revision!==next)throw new Error('invalid_revision');latest=version||{};revision=next;changed=true}
      if(parts&&parts.revision>workbookRevision){if(parts.schemaVersion!==1||typeof parts.bookJson!=='string')throw new Error('invalid_workbook');workbook=decodePartsWorkbook(parts);workbookRevision=parts.revision;workbookSavedAt=parts.savedAt;changed=true}
      if(workbook&&data.sapRows&&sapRun&&(workbook.sapRefreshRun!==sapRun||workbook.sapStatusVersion!==1||workbook.sapDateScopeVersion!==2||workbook.sapOpenPoVersion!==1||workbook.sapDateCutoff!==sapWorkbookDateScope(workbook).cutoff)){
        try {
          const current=await workbookStore.load()
          if(current.revision!==workbookRevision)throw new Error('save_conflict')
          const merged=mergeSapWorkbook(workbook,compose().state.orders,data.sapRows,sapRun)
          if(merged!==workbook){
            const saved=await workbookStore.save(merged,current)
            workbook=saved.book;workbookRevision=saved.revision;workbookSavedAt=saved.savedAt;changed=true
          }
        } catch(e) {onError(e)}
      }
      if(changed)deliver()
    })()
    try{await refreshing}finally{refreshing=null}
  }
  await refresh()
  const timer=setInterval(()=>refresh().catch(onError),interval)
  return {
    updateWorkbook(packet){if(!packet.book||packet.revision<workbookRevision||stopped)return;workbook=packet.book;workbookRevision=packet.revision;workbookSavedAt=packet.savedAt;deliver()},
    async save(state,action,expectedRevision,expectedGeneration,expectedWorkbookRevision=workbookRevision){
      await refresh()
      if(expectedGeneration!==source.generation||expectedRevision!==revision)throw new Error('save_conflict')
      if(expectedWorkbookRevision!==workbookRevision)throw new Error('save_conflict')
      const current=compose(),before=latest.stateJson?JSON.parse(latest.stateJson):projectState(hydrateState(data))
      const next=retainHiddenWorkbookRecords(before,projectState(state),current.hidden),changes=changeSummary(before,next)
      if(!changes.length)return
      const n=expectedRevision+1,key=`r${String(n).padStart(12,'0')}`,path=`versions/${key}`
      const check=await request(path,{headers:{'X-Firebase-ETag':'true'}})
      if(await check.json()!==null){void refresh().catch(onError);throw new Error('save_conflict')}
      const workbookBaseline=current.baseline
      for(const id of current.hidden){if(latest.workbookBaseline?.orders[id])workbookBaseline.orders[id]=latest.workbookBaseline.orders[id];if(latest.workbookBaseline?.shipments[`IMP-${id}`])workbookBaseline.shipments[`IMP-${id}`]=latest.workbookBaseline.shipments[`IMP-${id}`]}
      const payload={revision:n,sourceGeneration:source.generation,actor:'public-test-unverified',at:{'.sv':'timestamp'},operationId:crypto.randomUUID(),action,stateJson:JSON.stringify(next),changes,workbookRevision,workbookBaseline}
      let result
      try{result=await (await request(path,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':check.headers.get('etag')},body:JSON.stringify(payload)})).json()}
      catch(e){const stored=await (await request(path)).json();if(stored?.operationId!==payload.operationId){void refresh().catch(onError);throw e}result=stored}
      latest=result;revision=n;deliver();return {revision:n,at:result.at}
    },
    async disconnect(){stopped=true;clearInterval(timer)},
    refresh,
  }
}
