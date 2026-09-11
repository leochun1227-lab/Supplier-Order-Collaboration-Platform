import { cloneBook, sheetValues } from './parts-workbook.mjs'
import { hydrateState } from './persistence.mjs'

// Column IDs and original evidence row IDs survive renames, sorting and insertion.
const FIELDS = ['seq','mode','po','line','van','description_zh','description_en','supplier_reference','material','qty','category','so','buyer','ordered','agreed_etd','planned_etd','manager','eta_china','actual_ship','shipped','remaining','loaded_van','location','container','awb','completion','notes']
const text = v => v == null || ['/', '—', '-'].includes(String(v).trim()) ? '' : String(v).trim()
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const date = v => /^\d{4}-\d{2}-\d{2}/.test(text(v)) ? text(v).slice(0,10) : ''
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b)
const normal = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0,10) : v ?? null
const mode = v => text(v).includes('空运') ? '空运' : text(v).includes('海运') ? '海运' : text(v).includes('快递') ? '快递' : text(v) || '—'
function purpose(buyer) {
  const key = text(buyer).toLowerCase().replace(/\s+/g,' ')
  return ['karen andrews','karen a.'].includes(key) ? '生产订单' : ['nishi arachchige','nishi a.'].includes(key) ? '售后配件' : '用途待确认'
}
function newOrder(id) {
  return {id,imported:true,workbookCreated:true,importCompletion:'',cancelled:false,qty:0,qtyKnown:false,sourceReported:0,sourceRemaining:null,reported:0,
    po:'—',item:'—',part:'',name:'',en:'',supplier:'—',upstreamSupplier:'',buyer:'—',type:'用途待确认',sourceType:'unknown',mode:'—',created:'',
    received:null,shipped:null,receiptsKnown:false,pgiKnown:false,quantityComparable:false,unit:'?',unitPrice:null,priceUnit:1,currency:'—',plant:'—',
    sapPart:'',sapPo:'',sapItem:'',sapReferenceStatus:'unmatched',soPart:'',so:'',soQty:null,soUnit:'?',mapping:null,priceConfirmed:false,
    required:'',eta:'',originalEta:'',initialEtd:'',promisedEtd:'',chinaEta:'',confirmed:false,status:'待确认',dispatchDelayStatus:'unknown',dispatchDelayReason:'',remainingPlan:'',
    sourceAsOf:'',sapAsOf:'',syncedAt:'',batches:[],pending:null,comments:[],dispatchUpdates:[],history:[],importFields:{},importEvidence:[],importChecks:[],importNotes:''}
}
function dispatch(order, fields) {
  return {id:`IMP-${order.id}`,imported:true,aggregate:true,order:order.id,qty:order.sourceReported,receivedQty:null,
    allocations:[{order:order.id,qty:order.sourceReported,receivedQty:null}],mode:order.mode,
    containerNo:text(fields.container),waybillNo:text(fields.awb),courierNo:'',ref:text(fields.container)||text(fields.awb),carrier:'',chassis:text(fields.loaded_van),position:text(fields.location),
    reportedAt:date(fields.actual_ship),etd:date(fields.actual_ship),eta:'',originalEta:'',stage:0,
    location:{zh:'台账累计报发，物流状态待核对',en:'Cumulative reported dispatch; logistics unverified'},
    delayStatus:'unknown',delayReason:'',nextAction:'',updates:[],sapPosted:false,sapDelivery:'',pgiAt:'',from:'',to:'',updated:''}
}

export function workbookProjection(source, book) {
  const original = cloneBook(source), baseline = {orders:{},shipments:{}}, changed = {orders:{},shipments:{}}, hidden = new Set()
  const sheet = book?.sheets.find(s=>s.id==='s0')
  if (!sheet) return {source:original,baseline,changed,hidden}
  const values = sheetValues(sheet), byRow = new Map()
  for (const order of original.orders) {
    const evidence = order.importEvidence?.find(e=>e.file===book.sourceFile&&e.sheet===sheet.name)
    if (!evidence) continue
    const rowId = `s0-r${evidence.row}`
    if (byRow.has(rowId)) throw new Error('ambiguous_workbook_link')
    byRow.set(rowId,order); hidden.add(order.id)
  }
  const columns = new Map(sheet.columns.map((col,c)=>[col.id,c]))
  const linked = [], linkedShipments = new Map()
  for (let r=sheet.headerRows;r<sheet.rows.length;r++) {
    const row = sheet.rows[r], old = byRow.get(row.id), f = {}, differences = new Set()
    for (let c=0;c<FIELDS.length;c++) {
      const position = columns.get(`s0-c${c}`), field = FIELDS[c]
      f[field] = position === undefined ? null : values[r][position]
      if (!old || !same(normal(f[field]),normal(old.importFields?.[field]))) differences.add(field)
    }
    const extras = sheet.columns.flatMap((col,c)=>/^s0-c\d+$/.test(col.id)?[]:[{id:col.id,name:String(values[sheet.headerRows-1]?.[c]||''),value:values[r][c]}])
    // A newly inserted blank row is a draft, not an invented business order.
    if (!old && !FIELDS.slice(1).some(k=>text(f[k])) && !extras.some(e=>text(e.value))) continue
    const order = old || newOrder(`PARTS-${row.id}`), isNew = !old
    hidden.delete(order.id)
    const has = (...keys)=>keys.some(k=>differences.has(k))
    const set = (field,value,...keys)=>{if(isNew||has(...keys))order[field]=value}
    set('po',text(f.po)||'—','po'); set('item',text(f.line)||'—','line')
    set('part',text(f.material),'material'); set('soPart',text(f.material),'material')
    set('name',text(f.description_zh),'description_zh'); set('en',text(f.description_en)||text(f.description_zh),'description_en','description_zh')
    set('upstreamSupplier',text(f.supplier_reference),'supplier_reference')
    // The workbook's supplier column is a reference supplier, not the SAP contract party.
    if(isNew)order.supplier=text(f.supplier_reference)||'—'
    set('buyer',text(f.buyer)||'—','buyer'); set('type',purpose(f.buyer),'buyer')
    set('sourceType',f.category==='自制件'?'make':f.category==='外购件'?'buy':'unknown','category')
    set('qty',number(f.qty)??0,'qty'); set('qtyKnown',number(f.qty)!==null,'qty')
    set('sourceReported',number(f.shipped)??0,'shipped')
    set('sourceRemaining',number(f.remaining),'remaining')
    set('mode',mode(f.mode),'mode'); set('created',date(f.ordered),'ordered')
    set('so',text(f.so),'so'); set('initialEtd',date(f.agreed_etd),'agreed_etd')
    set('importCompletion',text(f.completion),'completion'); set('cancelled',f.completion==='澳洲取消订单','completion')
    set('importNotes',text(f.notes),'notes')
    order.workbookIdentityChanged=has('po','line','material')
    order.workbookMaterialChanged=has('material')
    if (order.workbookIdentityChanged) { order.quantityComparable=false; order.mapping=null; order.priceConfirmed=false }
    const candidates = {
      reported:number(f.shipped)??0,
      promisedEtd:date(f.planned_etd)||date(f.agreed_etd), chinaEta:date(f.eta_china),
      status:order.cancelled?'已取消':f.completion==='OK'?'已报发':number(f.shipped)>0?'部分发运':'待确认',
      so:order.so,
    }
    const flags = {reported:has('shipped'),promisedEtd:has('planned_etd','agreed_etd'),chinaEta:has('eta_china'),status:has('completion','shipped'),so:has('so')}
    baseline.orders[order.id]=candidates; changed.orders[order.id]=flags
    for (const [key,value] of Object.entries(candidates)) if(isNew||flags[key])order[key]=value
    order.workbookRowId=row.id; order.workbookRow=r+1; order.workbookExtras=extras
    order.importFields=f
    if(isNew) order.importEvidence=[{file:book.sourceFile,sheet:sheet.name,row:r+1}]
    if(differences.size)order.cooperationSource={zh:'表格维护／平台联动',en:'Workbook / shared workspace'}
    linked.push(order)
    const shipmentId=`IMP-${order.id}`, existing=original.shipments.find(s=>s.id===shipmentId)
    if(existing||order.sourceReported>0&&!order.cancelled) {
      const candidate=dispatch(order,f)
      const shipmentFields={mode:['mode'],containerNo:['container'],waybillNo:['awb'],ref:['container','awb'],chassis:['loaded_van'],position:['location'],reportedAt:['actual_ship'],etd:['actual_ship'],qty:['shipped'],allocations:['shipped'],deletedAt:['shipped','completion']}
      candidate.deletedAt=order.cancelled||order.sourceReported<=0?'workbook':null
      const target=existing||candidate, b={}, changes={}
      for(const [key,fields]of Object.entries(shipmentFields)){b[key]=candidate[key];changes[key]=has(...fields)||!existing;if(changes[key])target[key]=candidate[key]}
      baseline.shipments[shipmentId]=b; changed.shipments[shipmentId]=changes
      linkedShipments.set(shipmentId,target)
    }
  }
  const ids = new Set(linked.map(o=>o.id))
  original.orders=[...original.orders.filter(o=>!ids.has(o.id)&&!hidden.has(o.id)),...linked]
  original.shipments=[...original.shipments.filter(s=>!linkedShipments.has(s.id)),...linkedShipments.values()]
  return {source:original,baseline,changed,hidden}
}

export function sharedWorkbookState(source, overlay={}, book=null, previousBaseline=null) {
  const projection=workbookProjection(source,book), state=hydrateState(projection.source,overlay)
  // A later workbook edit wins only for the field that changed. Other-page edits
  // made against this workbook remain effective, including after reload or undo.
  for(const group of ['orders','shipments']) for(const row of state[group]) {
    for(const [key,value] of Object.entries(projection.baseline[group][row.id]||{})) {
      const old=previousBaseline?.[group]?.[row.id]
      if(old ? !same(old[key],value) : projection.changed[group][row.id]?.[key]) {
        row[key]=cloneBook(value)
        if(key==='so')delete row.referenceEvidence
      }
    }
  }
  const hidden=projection.hidden
  const currentIds=new Set(state.orders.map(o=>o.id))
  for(const id of Object.keys(overlay.orders||{}))if(id.startsWith('PARTS-')&&!currentIds.has(id))hidden.add(id)
  state.shipments=state.shipments.filter(s=>{
    const allocations=s.allocations||[{order:s.order,qty:s.qty}]
    const kept=allocations.filter(a=>!hidden.has(a.order))
    if(!kept.length)return false
    if(kept.length!==allocations.length){s.allocations=kept;s.order=kept[0].order;s.qty=kept.reduce((n,a)=>n+a.qty,0)}
    return true
  })
  state.issues=state.issues.filter(i=>!hidden.has(i.order))
  state.checks=state.checks.filter(i=>!hidden.has(i.order))
  return {state,baseline:projection.baseline,hidden}
}

export function retainHiddenWorkbookRecords(before, next, hidden) {
  const result=cloneBook(next)
  for(const group of ['orders','shipments','issues','checks'])for(const [id,row]of Object.entries(before?.[group]||{})) {
    const hiddenRow=group==='orders'?hidden.has(id):hidden.has(row.order)||(row.allocations||[]).some(a=>hidden.has(a.order))
    if(!hiddenRow)continue
    if(!result[group][id])result[group][id]=cloneBook(row)
    else if(group==='shipments'){
      const missing=(row.allocations||[]).filter(a=>hidden.has(a.order))
      result[group][id].allocations=[...(result[group][id].allocations||[]).filter(a=>!hidden.has(a.order)),...cloneBook(missing)]
      result[group][id].qty=result[group][id].allocations.reduce((n,a)=>n+a.qty,0)
    }
  }
  return result
}
