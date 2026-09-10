export let TODAY = '2026-09-08'
export function useCurrentBusinessDate(){TODAY=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export const fmt = value => Number(value || 0).toLocaleString('en-AU')
export const dateLabel = value => value ? value.slice(5).replace('-', '/') : '待确认'
export const daysLate = order => order.eta ? Math.max(0, Math.round((Date.parse(order.eta) - Date.parse(order.required)) / 86400000)) : 0
export const openQty = order => order.imported?(order.cancelled?0:Math.max(0,(order.sourceRemaining??Math.max(0,order.qty-(order.sourceReported||0)))-((order.reported??0)-(order.sourceReported||0)))):Math.max(0, order.qty - order.received)
export const canSee = (order, role) => role === 'buyer' || order.supplier === 'Longtree'
export function validateCommitment(order, batches) {
  if (!Array.isArray(batches) || !batches.length) throw new Error('请添加至少一个交付批次。')
  let total = 0
  for (const batch of batches) {
    if (!Number.isInteger(Number(batch.qty)) || Number(batch.qty) <= 0) throw new Error('每批数量必须是大于 0 的整数。')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(batch.date) || Number.isNaN(Date.parse(batch.date)) || new Date(batch.date).toISOString().slice(0, 10) !== batch.date) throw new Error('请填写有效的预计到仓日期。')
    if (batch.date < TODAY) throw new Error('新的交付承诺不能早于演示业务日期 2026-09-08。')
    total += Number(batch.qty)
  }
  if (total > openQty(order)) throw new Error('承诺数量不能超过订单未交数量。')
  return { total, partial: total < openQty(order), eta: [...batches].sort((a,b) => a.date.localeCompare(b.date)).at(-1).date }
}
export function seedOrders() {
  const prices = [32, 35, 2450, 185, 28, 112, 680, 420, 4.5, 65, 12]
  const created = ['2026-09-01','2026-09-01','2026-06-05','2026-07-15','2026-08-18','2026-08-10','2026-07-01','2026-08-04','2026-08-01','2026-09-02','2026-08-27']
  const rows = [
    ['450051727','00090','P135-01703','纱门帘 · 中门','Mosquito net curtain / middle door','Longtree','Karen A.','售后配件',120,0,0,'2026-09-18','', '待确认','海运',0],
    ['450051727','00100','P135-01710','纱门帘 · 后门','Mosquito net curtain / rear door','Longtree','Karen A.','售后配件',80,0,0,'2026-09-18','', '待确认','海运',0],
    ['450051804','00010','CHS-2400','底盘总成 · 2400','Chassis assembly / production','Longtree','Karen A.','生产订单',40,0,0,'2026-09-24','2026-10-02','生产中','海运',65],
    ['450051812','00020','WND-600L','左侧推拉窗','Sliding window / left','Longtree','Nishi A.','生产订单',240,0,120,'2026-09-22','2026-09-22','部分发运','海运',100],
    ['450051823','00010','LED-12V','12V 室内照明组件','Interior LED light kit','Longtree','Nishi A.','售后配件',300,0,300,'2026-09-15','2026-09-14','在途','空运',100],
    ['450051830','00030','PMP-45PSI','隔膜水泵 · 45 PSI','Diaphragm water pump','Northstar','Nishi A.','售后配件',60,0,0,'2026-09-25','2026-09-25','已确认','空运',0],
    ['450051836','00010','CAB-OAK-04','橡木色吊柜模块','Overhead cabinet / oak finish','Longtree','Karen A.','生产订单',36,0,0,'2026-09-28','2026-09-28','待发运','海运',100],
    ['450051840','00010','AXL-2500','车轴组件 · 2500 kg','Axle assembly','Northstar','Karen A.','生产订单',48,0,0,'2026-09-30','2026-09-30','生产中','海运',35],
    ['450051761','00020','HNG-SS-02','不锈钢门铰链','Stainless steel hinge','Longtree','Nishi A.','售后配件',500,500,500,'2026-09-05','2026-09-04','已收货','空运',100],
    ['450051851','00010','BAT-100AH','锂电池安装支架','Battery mounting bracket','Longtree','Karen A.','生产订单',96,0,0,'2026-10-06','2026-10-06','已确认','海运',0],
    ['450051856','00020','P135-01999','门框密封条','Door frame sealing strip','Longtree','Nishi A.','售后配件',200,0,0,'2026-09-26','', '待确认','海运',0],
  ]
  return rows.map((r,i) => ({
    id: `${r[0]}-${r[1]}`, po:r[0], item:r[1], part:r[2], name:r[3], en:r[4], supplier:r[5], buyer:r[6], type:r[7], qty:r[8], received:r[9], shipped:r[10], required:r[11], eta:r[12], status:r[13], mode:r[14], progress:r[15],
    created:created[i], unitPrice:prices[i], currency:'AUD', plant:'3110 · Regent AU', originalEta:r[12], confirmed:r[13]!=='待确认', pending:null,
    batches:r[12] ? (i===3 ? [{qty:120,date:'2026-09-18'},{qty:120,date:'2026-09-22'}] : [{qty:r[8],date:r[12]}]) : [],
    comments: i===2 ? [{who:'Longtree · 陈经理',time:'09/07 15:30',text:'表面处理工序排期延后，预计 10 月 2 日到仓，请采购确认能否接受。'}] : [],
    history:[{who:'SAP 同步',time:'09/01 09:00',text:'历史订单行已同步至协作平台'},...(r[12]?[{who:r[5]+' / 供应商',time:'09/02 14:20',text:`已确认交付安排，预计到仓 ${r[12]}`}]:[])],
  }))
}
export function seedIssues() {
  return [
    {id:'EX-001',order:'450051804-00010',category:'交期风险',title:'底盘交付晚于需求 8 天',detail:'供应商预计到仓 10/02，SAP 需求日期 09/24。需确认生产安排或替代交付方案。',owner:'Karen A.',priority:'高',status:'待处理',note:'',due:'2026-09-09'},
    {id:'EX-002',order:'450051856-00020',category:'数据问题',title:'物料编码待核对',detail:'SAP 编码 P135-01999 与已迁移的供应商编码 P135-01998 不一致。需采购确认正确编码，并跟踪 SAP 修正。',owner:'Nishi A.',priority:'高',status:'待处理',note:'',due:'2026-09-09'},
    {id:'EX-003',order:'450051836-00010',category:'发运跟进',title:'吊柜已备货，待确认订舱',detail:'生产进度已完成。请供应商补充订舱信息和预计离港日期。',owner:'Karen A.',priority:'中',status:'处理中',note:'已联系供应商确认本周船期。',due:'2026-09-10'},
  ]
}
export function seedShipments() {
  return [
    {id:'SHP-260901',order:'450051812-00020',qty:120,receivedQty:0,freight:2800,originalEta:'2026-09-17',mode:'海运',ref:'TLLU 4821906',carrier:'COSCO · SYDNEY',from:'宁波',to:'墨尔本仓',etd:'2026-09-02',eta:'2026-09-18',stage:2,location:'新加坡中转',updated:'09/08 08:40'},
    {id:'SHP-260904',order:'450051823-00010',qty:300,receivedQty:0,freight:3450,originalEta:'2026-09-14',mode:'空运',ref:'781-29481065',carrier:'China Eastern · MU737',from:'上海',to:'悉尼仓',etd:'2026-09-07',eta:'2026-09-14',stage:2,location:'国际运输中',updated:'09/08 09:05'},
  ]
}
