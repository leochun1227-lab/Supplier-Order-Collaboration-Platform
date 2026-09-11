const text=value=>value==null?'':String(value).trim()
export const identityValue=value=>['','/','—','-'].includes(text(value))?'':text(value)
// SAP numeric identifiers may have leading zeros. Keep their original text for display.
export const normalizedIdentity=value=>identityValue(value).replace(/^0+(?=\d+$)/,'')
export function workbookIdentity(order) {
  const fields=order.importFields
  return {
    po:fields&&Object.hasOwn(fields,'po')?text(fields.po):text(order.po),
    item:fields&&Object.hasOwn(fields,'line')?text(fields.line):text(order.item),
  }
}
export function sapReferenceFields(record) {
  const original=record?.sapOriginal
  const sapPo=text(original?.EBELN),sapItem=text(original?.EBELP)
  return {sapPo,sapItem,sapReferenceStatus:sapPo&&sapItem?'matched':record?'unmatched':'unavailable'}
}
export function sapLineMatches(order) {
  const current=workbookIdentity(order),basis=order.sapLinkBasis
  if(normalizedIdentity(current.item)===normalizedIdentity(order.sapItem))return true
  return order.sapLineConvention==='sequence'&&!!basis&&
    normalizedIdentity(current.item)===normalizedIdentity(basis.item)&&
    Number(normalizedIdentity(current.item))*10===Number(normalizedIdentity(order.sapItem))
}
export function applySapSnapshotReferences(data,rows,finishedAt) {
  const byPo=new Map(),byLine=new Map()
  for(const p of rows){const po=normalizedIdentity(p.EBELN),key=po+'/'+normalizedIdentity(p.EBELP);if(byLine.has(key))throw new Error('duplicate_sap_reference');byLine.set(key,p);if(!byPo.has(po))byPo.set(po,[]);byPo.get(po).push(p)}
  for(const o of data.orders.filter(o=>o.imported)) {
    const source=workbookIdentity(o),material=text(o.importFields?.material??o.part),qty=o.importFields?.qty??o.qty
    const po=normalizedIdentity(source.po),line=normalizedIdentity(source.item),candidates=byPo.get(po)||[]
    const sameMaterial=candidates.filter(p=>text(p.MATNR)===material)
    const matching=material?sameMaterial.filter(p=>typeof qty==='number'&&Number.isFinite(qty)&&p.MENGE===qty):[]
    // Preserve a proven source anchor across snapshots. Workbook edits are applied
    // afterwards, so changing a PO/material never silently relinks it to another row.
    const anchor=o.sapAnchor??(o.sapPo&&o.sapItem?{po:o.sapPo,item:o.sapItem}:null)
    let selected=anchor?byLine.get(normalizedIdentity(anchor.po)+'/'+normalizedIdentity(anchor.item)):byLine.get(po+'/'+line)
    let method=anchor?(o.sapLinkMethod||'sap_po_line'):'sap_po_line'
    if(!anchor&&!selected&&matching.length===1){selected=matching[0];method='po_material_quantity'}
    const reason=anchor&&!selected?'snapshot_line_missing':!/^\d+$/.test(po)?'po_missing':!candidates.length?'po_not_in_scope':!material?'material_missing':matching.length>1?'ambiguous':!sameMaterial.length?'material_not_in_po':'line_or_quantity'
    o.sapAnchor=anchor||(selected?{po:text(selected.EBELN),item:text(selected.EBELP)}:null)
    o.sapReferenceStatus=selected?'matched':'unmatched';o.sapReferenceReason=selected?'':reason
    o.sapReferenceSource='snapshot';o.sapReferenceRefreshError=false;o.sapAsOf=new Date(finishedAt).toISOString().slice(0,10)
    o.sapPo=text(selected?.EBELN);o.sapItem=text(selected?.EBELP);o.sapPart=text(selected?.MATNR);o.sapUnit=text(selected?.MEINS)
    o.sapQuantity=selected?.MENGE??null
    o.sapLinkMethod=selected?method:'';o.sapCandidateCount=matching.length
    o.sapLinkBasis={...source,material,qty}
    // Once the source numbering convention has been established for this anchor,
    // later material/quantity changes are their own differences, not new line mismatches.
    o.sapLineConvention=anchor&&o.sapLineConvention?o.sapLineConvention:selected&&matching.length===1&&matching[0]===selected&&/^\d+$/.test(line)&&Number(line)>0&&Number(line)*10===Number(selected.EBELP)&&!byLine.has(po+'/'+line)?'sequence':'sap'
    // Only carry forward already-established quantity comparability. New identity
    // links alone do not authorize unit conversions or quantity aggregation.
    o.sapQuantityBasisComparable??=!!o.quantityComparable
    o.quantityComparable=!!(o.sapQuantityBasisComparable&&selected&&selected.MENGE===o.qty&&text(selected.MATNR)===text(o.part)&&selected.MEINS===o.unit)
    o.unitPrice=selected?.NETPR??null;o.priceUnit=selected?.PEINH??1;o.currency=selected?.WAERS||'—'
  }
  const groups=new Map()
  for(const o of data.orders){if(!o.imported||!o.sapPo||!o.sapItem)continue;const key=normalizedIdentity(o.sapPo)+'/'+normalizedIdentity(o.sapItem);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o)}
  for(const o of data.orders)o.sapSharedLineCount=0
  for(const group of groups.values())for(const o of group){o.sapSharedLineCount=group.length;if(group.length>1)o.quantityComparable=false}
}
export async function refreshSapSnapshot(data,{databaseURL,fetcher=fetch,previousRun=null,anchorStore}) {
  const root=`${databaseURL}/supplierCollaboration/sap`
  async function read(path){const r=await fetcher(`${root}/${path}.json`,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error('sap_snapshot_unavailable');return r.json()}
  const pointer=await read('current')
  if(!pointer){if(previousRun)throw new Error('sap_pointer_missing');return previousRun}
  if(pointer.run===previousRun)return previousRun
  if(!/^\d+-(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(pointer.run||'')||!Number.isFinite(pointer.finishedAt)||typeof pointer.hash!=='string'||!pointer.hash||!Number.isInteger(pointer.counts?.po)||pointer.counts.po<=0||pointer.counts.po>50000)throw new Error('invalid_sap_snapshot')
  if(data.sapSnapshotFinishedAt>pointer.finishedAt)throw new Error('older_sap_snapshot')
  const [records,hash]=await Promise.all([read(`runs/${pointer.run}/tables/po`),read(`runs/${pointer.run}/hash`)])
  const rows=Object.values(records||{})
  if(hash!==pointer.hash||rows.length!==pointer.counts.po||rows.some(p=>!p||!/^\d+$/.test(text(p.EBELN))||!/^\d+$/.test(text(p.EBELP))||typeof p.MENGE!=='number'||!Number.isFinite(p.MENGE)))throw new Error('incomplete_sap_snapshot')
  // Apply atomically only after validation; failed reads keep the last good view.
  const next=structuredClone(data),saveAnchors=await anchorStore?.(next)
  applySapSnapshotReferences(next,rows,pointer.finishedAt)
  await saveAnchors?.(next)
  data.orders=next.orders
  data.sapSnapshotFinishedAt=pointer.finishedAt
  return pointer.run
}
// Old workspaces did not expose SAP PO/line fields. Recover only from the retained
// import evidence by immutable record ID; never infer SAP values from workbook edits.
export async function loadSapReferences(data,source,{databaseURL,fetcher=fetch}) {
  const missing=data.orders.filter(o=>o.imported&&!o.sapReferenceStatus)
  if(!missing.length)return
  let batch=null
  if(/^excel-[a-f0-9]{24}$/.test(source.importBatch||'')) {
    try {
      const response=await fetcher(`${databaseURL}/supplierCollaboration/imports/${source.importBatch}/payloadJson.json`,{signal:AbortSignal.timeout(45000)})
      if(!response.ok)throw new Error('sap_reference_read_failed')
      const payload=await response.json()
      batch=typeof payload==='string'?JSON.parse(payload):null
      if(batch?.batchId!==source.importBatch||batch?.schemaVersion!==1)batch=null
    } catch { batch=null }
  }
  for(const order of missing)Object.assign(order,sapReferenceFields(batch?.records?.[order.id]))
}
