import { openQty } from './domain.mjs'
import { allocations, businessSummary, remainingQty, reportedQty, priceReady } from './reconciliation.mjs'

const dayMs = 86400000
function dateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : null
}

// Read-only management projection. Missing evidence is distinct from a measured zero.
export function managerOverview(orders, shipments, today) {
  const now = dateTime(today)
  if (now === null) throw new Error('Invalid overview business date')
  const active = orders.filter(o => !o.cancelled)
  const totals = {
    rows: orders,
    poCount: new Set(orders.map(o => o.po).filter(Boolean)).size,
    cancelled: orders.filter(o => o.cancelled),
    dispatched: active.filter(o => reportedQty(o) > 0),
    received: active.filter(o => o.receiptsKnown !== false && Number.isFinite(o.received) && o.received > 0),
    receiptUnknown: active.filter(o => o.receiptsKnown === false || !Number.isFinite(o.received)),
  }
  const open = active.filter(o => openQty(o) > 0)
  const pending = open.filter(o => remainingQty(o) > 0)
  const batches = shipments.filter(s => !s.deletedAt && !s.aggregate)
  const transitSummary = businessSummary(active, batches)
  const verified = transitSummary.transit
  const ordersFor = list => {
    const batchIds = new Set(list.map(s=>s.id))
    const linked = new Set(transitSummary.transitRows.filter(r=>batchIds.has(r.shipment.id)).map(r=>r.order.id))
    return active.filter(o => linked.has(o.id))
  }
  const delayed = open.filter(o => {
    const dispatch = dateTime(o.promisedEtd), eta = dateTime(o.eta), required = dateTime(o.required)
    const lateDispatch = remainingQty(o) > 0 && (o.dispatchDelayStatus === 'delayed' || dispatch !== null && dispatch < now)
    const lateArrival = eta !== null && (eta < now || required !== null && eta > required)
    const lateBatch = batches.some(s => {
      const arrival = dateTime(s.eta), original = dateTime(s.originalEta)
      const delayed = s.delayStatus === 'delayed' || arrival !== null && (arrival < now || original !== null && arrival > original)
      return delayed && allocations(s).some(a => a.order === o.id && a.qty > (a.receivedQty || 0))
    })
    return lateDispatch || lateArrival || lateBatch
  })
  const noDate = pending.filter(o => dateTime(o.promisedEtd) === null)
  const unverifiedDispatch = active.filter(o => reportedQty(o) > 0 &&
    (!Number.isFinite(o.shipped) || reportedQty(o) > o.shipped ||
      batches.some(s => !s.sapPosted && allocations(s).some(a => a.order === o.id && a.qty > 0))))
  const ageingUnknown = open.filter(o => dateTime(o.created) === null || dateTime(o.created) > now)
  const aged = open.filter(o => dateTime(o.created) !== null && now - dateTime(o.created) > 60 * dayMs)
  const upcoming = verified.filter(s => {
    const eta = dateTime(s.eta)
    return eta !== null && eta >= now && eta < now + 7 * dayMs
  })
  const missingEta = verified.filter(s => dateTime(s.eta) === null)
  const imported = active.some(o => o.imported)
  const transitKnown = !imported || verified.length > 0
  const arrivalsKnown = transitKnown && (verified.length === 0 || verified.length > missingEta.length)
  const arrivalWeeks = Array.from({length:4}, (_,index) => {
    const start = now + index * 7 * dayMs, end = start + 7 * dayMs
    const shipments = verified.filter(s => dateTime(s.eta) !== null && dateTime(s.eta) >= start && dateTime(s.eta) < end)
    return {start:new Date(start).toISOString().slice(0,10),end:new Date(end-dayMs).toISOString().slice(0,10),
      count:arrivalsKnown ? shipments.length : null, rows:ordersFor(shipments),
      modes:['海运','空运','其他'].map(mode=>({mode,count:shipments.filter(s=>(['海运','空运'].includes(s.mode)?s.mode:'其他')===mode).length}))}
  })
  const modes = ['海运','空运','快递','未分类'].map(mode => ({
    mode,
    rows: open.filter(o => (['海运','空运','快递'].includes(o.mode) ? o.mode : '未分类') === mode),
  }))
  const suppliers = [...new Set(open.map(o => o.supplier || '—'))].map(name => ({
    name, rows: open.filter(o => (o.supplier || '—') === name),
    delayed: delayed.filter(o => (o.supplier || '—') === name).length,
  })).sort((a,b) => b.delayed - a.delayed || b.rows.length - a.rows.length || a.name.localeCompare(b.name))
  return { totals, open, pending, delayed, noDate, unverifiedDispatch, aged, ageingUnknown, verified, transitKnown, arrivalsKnown,
    arrivalWeeks, freight: freightOverview(active,batches,today),
    upcoming, missingEta, transitOrders: ordersFor(verified), upcomingOrders: ordersFor(upcoming), modes, suppliers,
    poCount: new Set(open.map(o => o.po)).size, imported }
}

// Expenses use dated, actual shipment records; missing currencies and shared-batch
// costs are not silently converted or apportioned across dissimilar quantity units.
export function freightOverview(orders, shipments, today) {
  const now = dateTime(today)
  if (now === null) throw new Error('Invalid overview business date')
  const byId = new Map(orders.filter(o=>!o.cancelled).map(o=>[o.id,o]))
  const records = shipments.filter(s=>!s.deletedAt&&!s.aggregate).flatMap(s=>{
    const all = allocations(s).filter(a=>Number.isFinite(a.qty)&&a.qty>0)
    const scoped = all.filter(a=>byId.has(a.order))
    if (!scoped.length) return []
    const date = dateTime(s.pgiAt || s.etd || s.reportedAt)
    const fullScope = scoped.length === all.length
    const freight = fullScope && s.freightCurrency === 'AUD' && Number.isFinite(s.freight) && s.freight >= 0 ? s.freight : null
    const goods = scoped.every(a=>priceReady(byId.get(a.order))) ? scoped.reduce((sum,a)=>{
      const o=byId.get(a.order)
      return sum+a.qty*o.unitPrice/(o.priceUnit||1)
    },0) : null
    return [{date,mode:s.mode,freight,goods}]
  })
  const undated = records.filter(r=>r.date===null).length
  const sumComplete = (rows,key,available) => available && rows.every(r=>r[key]!==null) ? rows.reduce((n,r)=>n+r[key],0) : null
  const period = (start,end) => {
    const rows=records.filter(r=>r.date!==null&&r.date>=start&&r.date<end)
    const air=rows.filter(r=>r.mode==='空运')
    const available=rows.length>0&&undated===0
    const modesKnown=rows.every(r=>['海运','空运','快递'].includes(r.mode))
    const airFreight=sumComplete(air,'freight',available&&modesKnown)
    const airValue=sumComplete(air,'goods',available&&modesKnown)
    const totalFreight=sumComplete(rows,'freight',available)
    return {count:rows.length,known:rows.filter(r=>r.freight!==null).length,airFreight,airValue,totalFreight,
      freightToValue:airFreight!==null&&airValue>0?100*airFreight/airValue:null,
      airShare:airFreight!==null&&totalFreight>0?100*airFreight/totalFreight:null}
  }
  const year=Number(today.slice(0,4)),month=Number(today.slice(5,7))-1
  const months=Array.from({length:6},(_,i)=>{
    const start=Date.UTC(year,month-6+i,1),end=Date.UTC(year,month-5+i,1)
    return {month:new Date(start).toISOString().slice(0,7),...period(start,end)}
  })
  const latest=months.at(-1),previous=months.at(-2)
  return {ytd:period(Date.UTC(year,0,1),now+dayMs),months,undated,
    monthChange:latest.airFreight!==null&&previous.airFreight>0?100*(latest.airFreight-previous.airFreight)/previous.airFreight:null,
    shareChange:latest.airShare!==null&&previous.airShare!==null?latest.airShare-previous.airShare:null}
}
