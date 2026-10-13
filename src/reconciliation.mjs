import { TODAY, seedOrders, seedShipments, daysLate, openQty } from './domain.mjs'
import { identityValue, normalizedIdentity, workbookIdentity } from './sap-reference.mjs'
export { workbookIdentity } from './sap-reference.mjs'
export const label=(zh,en)=>({zh,en})
const workbookOk=o=>!!o?.imported&&String(o.importCompletion??'').trim().toUpperCase()==='OK'
const workbookMaterial=o=>identityValue(o?.importFields&&Object.hasOwn(o.importFields,'material')?o.importFields.material:o?.soPart??o?.part)
export const materialDifference=o=>!!identityValue(o?.sapPart)&&identityValue(o.sapPart)!==workbookMaterial(o)
export const isHistoricalOrder=o=>!!o?.imported&&(!!o.cancelled||String(o.importCompletion).toUpperCase()==='OK'||o.qtyKnown!==false&&openQty(o)<=0)
export const isException=c=>['po','po_line','po_line_missing','sap_reference','shared_reference','source_link','unit','initialization','shipment','material','quantity'].includes(c.kind)
export const KINDS={
  po:label('SAP 与总表 PO 不一致','SAP / workbook PO mismatch'),
  po_line:label('SAP 与总表订单行不一致','SAP / workbook line mismatch'),
  po_line_missing:label('总表订单行缺失','Workbook order line missing'),
  sap_reference:label('SAP 参考记录待关联','SAP reference requires linking'),
  shared_reference:label('Excel 记录重复待核对','Duplicate workbook records require review'),
  source_link:label('补充表记录待关联','Supplement row requires linking'),
  unit:label('单位待确认','Unit confirmation required'),
  initialization:label('初始化记录待核对','Initialization review'),
  shipment:label('报发与 SAP 待核对','Reported shipment / SAP'),
  material:label('物料号待确认','Material confirmation required'),
  reference:label('SO 关联待补充','Missing SO reference'),
  price:label('价格待确认','Price verification'),
  delivery:label('发运承诺待跟进','Dispatch commitment'),
  quantity:label('数量差异待核对','Quantity reconciliation'),
  logistics:label('运输延期跟进','Transport delay follow-up'),
}
export function workspaceOrders(){
  return seedOrders().map((o,i)=>({...o,unit:i===10?'M':'EA',soUnit:i===10?'ST':'EA',sapPart:o.part,soPart:i===10?'DEMO-SEAL-ALT':o.part,
    so:i===6?'':`DEMO-SO-${String(i+1).padStart(3,'0')}`,soQty:o.qty,sourceType:i%3===0?'make':'buy',
    reported:i===0?48:i===1?30:o.shipped,priceConfirmed:i!==6,unitPrice:i===6?1:o.unitPrice,priceUnit:1,
    initialEtd:i<2?'2026-09-06':'2026-09-14',promisedEtd:i<2?'2026-09-06':i===10?'':'2026-09-14',
    chinaEta:i%3===0?'':'2026-09-10',mapping:null,
    sourceAsOf:'2026-09-04',sapAsOf:'2026-09-08',syncedAt:'2026-09-08 09:00',
    cooperationSource:label('初始化记录 → 平台维护','Initial record → platform'),
  })).map(o=>({...o,priceConfirmation:o.priceConfirmed?priceSignature(o):null}))
}
export function workspaceShipments(){
  return [...seedShipments().map(s=>({...s,containerNo:s.mode==='海运'?s.ref:'',waybillNo:s.mode==='空运'?s.ref:'',courierNo:'',sapRef:s.ref,delayStatus:'normal',delayReason:'',nextAction:'',updates:[],sapPosted:true,sapDelivery:`DEMO-DLV-${s.id.slice(-3)}`,reportedAt:s.etd,pgiAt:s.etd,chassis:'DEMO-VAN',position:label('配件区','Parts compartment'),allocations:[{order:s.order,qty:s.qty,receivedQty:s.receivedQty}]})),
    {id:'SHP-DEMO-003',order:'450051727-00090',qty:78,receivedQty:0,mode:'海运',ref:'DEMO-CONTAINER-03',containerNo:'DEMO-CONTAINER-03',waybillNo:'',courierNo:'',delayStatus:'unknown',delayReason:'',nextAction:'',updates:[],carrier:'Demo carrier',from:'宁波',to:'墨尔本仓',etd:'2026-09-04',reportedAt:'2026-09-04',eta:'',originalEta:'',stage:0,location:label('已报发，物流节点待核实','Reported; logistics unverified'),updated:'09/04 16:00',sapPosted:false,sapDelivery:'',pgiAt:'',chassis:'DEMO-VAN-03',position:label('车内配件区','Interior parts compartment'),allocations:[{order:'450051727-00090',qty:48,receivedQty:0},{order:'450051727-00100',qty:30,receivedQty:0}]}]
}
export const delayDays=s=>s.eta&&s.originalEta?Math.max(0,Math.round((Date.parse(s.eta)-Date.parse(s.originalEta))/86400000)):null
export const shipmentDelayed=(s,today=TODAY)=>allocations(s).some(a=>a.qty>(a.receivedQty||0))&&(s.delayStatus==='delayed'||delayDays(s)>0||!!s.eta&&s.eta<today)
export const trackingRef=s=>(s.mode==='海运'?s.containerNo:s.mode==='快递'?s.courierNo:s.waybillNo)||s.containerNo||s.waybillNo||s.courierNo||s.ref||''
export const SHIPMENT_FIELDS={mode:label('运输方式','Mode'),stage:label('运输节点','Milestone'),eta:label('澳洲到仓 ETA','AU ETA'),containerNo:label('集装箱号','Container number'),waybillNo:label('提单／空运单','B/L / AWB'),courierNo:label('快递号','Courier number'),carrier:label('承运商','Carrier'),location:label('位置','Location'),chassis:label('车架','Chassis'),position:label('装载位置','Loading position'),delayStatus:label('延期状态','Delay status'),delayReason:label('延期原因','Delay reason'),nextAction:label('下一步','Next action')}
export function updateShipment(s,input,at=TODAY){
  if(!['海运','空运','快递'].includes(input.mode)||![0,2,3].includes(Number(input.stage))||!['normal','delayed','unknown'].includes(input.delayStatus))throw new Error('shipment_invalid')
  if(input.eta&&(!validDate(input.eta)||input.eta<(s.reportedAt||s.etd)))throw new Error('date_invalid')
  if(!input.note?.trim()||input.delayStatus==='delayed'&&!input.delayReason?.trim())throw new Error('shipment_reason')
  const fields=['mode','eta','containerNo','waybillNo','courierNo','carrier','location','chassis','position','delayStatus','delayReason','nextAction']
  const next=Object.fromEntries(fields.map(k=>[k,typeof input[k]==='string'?input[k].trim():'']))
  // A blank field represents an unknown value. It never erases the first known ETA baseline.
  next.stage=Number(input.stage);next.originalEta=s.originalEta||next.eta
  if((delayDays(next)>0||next.eta&&next.eta<TODAY)&&!next.delayReason)throw new Error('shipment_reason')
  const before=Object.fromEntries([...fields,'stage'].map(k=>[k,s[k]??'']))
  next.ref=trackingRef({...next,ref:''});next.locationUserEntered=true
  Object.assign(s,next,{updated:at,updates:[{at,note:input.note.trim(),before,after:Object.fromEntries([...fields,'stage'].map(k=>[k,next[k]]))},...(s.updates||[])]})
}
export const reportedQty=o=>o.reported??o.shipped
export const remainingQty=o=>o.imported?openQty(o):Math.max(0,o.qty-reportedQty(o))
export const allocations=s=>s.allocations||[{order:s.order,qty:s.qty,receivedQty:s.receivedQty||0}]
export const relatedShipments=(o,shipments)=>shipments.filter(s=>allocations(s).some(a=>a.order===o.id))
export const priceSignature=o=>JSON.stringify([o.currency,o.unitPrice,o.priceUnit||1,o.unit||'EA'])
export const priceReady=o=>(!o.imported||o.quantityComparable)&&o.priceConfirmed!==false&&(!o.priceConfirmation||o.priceConfirmation===priceSignature(o))&&o.currency==='AUD'&&Number.isFinite(o.unitPrice)&&o.unitPrice>=0&&(o.priceUnit||1)>0
const knownUnit=value=>!!identityValue(value)&&identityValue(value)!=='?'
export const materialReady=o=>!!identityValue(o.sapPart)&&identityValue(o.sapPart)===identityValue(o.soPart)||!!(!o.imported&&o.mapping&&o.mapping.materialConfirmed!==false&&(o.mapping.materialConfirmed||o.mapping.factor>0)&&o.mapping.sapPart===o.sapPart&&o.mapping.soPart===o.soPart)
export const unitReady=o=>knownUnit(o.unit)&&knownUnit(o.soUnit)&&(o.unit===o.soUnit||!!(o.mapping&&o.mapping.unitConfirmed!==false&&o.mapping.sapPart===o.sapPart&&o.mapping.soPart===o.soPart&&o.mapping.unit===o.unit&&o.mapping.soUnit===o.soUnit&&o.mapping.factor>0))
export const mappingReady=o=>materialReady(o)&&unitReady(o)
export function groupedQuantity(orders,quantity){
  const groups={};for(const o of orders){if(o.imported&&!o.quantityComparable)continue;const n=quantity(o);if(Number.isFinite(n)&&n)groups[o.unit||'EA']=(groups[o.unit||'EA']||0)+n}return groups
}
export const groupLabel=groups=>Object.entries(groups).map(([u,q])=>`${q.toLocaleString('en-AU')} ${u}`).join(' · ')||'—'
export function factsFor(o,shipments){
  const related=relatedShipments(o,shipments)
  return [
    ...(o.imported?[
      {field:label('采购订单 PO','Purchase order'),sap:o.sapPo||'—',business:workbookIdentity(o).po||'—',source:label('Excel 总表','Excel workbook'),adopted:label('双方原值保留','Both originals retained')},
      {field:label('采购订单行','Purchase order line'),sap:o.sapItem||'—',business:workbookIdentity(o).item||'—',source:label('Excel 总表','Excel workbook'),adopted:label('双方原值保留','Both originals retained')},
    ]:[]),
    {field:label('物料编码','Material'),sap:o.sapPart||'—',business:o.soPart??o.part??'—',source:label('工厂 SO／平台','Factory SO / platform'),adopted:materialReady(o)?label('对应关系已确认','Mapping confirmed'):label('双方原值保留','Both originals retained')},
    {field:label('计量单位','Unit'),sap:o.sapUnit??o.unit??'—',business:o.soUnit||'—',source:label('工厂 SO','Factory SO'),adopted:o.mapping&&unitReady(o)?`1 ${o.soUnit} = ${o.mapping.factor} ${o.unit}`:label('按原单位展示','Shown in original units')},
    {field:label('发运数量','Dispatched quantity'),sap:`${o.shipped??'—'} ${o.unit||'EA'}`,business:`${reportedQty(o)} ${o.unit||'EA'}`,source:o.cooperationSource||label('平台','Platform'),adopted:label('分别保留报发与过账','Report and PGI kept separately')},
    {field:label('PO 单价','PO unit price'),sap:`${o.currency} ${o.unitPrice??'—'} / ${o.priceUnit||1} ${o.unit||'EA'}`,business:'—',source:'SAP PO',adopted:priceReady(o)?label('纳入已确认货值','Included in confirmed value'):label('暂不计入货值','Excluded from confirmed value')},
    {field:label('SAP 交货单','SAP delivery'),sap:related.map(s=>s.sapDelivery||'—').join(' / ')||'—',business:related.map(s=>s.id).join(' / ')||'—',source:label('装运批次','Shipment batch'),adopted:label('按批次关联','Linked by batch')},
  ]
}
export function detectChecks(orders,shipments,today=TODAY){
  const found=[], shipmentsByOrder=new Map()
  // Count actual workbook identities, not the number of links to a SAP anchor.
  // Recompute from current cells so corrections take effect without a SAP refresh.
  const workbookLineKeys=new Map(),workbookLineCounts=new Map()
  for(const o of orders){
    if(!o.imported)continue
    const business=workbookIdentity(o),po=normalizedIdentity(business.po),line=normalizedIdentity(business.item)
    const material=identityValue(o.importFields?.material??o.soPart??o.part)
    if(!po||!line||!material)continue
    const key=JSON.stringify([po,material,line])
    workbookLineKeys.set(o,key);workbookLineCounts.set(key,(workbookLineCounts.get(key)||0)+1)
  }
  for(const shipment of shipments)for(const id of new Set(allocations(shipment).map(a=>a.order))){if(!shipmentsByOrder.has(id))shipmentsByOrder.set(id,[]);shipmentsByOrder.get(id).push(shipment)}
  const linkedShipments=o=>shipmentsByOrder.get(o.id)||[]
  const add=(o,kind,evidence,priority='中')=>found.push({id:`CHECK-${o.id}-${kind}`,order:o.id,kind,category:'数据问题',title:KINDS[kind],detail:evidence,owner:o.buyer,priority,due:today,status:'待处理',note:'',fingerprint:JSON.stringify([kind,evidence]),rule:true})
  for(const o of orders){
    if(o.imported){
      const business=workbookIdentity(o)
      const materialUnmatched=materialDifference(o)
      if(identityValue(o.sapPo)&&normalizedIdentity(o.sapPo)!==normalizedIdentity(business.po))add(o,'po',`SAP: ${o.sapPo} ↔ Excel: ${business.po||'—'}`,'高')
      if(!workbookOk(o)&&!identityValue(o.sapItem)&&!materialUnmatched) {
        const unavailable=o.sapReferenceStatus!=='unmatched'
        add(o,'sap_reference',label(
          `${unavailable?'SAP 参考数据未能读取，请刷新重试':'当前导入参考中未建立唯一 SAP 关联，需核实来源'}；Excel PO: ${business.po||'—'} / 行: ${business.item||'—'}`,
          `${unavailable?'SAP reference unavailable; reload to retry':'No unique SAP link in the imported reference; verify the source'}; Excel PO: ${business.po||'—'} / line: ${business.item||'—'}`))
        const reasons={po_missing:label('总表缺少正式 PO','Workbook has no formal PO'),po_not_in_scope:label('当前 SAP 查询范围内未找到 PO','PO not found in the current SAP scope'),material_missing:label('总表料号缺失，不能据此关联','Workbook material is missing; cannot infer a link'),ambiguous:label('PO、物料匹配到多条 SAP 记录，需确认对应记录','PO and material match multiple SAP records; confirm the corresponding record'),line_or_quantity:label('SAP 对应记录待确认','SAP record requires confirmation'),snapshot_line_missing:label('原 SAP 关联记录不在当前快照内','Original SAP anchor is absent from this snapshot')}
        if(reasons[o.sapReferenceReason])found.at(-1).detail=label(`${reasons[o.sapReferenceReason].zh}；Excel PO: ${business.po||'—'} / 行: ${business.item||'—'}`,`${reasons[o.sapReferenceReason].en}; Excel PO: ${business.po||'—'} / line: ${business.item||'—'}`)
        found.at(-1).fingerprint=JSON.stringify(['sap_reference',found.at(-1).detail])
      }
      if(materialUnmatched&&(o.sapMaterialNotInPo||o.sapReferenceReason==='material_not_in_po'||!workbookMaterial(o))){
        const material=workbookMaterial(o)||'—',line=identityValue(business.item)
        add(o,'material',label(
          material==='—'?`SAP 物料 ${o.sapPart}；Excel 物料号为空，没有与之匹配的物料。`:line?`Excel 行号 ${business.item}／物料 ${material}；SAP 行号 ${o.sapItem||'—'}／物料 ${o.sapPart}，双方物料不一致。`:
            `SAP PO ${o.sapPo||business.po} 下没有与 Excel 物料 ${material} 匹配的物料${line?`；Excel 行号 ${business.item}`:'（Excel 未填写行号）'}。`,
          material==='—'?`SAP material ${o.sapPart}; Excel material is blank with no matching material.`:line?`Excel line ${business.item} / material ${material}; SAP line ${o.sapItem||'—'} / material ${o.sapPart}: materials differ.`:
            `No material in SAP PO ${o.sapPo||business.po} matches Excel material ${material}${line?`; Excel line ${business.item}`:' (Excel line is blank)'}.`),'高')
        found.at(-1).title=label('SAP 与总表物料号不一致','SAP / workbook material mismatch')
      }else if(materialUnmatched)add(o,'material',`SAP: ${o.sapPart} ↔ Excel: ${o.importFields?.material??o.soPart??o.part??'—'}`,'高')
      const duplicateCount=workbookLineCounts.get(workbookLineKeys.get(o))||0
      if(!workbookOk(o)&&duplicateCount>1){
        const material=identityValue(o.importFields?.material??o.soPart??o.part)
        add(o,'shared_reference',label(`Excel 中 ${duplicateCount} 条记录的 PO ${business.po}、物料 ${material}、行号 ${business.item} 相同；请核对是否为重复记录或拆分发运。`,`Excel has ${duplicateCount} records with the same PO ${business.po}, material ${material} and line ${business.item}; check for duplicate records or split dispatches.`),'高')
      }
      const sapUnit=o.sapUnit??o.unit
      if(o.sapItem&&(!knownUnit(sapUnit)||!unitReady(o)||sapUnit!==o.unit))add(o,'unit',label(`SAP 单位：${sapUnit||'—'}；总表单位：${o.unit||'—'}；工厂单位：${o.soUnit||'—'}`,`SAP unit: ${sapUnit||'—'}; workbook unit: ${o.unit||'—'}; factory unit: ${o.soUnit||'—'}`))
      if(o.sapSharedLineCount===1&&o.qtyKnown!==false&&Number.isFinite(o.sapQuantity)&&Number.isFinite(o.qty)&&o.sapUnit&&o.sapUnit===o.unit&&o.unit!=='?'&&o.sapPart===o.soPart&&o.sapQuantity!==o.qty)add(o,'quantity',`SAP: ${o.sapQuantity} ${o.sapUnit} ↔ Excel: ${o.qty} ${o.unit}`)
      if(isHistoricalOrder(o))continue
      // These facts now have live rules; stale import warnings must not remain
      // open after the workbook is corrected or its material mapping is confirmed.
      const initialChecks=o.importChecks?.filter(c=>!['sap_link','material','price'].includes(c.kind))||[]
      if(initialChecks.length)add(o,'initialization',initialChecks.map(c=>`${c.title.zh} / ${c.title.en}`).join('; '))
      if(!priceReady(o))add(o,'price',`${o.currency} ${o.unitPrice??'—'} / ${o.priceUnit||1} ${o.unit}`)
      if(remainingQty(o)>0&&(!o.promisedEtd||o.promisedEtd<today||o.dispatchDelayStatus==='delayed'))add(o,'delivery',`${o.promisedEtd||'TBD'}; ${remainingQty(o)} ${o.unit}; ${o.dispatchDelayReason||''}`,'高')
      const delayed=linkedShipments(o).filter(s=>shipmentDelayed(s,today))
      if(delayed.length)add(o,'logistics',delayed.map(s=>`${s.id}: ETA ${s.eta||'TBD'}; ${s.delayReason||'—'}`).join(' / '),'高')
      continue
    }
    if(o.so&&!materialReady(o))add(o,'material',`SAP: ${o.sapPart||'—'} ↔ SO: ${o.soPart||'—'}`)
    if(o.so&&!unitReady(o))add(o,'unit',`SAP: ${o.unit||'—'} ↔ SO: ${o.soUnit||'—'}`)
    if(!o.so)add(o,'reference',`${o.po} / ${o.item}`)
    if(!priceReady(o))add(o,'price',`${o.currency} ${o.unitPrice} / ${o.priceUnit||1} ${o.unit}`)
    const unposted=linkedShipments(o).filter(s=>!s.sapPosted)
    if(reportedQty(o)!==o.shipped||unposted.length)add(o,'shipment',`${reportedQty(o)} ${o.unit} / SAP ${o.shipped} ${o.unit}; ${unposted.map(s=>s.id).join(', ')}`)
    if(remainingQty(o)>0&&(!o.promisedEtd||o.promisedEtd<today||o.dispatchDelayStatus==='delayed'))add(o,'delivery',`${o.promisedEtd||'TBD'}; ${remainingQty(o)} ${o.unit}; ${o.dispatchDelayReason||''}`,'高')
    const delayed=linkedShipments(o).filter(s=>shipmentDelayed(s,today)&&allocations(s).some(a=>a.order===o.id&&a.qty>(a.receivedQty||0)))
    if(delayed.length)add(o,'logistics',delayed.map(s=>`${s.id}: ETA ${s.eta||'TBD'}; ${s.delayReason||'—'}`).join(' / '),'高')
    const allocated=linkedShipments(o).reduce((n,s)=>n+allocations(s).filter(a=>a.order===o.id).reduce((n,a)=>n+a.qty,0),0)
    const soDifferent=o.so&&mappingReady(o)&&Number.isFinite(o.soQty)&&Math.abs(o.soQty*(o.mapping?.factor||1)-o.qty)>0.000001
    if(soDifferent||o.received>o.shipped||reportedQty(o)>o.qty||o.shipped>o.qty||allocated>reportedQty(o)||[o.qty,o.shipped,o.received,reportedQty(o)].some(n=>!Number.isFinite(n)||n<0))add(o,'quantity',`${o.qty} / ${reportedQty(o)} / ${o.shipped} / ${o.received}; SO ${o.soQty}; allocated ${allocated}`,'高')
  }
  return found
}
export function reconcile(orders,shipments,previous=[],today=TODAY){
  const detected=detectChecks(orders,shipments,today),old=new Map(previous.map(c=>[c.id,c])),ids=new Set(detected.map(c=>c.id))
  const current=detected.map(c=>{const prior=old.get(c.id);const result=prior?{...prior,...c,owner:prior.owner,due:prior.due,note:prior.note,log:prior.log||[],status:prior.status!=='已解决'&&prior.fingerprint===c.fingerprint?prior.status:'待处理'}:{...c,log:[]};delete result.closure;return result})
  const byOrder=new Map(orders.map(o=>[o.id,o]))
  return [...current,...previous.filter(c=>!ids.has(c.id)).map(c=>{
    const o=byOrder.get(c.order)
    // Missing reference data is not evidence that a previously found PO mismatch passed.
    if(c.kind==='po'&&o&&(!identityValue(o.sapPo)||!identityValue(o.sapItem)))return {...c}
    if(workbookOk(o)&&['sap_reference','shared_reference'].includes(c.kind))return {...c,status:'已解决',closure:label('Excel 状态为 OK，此项自动结束，无需补充解释；原处理记录保留','Excel status is OK; this item is automatically resolved without further explanation. Review history retained.')}
    if(['po_line','po_line_missing'].includes(c.kind))return {...c,status:'已解决',closure:label('已改按 PO＋物料核对，行号不再单列异常；原处理记录保留','Reclassified under PO and material reconciliation; line numbers are no longer separate exceptions. Review history retained.')}
    return {...c,status:'已解决',closure:label('当前事实已通过规则核对','Current facts pass the rule')}
  })]
}
export function updateCase(cases,id,{owner,due,note},now=TODAY){
  const c=cases.find(c=>c.id===id);if(!c)throw new Error('case_missing')
  if(!owner?.trim()||!validDate(due)||!note?.trim())throw new Error('evidence_required')
  c.owner=owner.trim();c.due=due;c.note=note.trim();c.status='处理中';c.log=[{at:now,text:note.trim()},...(c.log||[])]
}
export function validDate(d){return /^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d}
export function resolveFact(order,kind,input,note,today=TODAY){
  if(!note?.trim())throw new Error('evidence_required')
  if(kind==='material'||kind==='unit'){
    if(order.imported)throw new Error('source_required')
    if(kind==='unit'&&(!Number.isFinite(Number(input.factor))||Number(input.factor)<=0))throw new Error('factor_invalid')
    if(kind==='unit'&&(!knownUnit(order.unit)||!knownUnit(order.soUnit)))throw new Error('source_required')
    const prior=order.mapping||{}
    order.mapping={...prior,sapPart:order.sapPart,soPart:order.soPart,unit:order.unit,soUnit:order.soUnit,
      materialConfirmed:kind==='material'||materialReady(order),unitConfirmed:kind==='unit'||unitReady(order),
      factor:kind==='unit'?Number(input.factor):unitReady(order)?prior.factor||1:1,
      [kind+'Note']:note,[kind+'At']:today,note,at:today}
  }else if(kind==='price'){
    if(order.currency!=='AUD')throw new Error('currency_unconfirmed')
    order.priceConfirmed=true;order.priceConfirmation=priceSignature(order)
  }else if(kind==='reference'){
    if(!/^[A-Z0-9][A-Z0-9-]{3,29}$/.test(input.so||''))throw new Error('so_required')
    order.so=input.so;order.referenceEvidence=note
  }else if(kind==='delivery'){
    if(!validDate(input.date)||input.date<today)throw new Error('date_invalid')
    order.promisedEtd=input.date;order.dispatchReason=note
  }else throw new Error('source_required')
}
export function recordDispatch(orders,shipments,input,today=TODAY){
  const reference=trackingRef(input)
  if(!validDate(input.date)||input.date>today||!reference.trim()||!input.allocations?.length||!['海运','空运','快递'].includes(input.mode))throw new Error('dispatch_required')
  if(input.eta&&(!validDate(input.eta)||input.eta<input.date))throw new Error('date_invalid')
  const ids=new Set();let supplier
  for(const a of input.allocations){const o=orders.find(o=>o.id===a.order);if(!o||ids.has(a.order)||!Number.isFinite(Number(a.qty))||Number(a.qty)<=0||Number(a.qty)>remainingQty(o)||!['M','FT2'].includes(o.unit)&&!Number.isInteger(Number(a.qty)))throw new Error('quantity_invalid');ids.add(a.order);if(supplier&&supplier!==o.supplier)throw new Error('supplier_mismatch');supplier=o.supplier}
  const rows=input.allocations.map(a=>({...a,qty:Number(a.qty),receivedQty:0}))
  const id=orders.some(o=>o.imported)?`SHP-${today.replaceAll('-','')}-${crypto.randomUUID().slice(0,8)}`:`SHP-DEMO-${String(shipments.length+1).padStart(3,'0')}`
  for(const a of rows){const o=orders.find(o=>o.id===a.order);o.reported=reportedQty(o)+a.qty}
  shipments.push({id,order:rows[0].order,qty:rows.reduce((n,a)=>n+a.qty,0),receivedQty:0,allocations:rows,mode:input.mode,ref:reference.trim(),containerNo:input.containerNo||(!input.waybillNo&&!input.courierNo&&input.mode==='海运'?input.ref||'':''),waybillNo:input.waybillNo||'',courierNo:input.courierNo||'',carrier:input.carrier||'',delayStatus:'unknown',delayReason:'',nextAction:'',updates:[],chassis:input.chassis.trim(),position:input.position.trim(),reportedAt:input.date,etd:input.date,eta:input.eta||'',originalEta:input.eta||'',sapPosted:false,sapDelivery:'',pgiAt:'',stage:0,location:label('已报发，物流节点待核实','Reported; logistics unverified'),from:'宁波',to:'墨尔本仓',updated:today})
  return id
}
// Explicit demo snapshot: only the original fictional, pending batch gets a later SAP receipt.
// It never copies arbitrary user-entered dispatches into SAP facts.
export function applyDemoSnapshot(orders,shipments){
  const s=shipments.find(s=>s.id==='SHP-DEMO-003');if(!s||s.sapPosted)return false
  for(const a of allocations(s)){const o=orders.find(o=>o.id===a.order);if(!o)throw new Error('order_missing')}
  s.sapPosted=true;s.sapDelivery='DEMO-DLV-003';s.pgiAt='2026-09-08'
  for(const a of allocations(s)){const o=orders.find(o=>o.id===a.order);o.shipped+=a.qty;o.syncedAt='2026-09-08 10:00'}
  return true
}
export function businessSummary(orders,shipments,cases=[]){
  const open=orders.filter(o=>openQty(o)>0),known=open.filter(priceReady),ids=new Set(orders.map(o=>o.id))
  const batches=shipments.filter(s=>allocations(s).some(a=>ids.has(a.order)))
  const transit=batches.filter(s=>s.sapPosted&&s.stage>=2&&allocations(s).some(a=>ids.has(a.order)&&a.qty>(a.receivedQty||0)))
  const remainingSAP=new Map(orders.map(o=>[o.id,Math.max(0,o.shipped-o.received)]))
  const transitRows=transit.flatMap(s=>allocations(s).filter(a=>ids.has(a.order)).flatMap(a=>{const qty=Math.min(remainingSAP.get(a.order),Math.max(0,a.qty-(a.receivedQty||0)));remainingSAP.set(a.order,remainingSAP.get(a.order)-qty);return qty?[{order:orders.find(o=>o.id===a.order),qty,shipment:s}]:[]}))
  const risk=open.filter(o=>daysLate(o)>0||remainingQty(o)>0&&(!o.promisedEtd||o.promisedEtd<TODAY||o.dispatchDelayStatus==='delayed')||relatedShipments(o,shipments).some(s=>shipmentDelayed(s)&&allocations(s).some(a=>a.order===o.id&&a.qty>(a.receivedQty||0))))
  return {open,known,batches,transit:transit.filter(s=>transitRows.some(r=>r.shipment.id===s.id)),transitRows,risk,poCount:new Set(open.map(o=>o.po)).size,openValue:known.reduce((n,o)=>n+openQty(o)*o.unitPrice/(o.priceUnit||1),0),unpriced:open.filter(o=>!priceReady(o)),
    remaining:groupedQuantity(orders,remainingQty),reported:groupedQuantity(orders,reportedQty),received:groupedQuantity(orders,o=>o.received),
    transitValue:transitRows.filter(r=>priceReady(r.order)).reduce((n,r)=>n+r.qty*r.order.unitPrice/(r.order.priceUnit||1),0),
    unresolved:cases.filter(c=>ids.has(c.order)&&c.status!=='已解决'),pendingBatches:batches.filter(s=>!s.sapPosted),
    source:['buy','make'].map(key=>({key,rows:open.filter(o=>o.sourceType===key)}))}
}
