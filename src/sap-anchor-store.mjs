import { workbookIdentity } from './sap-reference.mjs'

const basis=o=>JSON.stringify([workbookIdentity(o),o.importFields?.material??o.part,o.importFields?.qty??o.qty])
// Inferred links must survive page reloads and later SAP changes. Store only the
// original identity evidence, never collaboration fields or SAP credentials.
export function createSapAnchorStore({base,generation,fetcher=fetch}) {
  if(!/^[a-zA-Z0-9_-]+$/.test(generation||''))throw new Error('invalid_source_generation')
  const url=`${base}/sapReferenceLinks/${generation}.json`
  async function read(){const r=await fetcher(url,{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('sap_anchor_read_failed');return {value:await r.json(),etag:r.headers.get('etag')}}
  return async data=>{
    const current=await read(),registry=current.value||{schemaVersion:1,links:{}}
    if(registry.schemaVersion!==1||!registry.links||typeof registry.links!=='object')throw new Error('invalid_sap_anchors')
    const before=new Map(data.orders.map(o=>[o.id,basis(o)]))
    for(const o of data.orders){
      const link=registry.links[o.id]
      if(!link)continue
      if(link.basis!==before.get(o.id)||!link.anchor?.po||!link.anchor?.item)throw new Error('sap_anchor_source_conflict')
      if(link.method!=='po_material_quantity'||link.convention&&!['sequence','sap'].includes(link.convention))throw new Error('invalid_sap_anchor_rule')
      const line=Number(workbookIdentity(o).item)
      o.sapAnchor=link.anchor;o.sapLinkMethod=link.method;o.sapLineConvention=link.convention||(line>0&&line*10===Number(link.anchor.item)?'sequence':'sap')
    }
    return async next=>{
      const links={...registry.links};let changed=false
      for(const o of next.orders){
        if(!o.sapAnchor||o.sapLinkMethod!=='po_material_quantity'||links[o.id])continue
        if(!/^[a-zA-Z0-9_-]+$/.test(o.id))throw new Error('invalid_sap_anchor_key')
        links[o.id]={basis:before.get(o.id),anchor:o.sapAnchor,method:o.sapLinkMethod,convention:o.sapLineConvention};changed=true
      }
      if(!changed)return
      if(!current.etag)throw new Error('missing_sap_anchor_etag')
      const value={schemaVersion:1,links}
      try{
        const r=await fetcher(url,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':current.etag},body:JSON.stringify(value),signal:AbortSignal.timeout(30000)})
        if(!r.ok)throw new Error('sap_anchor_save_failed')
      }catch(error){
        const verified=await read().catch(()=>null)
        if(!verified||!Object.entries(links).every(([id,link])=>JSON.stringify(verified.value?.links?.[id])===JSON.stringify(link)))throw error
      }
    }
  }
}
