// Only collaboration-owned fields cross this boundary. SAP facts stay in source.
export const ORDER_FIELDS = ['eta','originalEta','confirmed','status','batches','pending','reported','promisedEtd','chinaEta','dispatchReason','dispatchDelayStatus','dispatchDelayReason','remainingPlan','dispatchUpdates','mapping','priceConfirmed','priceConfirmation','referenceEvidence','history','comments']
export const SHIPMENT_FIELDS = ['id','order','qty','allocations','mode','ref','containerNo','waybillNo','courierNo','carrier','delayStatus','delayReason','nextAction','updates','chassis','position','reportedAt','etd','eta','originalEta','stage','location','locationUserEntered','from','to','updated','deletedAt','deleteReason']
export const copy = value => JSON.parse(JSON.stringify(value))
const pick = (row,fields) => Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,copy(row[k])]))
const index = rows => Object.fromEntries(rows.map(row=>[row.id,row]))
// Firebase keys forbid control characters as well as path separators.
// eslint-disable-next-line no-control-regex
const safeKey = key => typeof key==='string' && key.length>0 && !['__proto__','constructor','prototype'].includes(key) && !/[.#$[\]/\u0000-\u001f\u007f]/.test(key)
export function projectState(state){
  for(const rows of [state.orders,state.shipments,state.issues,state.checks]){
    if(!Array.isArray(rows)||rows.some(r=>!safeKey(r.id))||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('invalid_records')
  }
  return {orders:index(state.orders.map(o=>({id:o.id,...pick(o,ORDER_FIELDS),...(o.referenceEvidence?{linkedSo:o.so}:{})}))),shipments:index(state.shipments.map(s=>pick(s,SHIPMENT_FIELDS))),issues:index(copy(state.issues)),checks:index(copy(state.checks))}
}
export function hydrateState(source,state={}){
  if(!source||!Array.isArray(source.orders)||!Array.isArray(source.shipments))throw new Error('source_missing')
  const orders=source.orders.map(o=>{const overlay=state.orders?.[o.id]||{};return {history:[],comments:[],batches:[],...copy(o),...pick(overlay,ORDER_FIELDS),...(overlay.referenceEvidence&&overlay.linkedSo?{so:overlay.linkedSo}:{})}})
  const originals=new Map(source.shipments.map(s=>[s.id,s]))
  const ids=new Set([...originals.keys(),...Object.keys(state.shipments||{})])
  const shipments=[...ids].map(id=>{
    const original=originals.get(id),overlay=state.shipments?.[id]||{}
    const s={sapPosted:false,sapDelivery:'',pgiAt:'',receivedQty:0,...copy(original||{}),...pick(overlay,SHIPMENT_FIELDS),id}
    // Receipts belong to SAP even though allocations are editable platform data.
    s.allocations=(s.allocations||[]).map(a=>({...a,receivedQty:original?.imported?original.allocations?.find(x=>x.order===a.order)?.receivedQty??null:original?.allocations?.find(x=>x.order===a.order)?.receivedQty||0}))
    return s
  })
  return {orders,shipments,issues:Object.values(state.issues||index(source.issues||[])),checks:Object.values(state.checks||{})}
}
export function revisionKey(revision){if(!Number.isSafeInteger(revision)||revision<1||revision>999999999999)throw new Error('invalid_revision');return `r${revision}`}
export function changeSummary(before,after){
  const changes=[]
  for(const collection of ['orders','shipments','issues','checks']){
    for(const id of new Set([...Object.keys(before?.[collection]||{}),...Object.keys(after?.[collection]||{})])){
      const a=before?.[collection]?.[id],b=after?.[collection]?.[id]
      if(JSON.stringify(a)!==JSON.stringify(b))changes.push({collection,id,action:!a?'create':!b||b.deletedAt&&!a.deletedAt?'delete':a.deletedAt&&!b.deletedAt?'restore':'update'})
    }
  }
  return changes
}
export function deleteDispatch(state,id,reason,at){
  const s=state.shipments.find(s=>s.id===id)
  if(!s||s.deletedAt)throw new Error('shipment_missing')
  if(s.sapPosted||s.sapDelivery||s.pgiAt||s.receivedQty>0||(s.allocations||[]).some(a=>a.receivedQty>0))throw new Error('posted_shipment')
  if(!reason?.trim())throw new Error('reason_required')
  for(const a of s.allocations||[]){const o=state.orders.find(o=>o.id===a.order);if(!o||Number(o.reported??o.shipped)<a.qty)throw new Error('quantity_invalid')}
  for(const a of s.allocations||[]){const o=state.orders.find(o=>o.id===a.order);o.reported=Number(o.reported??o.shipped)-a.qty}
  s.deletedAt=at;s.deleteReason=reason.trim()
}
export function restoreDispatch(state,id){
  const s=state.shipments.find(s=>s.id===id)
  if(!s?.deletedAt)throw new Error('shipment_missing')
  for(const a of s.allocations||[]){const o=state.orders.find(o=>o.id===a.order);if(!o||o.qty-Number(o.reported??o.shipped)<a.qty)throw new Error('quantity_invalid')}
  for(const a of s.allocations||[]){const o=state.orders.find(o=>o.id===a.order);o.reported=Number(o.reported??o.shipped)+a.qty}
  delete s.deletedAt;delete s.deleteReason
}
