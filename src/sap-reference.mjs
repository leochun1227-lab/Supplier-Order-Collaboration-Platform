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
