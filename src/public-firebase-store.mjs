import { projectState,hydrateState,changeSummary } from './persistence.mjs'
export const PUBLIC_DATABASE='https://supplier-collaboration-30ddf-default-rtdb.asia-southeast1.firebasedatabase.app'
export async function connectPublicWorkspace(onChange,onError,{workspace='excel-20260904',fetcher=fetch,interval=15000,databaseURL=PUBLIC_DATABASE}={}){
  if(!/^[a-z0-9-]+$/.test(workspace))throw new Error('invalid_workspace')
  const base=`${databaseURL}/supplierCollaboration/workspaces/${workspace}`
  async function request(path,options={}){const r=await fetcher(`${base}/${path}.json`,{signal:AbortSignal.timeout(45000),...options});if(!r.ok)throw new Error(r.status===412?'save_conflict':`firebase_http_${r.status}`);return r}
  const source=await (await request('source')).json()
  if(source?.kind!=='excel'||source.schemaVersion!==1)throw new Error('source_not_ready')
  const data=JSON.parse(source.dataJson);let revision=-1,latest={},stopped=false,polling=false
  async function refresh(){
    if(stopped||polling)return;polling=true
    try{
      const response=await fetcher(`${base}/versions.json?shallow=true`,{signal:AbortSignal.timeout(20000)})
      if(!response.ok)throw new Error(`firebase_http_${response.status}`)
      const keys=Object.keys(await response.json()||{}).filter(k=>/^r\d{12}$/.test(k)).sort(),key=keys.at(-1),next=key?Number(key.slice(1)):0
      if(next===revision)return
      latest=key?await (await request(`versions/${key}`)).json():{}
      if(key&&latest.revision!==next)throw new Error('invalid_revision')
      revision=next
      onChange({state:hydrateState(data,latest.stateJson?JSON.parse(latest.stateJson):{}),revision,generation:source.generation,savedAt:latest.at||null,email:'Public test',summary:source.summary})
    }finally{polling=false}
  }
  await refresh()
  const timer=setInterval(()=>refresh().catch(onError),interval)
  return {
    async save(state,action,expectedRevision,expectedGeneration){
      if(expectedGeneration!==source.generation||expectedRevision!==revision)throw new Error('save_conflict')
      const next=projectState(state),before=latest.stateJson?JSON.parse(latest.stateJson):projectState(hydrateState(data)),changes=changeSummary(before,next)
      if(!changes.length)return
      const n=expectedRevision+1,key=`r${String(n).padStart(12,'0')}`,path=`versions/${key}`
      const check=await request(path,{headers:{'X-Firebase-ETag':'true'}})
      if(await check.json()!==null){void refresh().catch(onError);throw new Error('save_conflict')}
      const payload={revision:n,sourceGeneration:source.generation,actor:'public-test-unverified',at:{'.sv':'timestamp'},operationId:crypto.randomUUID(),action,stateJson:JSON.stringify(next),changes}
      let result
      try{result=await (await request(path,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':check.headers.get('etag')},body:JSON.stringify(payload)})).json()}
      catch(e){const stored=await (await request(path)).json();if(stored?.operationId!==payload.operationId){void refresh().catch(onError);throw e}result=stored}
      latest=result;revision=n;return {revision:n,at:result.at}
    },
    async disconnect(){stopped=true;clearInterval(timer)},
    refresh,
  }
}
