export const PURCHASING_MAPPING_PATH = 'supplierCollaboration/config/purchasingGroupMapping'
export const PURCHASING_PURPOSE_RULE = 'sap-purchasing-group-20261013'

export function validatePurchasingMapping(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
      Object.entries(mapping).some(([key,value]) => !/^[A-Za-z0-9_-]+$/.test(key) || typeof value !== 'string')) {
    throw new Error('purchasing_mapping_unavailable')
  }
  return mapping
}

export async function readPurchasingMapping({databaseURL,fetcher=fetch}) {
  const response = await fetcher(`${databaseURL}/${PURCHASING_MAPPING_PATH}.json`,{signal:AbortSignal.timeout(20000)})
  if (!response.ok) throw new Error('purchasing_mapping_unavailable')
  const packet = await response.json()
  if (packet?.schemaVersion !== 1) throw new Error('purchasing_mapping_unavailable')
  validatePurchasingMapping(packet.mapping)
  return packet
}

export function applyPurchasingGroupClassification(state, mapping) {
  validatePurchasingMapping(mapping)
  for (const order of state.orders.filter(o => o.imported)) {
    const group = String(order.sapPurchasingGroup || '').trim()
    const purchaser = (Object.hasOwn(mapping,group) && mapping[group]) || group
    order.buyer = purchaser || '—'
    order.type = purchaser === 'Karen A.' ? '生产订单' : purchaser === 'Nishi A.' ? '售后配件' : '用途待确认'
    order.purposeEvidence = {rule:PURCHASING_PURPOSE_RULE,purchasingGroup:group,purchaser,basis:'SAP EKGRP / purchasing_group_mapping'}
  }
}
