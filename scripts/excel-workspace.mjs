// Adapter from retained source evidence to the existing collaboration UI.
// Unknown receipts, AU ETA and PGI are never inferred from an Excel OK marker.
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null
const text=v=>v==null||['/','—','-'].includes(String(v).trim())?'':String(v).trim()
const date=v=>/^\d{4}-\d{2}-\d{2}/.test(text(v))?text(v).slice(0,10):''
const labels={source_difference:['补充台账与主表存在差异','Supplement differs from master'],sap_link:['SAP 单据行关联待核对','SAP line association requires review'],shared_po_line:['同一 SAP 行存在多条台账记录','Multiple source records reference one SAP line'],material:['双方料号待确认','Material correspondence requires review'],quantity:['订购数量待核对','Ordered quantity requires review'],price:['价格待确认','Price requires review'],delivery_followup:['延期安排待跟进','Delivery follow-up required']}
export function excelWorkspace(batch){
  const orders=[],shipments=[]
  for(const record of Object.values(batch.records)){
    const f=record.fields,p=record.sapOriginal,qty=number(f.qty),reported=number(f.shipped),cancelled=f.completion==='澳洲取消订单'
    const evidence=record.evidence.map(id=>batch.sourceRows[id]).filter(Boolean)
    const delayed=evidence.find(r=>r.source.role==='delayed')
    const notes=evidence.map(r=>text(r.fields.notes)).filter(Boolean)
    const validUnit=!!p&&p.MENGE===qty&&text(p.MATNR)===text(f.material)&&!record.review.some(id=>batch.reviewTasks[id]?.kind==='shared_po_line')
    const importChecks=record.review.map(id=>{const c=batch.reviewTasks[id];return {id,kind:c.kind,title:{zh:labels[c.kind]?.[0]||c.kind,en:labels[c.kind]?.[1]||c.kind},detail:c.detail}})
    const o={
      id:record.id,imported:true,importCompletion:f.completion,cancelled,sourceRemaining:number(f.remaining),sourceReported:reported??0,qtyKnown:qty!==null,quantityComparable:validUnit,
      po:record.poCandidates.length===1?record.poCandidates[0]:text(f.po)||'—',item:record.line||'—',part:text(f.material),name:text(f.description_zh),en:text(f.description_en)||text(f.description_zh),
      supplier:p?.LIFNR?`SAP ${p.LIFNR}`:'—',upstreamSupplier:text(f.supplier_reference),buyer:text(f.buyer)||'—',type:'用途待确认',sourceType:f.category==='自制件'?'make':f.category==='外购件'?'buy':'unknown',
      qty:qty??0,reported:reported??0,received:null,shipped:null,receiptsKnown:false,pgiKnown:false,unit:validUnit?p.MEINS:'?',
      required:'',eta:'',originalEta:'',confirmed:false,status:cancelled?'已取消':f.completion==='OK'?'已报发':reported>0?'部分发运':'待确认',
      mode:text(f.mode).includes('空运')?'空运':text(f.mode).includes('海运')?'海运':text(f.mode).includes('快递')?'快递':'—',
      created:date(f.ordered),unitPrice:p?.NETPR??null,priceUnit:p?.PEINH??1,currency:p?.WAERS||'—',priceConfirmed:false,plant:p?.WERKS||'—',
      sapPart:p?.MATNR||'',soPart:text(f.material),so:record.soCandidates.join(' / '),soQty:null,soUnit:'?',mapping:null,
      initialEtd:date(f.agreed_etd),promisedEtd:date(f.planned_etd)||date(f.agreed_etd),chinaEta:date(f.eta_china),dispatchDelayStatus:delayed?'delayed':'unknown',dispatchDelayReason:delayed?text(delayed.fields.notes):'',remainingPlan:'',
      sourceAsOf:'2026-09-04',sapAsOf:p?'2026-09-10':'',syncedAt:'',cooperationSource:{zh:'Excel 初始化／平台维护',en:'Excel initialization / platform'},
      batches:[],pending:null,comments:[],dispatchUpdates:[],history:[{who:'Excel',time:'2026-09-04',text:{zh:'已导入原始台账，关联与状态待核对。',en:'Source ledger imported; associations and status require review.'}}],
      importEvidence:evidence.map(r=>({file:r.source.file,sheet:r.source.sheet,row:r.source.row})),importFields:f,importChecks,importNotes:[...new Set(notes)].join('\n'),
    }
    orders.push(o)
    if(reported>0&&!cancelled){
      shipments.push({id:`IMP-${record.id}`,imported:true,aggregate:true,order:o.id,qty:reported,receivedQty:null,allocations:[{order:o.id,qty:reported,receivedQty:null}],
        mode:o.mode,containerNo:text(f.container),waybillNo:text(f.awb),courierNo:'',carrier:'',ref:text(f.container)||text(f.awb),chassis:text(f.loaded_van),position:text(f.location),
        reportedAt:date(f.actual_ship),etd:date(f.actual_ship),eta:'',originalEta:'',stage:0,location:{zh:'台账累计报发，物流状态待核对',en:'Cumulative reported dispatch; logistics unverified'},
        delayStatus:'unknown',delayReason:'',nextAction:'',updates:[],sapPosted:false,sapDelivery:'',pgiAt:'',from:'',to:'',updated:'2026-09-04'})
    }
  }
  return {kind:'excel',schemaVersion:1,generation:batch.contentHash+'-ui-v2',updatedAt:Date.now(),importBatch:batch.batchId,summary:batch.summary,data:{orders,shipments,issues:[]}}
}
