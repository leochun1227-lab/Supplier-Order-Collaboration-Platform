import { TODAY, openQty, daysLate } from './domain.mjs'

export const money = n => new Intl.NumberFormat('en-AU', { style:'currency', currency:'AUD', minimumFractionDigits:0, maximumFractionDigits:2 }).format(n)
export const percent = (n, total) => total ? (100 * n / total).toFixed(1) : '0.0'
export const transitQty = o => Math.max(0, o.shipped - o.received)
export const unshippedQty = o => Math.max(0, o.qty - o.shipped)
const sum = (rows, fn) => rows.reduce((n, row) => n + fn(row), 0)
const value = (rows, qty) => sum(rows, o => qty(o) * o.unitPrice)

export function dashboardData(orders, shipments, today = TODAY) {
  const open = orders.filter(o => openQty(o) > 0)
  const available = new Map(orders.map(o => [o.id, transitQty(o)]))
  // Allocate SAP's outstanding shipped quantity once, even with split batches.
  const batches = shipments.flatMap(s => {
    const o = orders.find(o => o.id === s.order)
    if (!o) return []
    const qty = Math.min(available.get(o.id), Math.max(0, s.qty - (s.receivedQty || 0)))
    available.set(o.id, available.get(o.id) - qty)
    return qty ? [{ ...s, orderRecord:o, outstanding:qty, goodsValue:qty * o.unitPrice }] : []
  }).sort((a,b) => a.eta.localeCompare(b.eta))
  const transport = ['海运','空运'].map(mode => {
    const rows = batches.filter(s => s.mode === mode)
    return { mode, count:rows.length, qty:sum(rows,s=>s.outstanding), value:sum(rows,s=>s.goodsValue), freight:sum(rows,s=>s.freight || 0), ids:[...new Set(rows.map(s=>s.order))] }
  })
  const unmatched = orders.filter(o=>available.get(o.id)>0)
  if (unmatched.length) transport.push({ mode:'待匹配运输', count:0, qty:sum(unmatched,o=>available.get(o.id)), value:value(unmatched,o=>available.get(o.id)), freight:0, ids:unmatched.map(o=>o.id) })
  const categories = ['生产订单','售后配件'].map(type => {
    const rows = open.filter(o => o.type === type)
    return { type, count:rows.length, qty:sum(rows,openQty), value:value(rows,openQty), transit:sum(rows,transitQty), ids:rows.map(o=>o.id) }
  })
  const ageing = [[0,15],[16,30],[31,60],[61,90],[91,Infinity]].map(([min,max]) => {
    const rows = open.filter(o => { const age=Math.floor((Date.parse(today)-Date.parse(o.created))/86400000); return age>=min&&age<=max })
    return { label:max===Infinity?'> 90 天':`${min}–${max} 天`, count:rows.length, production:rows.filter(o=>o.type==='生产订单').length, parts:rows.filter(o=>o.type==='售后配件').length, value:value(rows,openQty), ids:rows.map(o=>o.id) }
  })
  const suppliers = [...new Set(orders.map(o=>o.supplier))].map(name => {
    const rows=open.filter(o=>o.supplier===name)
    return { name, count:rows.length, confirmed:rows.filter(o=>o.confirmed).length, risk:rows.filter(o=>daysLate(o)>0).length, value:value(rows,openQty), ids:rows.map(o=>o.id) }
  })
  return { open, batches, transport, categories, ageing, suppliers,
    poCount:new Set(open.map(o=>o.po)).size, openQty:sum(open,openQty), openValue:value(open,openQty),
    totalQty:sum(orders,o=>o.qty), transitQty:sum(orders,transitQty), transitValue:value(orders,transitQty),
    unshippedQty:sum(orders,unshippedQty), receivedQty:sum(orders,o=>o.received), receivedValue:value(orders,o=>o.received),
    unconfirmed:open.filter(o=>!o.confirmed), risk:open.filter(o=>daysLate(o)>0), freight:sum(batches,s=>s.freight||0),
  }
}
