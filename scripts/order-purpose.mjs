// Confirmed by the user from the Production / Spare Parts responsibility tabs.
// This classifies business purpose, independently of purchased / in-house source.
export const purposeRule = 'owner-purpose-20260910'
export function confirmedPurpose(buyer){
  const name=String(buyer||'').trim().replace(/\s+/g,' ').toLowerCase()
  if(['karen andrews','karen a.'].includes(name))return '生产订单'
  if(['nishi arachchige','nishi a.'].includes(name))return '售后配件'
  return null
}
export function classifyOrders(orders){
  const changes=[]
  for(const order of orders){
    const purpose=confirmedPurpose(order.buyer)
    if(!purpose||order.type===purpose||order.type&&order.type!=='用途待确认')continue
    changes.push({id:order.id,buyer:order.buyer,before:order.type||null,after:purpose})
    order.type=purpose
    order.purposeEvidence={rule:purposeRule,basis:'User-confirmed owner responsibility',owner:order.buyer}
  }
  return changes
}
