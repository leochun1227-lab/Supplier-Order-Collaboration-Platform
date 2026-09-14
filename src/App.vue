<script setup>
import { language, t as tr, setLanguage, dateLabel } from './i18n.mjs'
import { ref, computed, watch, onMounted, onUnmounted, nextTick, KeepAlive } from 'vue'
import { Button, Badge, Dialog } from 'frappe-ui'
import { Boxes, LayoutList, CalendarClock, Ship, ShieldAlert, ChartNoAxesCombined, Database, Search, ArrowUpRight, ArrowRight, ChevronRight, Check, CheckCheck, Clock3, CircleHelp, RefreshCw, Download, Plus, X, LockKeyhole, MessageSquare, PackageCheck, Factory, Plane, CircleAlert, PanelLeftClose } from 'lucide-vue-next'
import { TODAY, fmt, daysLate, openQty, canSee, validateCommitment, seedOrders, seedIssues, seedShipments } from './domain.mjs'
import Operations from './Operations.vue'
import CloudPanel from './CloudPanel.vue'
import PartsWorkbook from './PartsWorkbook.vue'
import { Table2 } from 'lucide-vue-next'
import { publicTestEnabled } from './runtime-config.mjs'
import { connectPublicWorkspace } from './public-firebase-store.mjs'
import { useCurrentBusinessDate } from './domain.mjs'
import { cloudConfigured, connectCloud } from './firebase-store.mjs'
import { copy, deleteDispatch, restoreDispatch } from './persistence.mjs'
import RecordFacts from './RecordFacts.vue'
import ReviewDialog from './ReviewDialog.vue'
import DispatchDialog from './DispatchDialog.vue'
import ShipmentEditor from './ShipmentEditor.vue'
import { isHistoricalOrder, workspaceOrders, workspaceShipments, reconcile, updateCase, resolveFact, recordDispatch, applyDemoSnapshot, validDate, label, reportedQty, allocations, updateShipment } from './reconciliation.mjs'
import { money } from './analytics.mjs'
import { translate } from './translations.mjs'

const orders=ref(workspaceOrders()), issues=ref(seedIssues().filter(i=>i.id!=='EX-002')), shipments=ref(workspaceShipments())
const checks=ref(reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt))), synced=ref(false),reviewOpen=ref(false),reviewCase=ref(null),dispatchOpen=ref(false),dispatchSelected=ref(null)
const allIssues=computed(()=>[...issues.value,...checks.value])
watch([orders,shipments],()=>{checks.value=reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt),checks.value)}, {deep:true})
const page=ref('overview'), role=ref('buyer'), query=ref(''), filter=ref('open'), type=ref('全部类型'), mode=ref('全部运输'), buyer=ref('全部采购员')
const overviewSelection=ref(null)
const selected=ref(null), detailOpen=ref(false), detailTab=ref('overview'), modal=ref(''), modalOpen=ref(false), error=ref(''), notice=ref(''), sidebar=ref(false)
const comment=ref(''), response=ref('confirm'), batches=ref([]), reason=ref(''), issueStatus=ref('处理中'), activeIssue=ref(null), activeShipment=ref(null), shipmentStage=ref(2), shipmentLocation=ref(''), shipmentEta=ref('')
let toastTimer

const importSummary=ref(null)
const cloudConnected=ref(false),cloudBusy=ref(false),cloudError=ref(''),cloudRevision=ref(0),cloudSavedAt=ref(null),cloudEmail=ref('')
const cloudStatus=computed(()=>cloudBusy.value?tr(label('正在保存／连接…','Saving / connecting…')):cloudError.value?tr(label('保存／连接失败','Save / connection failed')):cloudConnected.value?tr(label('已连接 · 更改自动保存','Connected · changes saved automatically')):tr(label('本次会话 · 未保存到云端','Session only · not saved to cloud')))
let cloud=null,pendingRemote=null,pendingToast=null,cloudGeneration=null,cloudWorkbookRevision=0
const cloudMessages={cloud_not_configured:label('等待 Firebase 登录配置。','Firebase sign-in configuration is pending.'),membership_required:label('此账户尚未获得内部试用工作区权限。','This account has no internal pilot workspace access.'),source_not_ready:label('工作区尚未初始化，请联系管理员。','Workspace has not been initialized. Contact your administrator.'),save_conflict:label('其他人已更新数据。本次更改未保存，请重新打开记录后提交。','Someone else updated these records. Your changes were not saved; reopen and submit again.'),busy:label('上一项操作正在保存，请稍候。','The previous operation is saving. Please wait.'),posted_shipment:label('已关联 SAP 发货或收货的批次不能删除，请走核对流程。','Batches linked to SAP dispatch or receipts cannot be deleted; use reconciliation.'),reason_required:label('请填写删除原因。','Enter a deletion reason.')}
function cloudMessage(e){return tr(cloudMessages[e.code]||cloudMessages[e.message]||label('操作未完成，请检查登录、权限或网络后重试。','Operation incomplete. Check sign-in, permissions or network and retry.'))}
function captureState(){return copy({orders:orders.value,shipments:shipments.value,issues:issues.value,checks:checks.value})}
function applyState(state){const id=selected.value?.id;orders.value=state.orders;shipments.value=state.shipments;issues.value=state.issues;checks.value=reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt),state.checks);selected.value=id?orders.value.find(o=>o.id===id)||null:null;activeShipment.value=shipments.value.find(s=>s.id===activeShipment.value?.id)||null;activeIssue.value=issues.value.find(i=>i.id===activeIssue.value?.id)||null}
function applyRemote(packet){if(packet.summary)importSummary.value=packet.summary;cloudGeneration=packet.generation;cloudWorkbookRevision=packet.workbookRevision||0;applyState(packet.state);cloudRevision.value=packet.revision;cloudSavedAt.value=packet.savedAt;cloudEmail.value=packet.email}
function receiveRemote(packet){if(cloudBusy.value||detailOpen.value||modalOpen.value||reviewOpen.value||dispatchOpen.value){pendingRemote=packet;return}applyRemote(packet)}
watch([detailOpen,modalOpen,reviewOpen,dispatchOpen],()=>{if(pendingRemote&&!cloudBusy.value&&!detailOpen.value&&!modalOpen.value&&!reviewOpen.value&&!dispatchOpen.value){applyRemote(pendingRemote);pendingRemote=null}})
async function loginCloud(input){if(cloudBusy.value)return;cloudBusy.value=true;cloudError.value='';try{cloud=await connectCloud(input.email,input.password,receiveRemote,e=>cloudError.value=cloudMessage(e));role.value='buyer';cloudConnected.value=true;if(pendingRemote){applyRemote(pendingRemote);pendingRemote=null}}catch(e){cloudError.value=cloudMessage(e)}finally{cloudBusy.value=false}}
async function startPublicWorkspace(){if(cloudBusy.value)return;cloudBusy.value=true;cloudError.value='';useCurrentBusinessDate();try{cloud=await connectPublicWorkspace(receiveRemote,e=>cloudError.value=cloudMessage(e));role.value='buyer';cloudConnected.value=true;if(pendingRemote){applyRemote(pendingRemote);pendingRemote=null}}catch(e){cloudError.value=cloudMessage(e)}finally{cloudBusy.value=false}}
onMounted(()=>{if(publicTestEnabled)startPublicWorkspace()})
onUnmounted(()=>{cloud?.disconnect()})
async function leaveCloud(){if(cloudBusy.value)return;await cloud?.disconnect();cloud=null;cloudConnected.value=false;cloudRevision.value=0;cloudSavedAt.value=null;cloudEmail.value='';cloudError.value='';pendingRemote=null;reset()}
async function savedAction(name,action){
  if(cloudBusy.value)throw new Error(tr(cloudMessages.busy))
  if(!cloudConnected.value){if(publicTestEnabled)throw new Error(tr(label('请先连接 Firebase 再保存。','Connect to Firebase before saving.')));return action()}
  const before=captureState(),expected=cloudRevision.value,ui={modal:modalOpen.value,review:reviewOpen.value,dispatch:dispatchOpen.value}
  cloudBusy.value=true;cloudError.value='';pendingToast=null;error.value=''
  try{action();if(error.value)throw new Error('validation_failed');await nextTick();const result=await cloud.save(captureState(),name,expected,cloudGeneration,cloudWorkbookRevision);if(result){cloudRevision.value=result.revision;cloudSavedAt.value=result.at}cloudBusy.value=false;if(pendingToast)toast(pendingToast);if(pendingRemote&&(pendingRemote.revision<cloudRevision.value||(pendingRemote.workbookRevision||0)<cloudWorkbookRevision))pendingRemote=null}
  catch(e){applyState(before);modalOpen.value=ui.modal;reviewOpen.value=ui.review;dispatchOpen.value=ui.dispatch;cloudError.value=e.message==='validation_failed'?tr(error.value):cloudMessage(e);throw new Error(cloudError.value)}
  finally{cloudBusy.value=false;pendingToast=null;if(pendingRemote&&!detailOpen.value&&!modalOpen.value&&!reviewOpen.value&&!dispatchOpen.value){applyRemote(pendingRemote);pendingRemote=null}}
}
async function submitResponse(...args){try{return await savedAction("submitResponse",()=>local_submitResponse(...args))}catch(e){error.value=e.message;toast(e.message)}}
async function submitEta(...args){try{return await savedAction("submitEta",()=>local_submitEta(...args))}catch(e){error.value=e.message;toast(e.message)}}
async function approve(...args){try{return await savedAction("approve",()=>local_approve(...args))}catch(e){error.value=e.message;toast(e.message)}}
async function rejectChange(...args){try{return await savedAction("rejectChange",()=>local_rejectChange(...args))}catch(e){error.value=e.message;toast(e.message)}}
async function sendComment(...args){try{return await savedAction("sendComment",()=>local_sendComment(...args))}catch(e){error.value=e.message;toast(e.message)}}
async function saveIssue(...args){try{return await savedAction("saveIssue",()=>local_saveIssue(...args))}catch(e){error.value=e.message;toast(e.message)}}
async function saveShipment(...args){return savedAction("saveShipment",()=>local_saveShipment(...args))}
async function performReview(...args){return savedAction("performReview",()=>local_performReview(...args))}
async function performDispatch(...args){return savedAction("performDispatch",()=>local_performDispatch(...args))}
async function saveCollaborationDates(...args){return savedAction("saveCollaborationDates",()=>local_saveCollaborationDates(...args))}

async function removeShipment(s,note){return savedAction('deleteDispatch',()=>{deleteDispatch({orders:orders.value,shipments:shipments.value},s.id,note,stamp());toast(label('报发记录已删除，数量已退回待发；历史保留。','Dispatch deleted; quantities returned to pending. History retained.'))})}
async function restoreShipment(s){try{await savedAction('restoreDispatch',()=>{restoreDispatch({orders:orders.value,shipments:shipments.value},s.id);toast(label('报发记录已恢复。','Dispatch restored.'))})}catch(e){cloudError.value=e.message}}

const nav=[{id:'overview',title:'总览看板',icon:ChartNoAxesCombined},{id:'orders',title:'订单工作台',icon:LayoutList},{id:'delivery',title:'交期与承诺',icon:CalendarClock},{id:'shipments',title:'发运与物流',icon:Ship},{id:'exceptions',title:'异常与待办',icon:ShieldAlert},{id:'reports',title:'履约分析',icon:ChartNoAxesCombined},{id:'data',title:'数据中心',icon:Database}]
const titles={orders:['订单工作台','从订单确认到交付，所有协作在这里发生。'],delivery:['交期与承诺','关注交付变化，保留每一次承诺。'],shipments:['发运与物流','按批次跟进运输，连接订单与到货。'],exceptions:['异常与待办','把风险交给明确的责任人，持续跟进结果。'],reports:['履约分析','回顾历史表现，定位交付问题与改善方向。'],data:['数据中心','SAP 持续同步，平台维护协作数据。']}
nav.splice(2,0,{id:'parts',title:{zh:'备品备件表格',en:'Parts workbook'},icon:Table2})
titles.parts=[{zh:'备品备件表格',en:'Parts workbook'},'']
const visible=computed(()=>orders.value.filter(o=>canSee(o,role.value)))
titles.overview=['总览看板','掌握订单、在途货物与交付风险。']
const visibleIssues=computed(()=>allIssues.value.filter(i=>visible.value.some(o=>o.id===i.order)||role.value==='buyer'&&i.sourceRecord))
const activeIssues=computed(()=>visibleIssues.value.filter(i=>i.status!=='已解决'&&!isHistoricalOrder(visible.value.find(o=>o.id===i.order))))
const visibleShipments=computed(()=>shipments.value.filter(s=>!s.deletedAt).filter(s=>allocations(s).some(a=>visible.value.some(o=>o.id===a.order))))
const pending=computed(()=>visible.value.filter(o=>o.pending))
const unconfirmed=computed(()=>visible.value.filter(o=>!o.confirmed))
const openOrders=computed(()=>visible.value.filter(o=>openQty(o)>0))
const stats=computed(()=>[
  {label:'未完成订单',value:new Set(openOrders.value.map(o=>o.po)).size,unit:'张 PO',sub:`${openOrders.value.length} 个订单行`,icon:LayoutList,key:'open'},
  {label:'待供应商确认',value:unconfirmed.value.length,unit:'行',sub:'等待数量与交期承诺',icon:Clock3,key:'unconfirmed'},
  {label:'交期风险',value:visible.value.filter(o=>daysLate(o)>0&&openQty(o)>0).length,unit:'行',sub:'预计到仓晚于需求日期',icon:CalendarClock,key:'risk'},
  {label:'在途数量',value:visible.value.reduce((n,o)=>n+Math.max(0,o.shipped-o.received),0),unit:'件',sub:`${visibleShipments.value.length} 个发运批次`,icon:Ship,key:'transit'},
])
const filtered=computed(()=>visible.value.filter(o=>{
  const match=`${o.po} ${o.part} ${o.name} ${o.en} ${o.supplier}`.toLowerCase().includes(query.value.toLowerCase())
  return match&&(!overviewSelection.value||overviewSelection.value.ids.includes(o.id))&&(type.value==='全部类型'||o.type===type.value)&&(mode.value==='全部运输'||o.mode===mode.value)&&(buyer.value==='全部采购员'||o.buyer===buyer.value)&&
  (filter.value==='all'||(filter.value==='open'&&openQty(o)>0)||(filter.value==='unconfirmed'&&!o.confirmed)||(filter.value==='risk'&&daysLate(o)>0&&openQty(o)>0)||(filter.value==='transit'&&o.shipped>o.received)||(filter.value==='received'&&openQty(o)===0))
}))
const deliveryOrders=computed(()=>visible.value.filter(o=>openQty(o)>0).sort((a,b)=>(Number(!!b.pending)-Number(!!a.pending))||daysLate(b)-daysLate(a)))
const statusTheme=o=>o.pending?'orange':o.status==='待确认'?'orange':o.status==='已收货'?'green':o.status==='在途'||o.status==='部分发运'?'blue':'gray'
const selectedIssues=computed(()=>selected.value?allIssues.value.filter(i=>i.order===selected.value.id):[])
const selectedShipments=computed(()=>selected.value?shipments.value.filter(s=>!s.deletedAt&&allocations(s).some(a=>a.order===selected.value.id)):[])
const modalTitle=computed(()=>({response:'供应商订单响应',eta:'提交交期变更',resolve:'处理异常',shipment:'更新物流进展',reset:'重置演示数据',help:'如何体验这个预览',reject:'退回交期变更'}[modal.value]||'协作操作'))
const scopeLabel=computed(()=>role.value==='buyer'?'全部供应商':'Longtree 专属视图')

function toast(text){if(cloudBusy.value){pendingToast=text;return}notice.value=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>notice.value='',4200)}
function navigate(id){if((id==='data'||id==='parts')&&role.value!=='buyer')return;page.value=id;sidebar.value=false;detailOpen.value=false}
function inspectOverview(selection){overviewSelection.value=selection;query.value='';type.value='全部类型';mode.value='全部运输';buyer.value='全部采购员';filter.value='all';navigate('orders')}
watch(role,()=>overviewSelection.value=null)
function openOrder(order,tab='overview'){selected.value=order;detailTab.value=tab;detailOpen.value=true;comment.value=''}
function openModal(kind){modal.value=kind;error.value='';reason.value='';modalOpen.value=true}
function startResponse(){response.value='confirm';batches.value=[{qty:openQty(selected.value),date:selected.value.eta||selected.value.required}];openModal('response')}
function startEta(){batches.value=selected.value.batches.map(b=>({...b}));if(!batches.value.length)batches.value=[{qty:openQty(selected.value),date:selected.value.required}];openModal('eta')}
function stamp(){return new Date().toISOString()}
function addEvent(order,text,english){if(!order)return;if(english)text={zh:text,en:english};order.history.unshift({who:role.value==='buyer'?'Regent · 采购':'Longtree · 供应商',time:stamp(),text})}
function local_submitResponse(){try{
  const order=selected.value
  if(role.value!=='supplier'||!canSee(order,role.value))throw new Error('请切换到 Longtree 供应商视角进行响应。')
  if(order.confirmed)throw new Error('该订单已确认，请使用交期变更。')
  if(response.value!=='confirm'){
    if(!reason.value.trim())throw new Error('请填写原因，便于采购跟进。')
    order.status=response.value==='reject'?'无法供货':'请求调整';
    const existing=issues.value.find(i=>i.order===order.id&&i.category==='供应商响应'&&i.status!=='已解决')
    if(existing){existing.detail=reason.value.trim();existing.userEntered=true;existing.title={zh:order.status+' · '+order.name,en:translate(order.status,'en')+' · '+order.en}}
    else issues.value.unshift({id:`EX-${issues.value.length+1}`,order:order.id,category:'供应商响应',title:{zh:order.status+' · '+order.name,en:translate(order.status,'en')+' · '+order.en},userEntered:true,detail:reason.value.trim(),owner:order.buyer,priority:'高',status:'待处理',note:'',due:'2026-09-09'})
    addEvent(order,order.status+'：'+reason.value.trim(),translate(order.status,'en')+': '+reason.value.trim())
  }else{
    const result=validateCommitment(order,batches.value)
    if(result.partial&&!reason.value.trim())throw new Error('部分确认时，请说明剩余数量的处理计划。')
    order.batches=batches.value.map(b=>({qty:Number(b.qty),date:b.date}));order.eta=result.eta;order.originalEta ||=result.eta;order.confirmed=true;order.status=result.partial?'部分确认':'已确认'
    addEvent(order,`已${result.partial?'部分':''}确认 ${result.total} 件，分 ${order.batches.length} 批交付。${reason.value}`,`${result.partial?'Partially confirmed':'Confirmed'} ${result.total} units across ${order.batches.length} batches. ${reason.value}`)
    if(result.partial) issues.value.unshift({id:`EX-${issues.value.length+1}`,order:order.id,category:'部分确认',title:`剩余 ${openQty(order)-result.total} 件待承诺`,userEntered:true,detail:reason.value,owner:order.buyer,priority:'中',status:'待处理',note:'',due:'2026-09-10'})
  }
  modalOpen.value=false;detailTab.value='commitment';toast('响应已记录，采购视角已同步更新。')
}catch(e){error.value=e.message}}
function local_submitEta(){try{
  const o=selected.value
  if(!o.confirmed||o.shipped>0)throw new Error('仅支持对已确认且未发运订单提交变更。')
  if(o.pending)throw new Error('已有一项交期变更等待采购审核。')
  if(!reason.value.trim())throw new Error('请填写交期变更原因。')
  const result=validateCommitment(o,batches.value)
  o.pending={batches:batches.value.map(b=>({qty:Number(b.qty),date:b.date})),eta:result.eta,reason:reason.value.trim(),who:role.value==='supplier'?'Longtree':'Regent 代录'}
  addEvent(o,`提出交期变更：${o.eta} → ${result.eta}。原因：${reason.value}`,`Date change proposed: ${o.eta} → ${result.eta}. Reason: ${reason.value}`);modalOpen.value=false;toast('变更已提交；采购接受前，原承诺保持有效。')
}catch(e){error.value=e.message}}
function local_approve(o){if(role.value!=='buyer'||!o.pending)return;const p=o.pending;o.eta=p.eta;o.batches=p.batches;o.pending=null;addEvent(o,`采购接受交期变更，新预计到仓日期 ${o.eta}`);toast('已接受变更，交期视图和报表已更新。')}
function local_rejectChange(){if(!reason.value.trim()){error.value='请填写退回原因。';return}if(role.value!=='buyer'||!selected.value?.pending)return;addEvent(selected.value,'采购退回交期变更：'+reason.value,'Buyer returned date change: '+reason.value);selected.value.pending=null;modalOpen.value=false;toast('已退回变更，保留原交付承诺。')}
function local_sendComment(){if(!comment.value.trim())return;selected.value.comments.unshift({who:role.value==='buyer'?'Regent · 采购':'Longtree · 供应商',time:stamp(),userEntered:true,text:comment.value.trim()});addEvent(selected.value,'添加了订单沟通记录');comment.value='';toast('留言已加入订单记录。')}
function startIssue(i){activeIssue.value=i;issueStatus.value=i.status==='已解决'?'处理中':i.status;openModal('resolve');reason.value=i.note||''}
function local_saveIssue(){if(role.value!=='buyer')return;if(!reason.value.trim()){error.value='请填写处理记录或关闭依据。';return}activeIssue.value.status=issueStatus.value;activeIssue.value.note=reason.value.trim();activeIssue.value.noteUserEntered=true;addEvent(orders.value.find(o=>o.id===activeIssue.value.order),`${activeIssue.value.id} ${issueStatus.value}：${reason.value}`,`${activeIssue.value.id} ${translate(issueStatus.value,'en')}: ${reason.value}`);modalOpen.value=false;toast('处理记录已更新。订单事实与交期风险按实际数据计算。')}
function startShipment(s){activeShipment.value=s;shipmentStage.value=s.stage;shipmentLocation.value=tr(s.location);shipmentEta.value=s.eta;openModal('shipment')}
function local_saveShipment(input){
  const s=activeShipment.value
  if(!s||!allocations(s).every(a=>visible.value.some(o=>o.id===a.order)))throw new Error(tr(label('当前角色不能修改此批次。','This batch is outside the current role scope.')))
  try{updateShipment(s,input,stamp());for(const a of allocations(s))addEvent(orders.value.find(o=>o.id===a.order),`更新批次 ${s.id}：${input.note}`,`Updated batch ${s.id}: ${input.note}`);checks.value=reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt),checks.value);toast(label('物流与延期信息已保存，所有关联订单已更新。','Logistics and delay saved. All linked orders updated.'))}catch(e){throw new Error(tr(actionErrors[e.message]||e.message))}
}
function exportOrders(){const quote=s=>'"'+String(s).replaceAll('"','""')+'"';const csv='\uFEFF'+[['PO','订单行','物料编码','供应商','订购数量','已收数量','未交数量','需求日期','承诺到仓','状态'],...filtered.value.map(o=>[o.po,o.item,o.part,o.supplier,o.qty,o.received,openQty(o),o.required,o.eta,o.status])].map(r=>r.map(value=>quote(tr(value))).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=tr('Regent-演示订单.csv');a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('已导出当前筛选范围的演示订单。')}
function reset(){if(cloudConnected.value){modalOpen.value=false;toast(label('云端工作区不能重置演示数据。','Cloud workspaces cannot reset demo data.'));return}overviewSelection.value=null;orders.value=workspaceOrders();issues.value=seedIssues().filter(i=>i.id!=='EX-002');shipments.value=workspaceShipments();checks.value=reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt));synced.value=false;selected.value=null;detailOpen.value=false;modalOpen.value=false;query.value='';filter.value='open';toast('演示已恢复初始状态。')}
watch(role,()=>{reviewOpen.value=false;dispatchOpen.value=false;selected.value=null;detailOpen.value=false;modalOpen.value=false;buyer.value='全部采购员';if(page.value==='data')page.value='orders';toast(role.value==='supplier'?'已切换：Longtree 供应商，只展示本供应商的模拟订单。':'已切换：Regent 内部采购，可审核变更和处理异常。')})
onUnmounted(()=>clearTimeout(toastTimer))

const actionErrors={shipment_invalid:label('请填写有效的运输方式、节点与延期状态。','Choose valid transport, milestone and delay states.'),shipment_reason:label('请填写更新说明；已知延期或 ETA 延后还需填写延期原因。','Enter an update note and a reason for reported delay or a later ETA.'),evidence_required:label('请填写责任人、有效期限和确认依据。','Enter an owner, valid due date and supporting evidence.'),factor_invalid:label('换算系数必须为正数。','Conversion factor must be positive.'),so_required:label('请填写有效的 SO 引用。','Enter a valid SO reference.'),date_invalid:label('请填写有效日期；新承诺不能早于演示业务日。','Enter a valid date; new commitments cannot precede the demo date.'),source_required:label('请等待源数据核对，备注不能消除差异。','Source reconciliation is required; notes cannot clear the discrepancy.'),quantity_invalid:label('分配数量须大于零且不超过剩余待发，同一行不能重复。','Allocation must be positive, within remaining dispatch quantity, and unique per line.'),dispatch_required:label('请填写报发日期、箱号或运单，并分配订单数量。','Enter a dispatch date, reference and order allocations.'),supplier_mismatch:label('同一批次须属于同一供应商。','A batch must belong to one supplier.'),currency_unconfirmed:label('当前货值仅支持已确认 AUD 计价。','Confirmed value currently supports AUD prices only.')}
function review(c){if(!visibleIssues.value.some(i=>i.id===c.id))return;if(c.rule){reviewCase.value=c;reviewOpen.value=true}else if(role.value==='buyer')startIssue(c);else openOrder(visible.value.find(o=>o.id===c.order),'activity')}
function local_performReview(c,input){
  if(role.value!=='buyer')throw new Error(tr(label('需要内部采购确认。','Internal purchasing confirmation required.')))
  try{
    const actual=checks.value.find(i=>i.id===c.id),o=visible.value.find(o=>o.id===c.order)
    if(!actual||!o)throw new Error('case_missing')
    const staged={...actual,log:[...(actual.log||[])]};updateCase([staged],c.id,input)
    const copy={...o};if(input.action==='confirm')resolveFact(copy,c.kind,input,input.note)
    Object.assign(actual,staged);if(input.action==='confirm')Object.assign(o,copy)
    addEvent(o,label('核对记录：','Review: ').zh+input.note,'Review: '+input.note)
    checks.value=reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt),checks.value)
    toast(label('记录已保存，关联页面已重新核对。','Saved. Linked views have been reconciled.'))
  }catch(e){throw new Error(tr(actionErrors[e.message]||e.message))}
}
function startDispatch(o){dispatchSelected.value=o?.id?o:null;dispatchOpen.value=true}
function local_performDispatch(input){try{if(input.allocations.some(a=>!visible.value.some(o=>o.id===a.order)))throw new Error('order_missing');const id=recordDispatch(orders.value,shipments.value,input);for(const a of input.allocations)addEvent(orders.value.find(o=>o.id===a.order),`登记业务报发 ${id}`,`Recorded dispatch ${id}`);checks.value=reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt),checks.value);toast(label('报发已登记；SAP 过账保持独立。','Dispatch recorded; SAP PGI remains separate.'))}catch(e){throw new Error(tr(actionErrors[e.message]||e.message))}}
function syncDemo(){if(cloudConnected.value){toast(label('云端 SAP 快照由同步端维护。','Cloud SAP snapshots are maintained by the sync agent.'));return}if(role.value!=='buyer')return;if(applyDemoSnapshot(orders.value,shipments.value)){synced.value=true;for(const o of orders.value.filter(o=>o.po==='450051727'))addEvent(o,'接收后续 SAP 示例快照，关联交货单 DEMO-DLV-003','Received later demo SAP snapshot; linked DEMO-DLV-003');checks.value=reconcile(orders.value,shipments.value.filter(s=>!s.deletedAt),checks.value);toast(label('示例过账已匹配，原报发记录保持不变。','Demo PGI matched. Original dispatch reports are unchanged.'))}}
function local_saveCollaborationDates(o,input){
  if(!visible.value.some(r=>r.id===o.id))return
  if(input.auEta&&!validDate(input.auEta))throw new Error(tr(label('请填写有效的澳洲 ETA。','Enter a valid AU ETA.')))
  if(!input.reason.trim()||(input.etd&&(!validDate(input.etd)||input.etd!==o.promisedEtd&&input.etd<TODAY))||(input.china&&!validDate(input.china))||(input.delayStatus==='delayed'&&!input.delayReason?.trim()))throw new Error(tr(label('请填写有效日期、更新说明及延期原因。','Enter valid dates, an update note and a delay reason when delayed.')))
  const old={eta:o.eta,etd:o.promisedEtd,china:o.chinaEta,delayStatus:o.dispatchDelayStatus||'unknown',delayReason:o.dispatchDelayReason||'',plan:o.remainingPlan||''}
  if(o.imported&&typeof input.auEta==='string'){o.eta=input.auEta;o.originalEta ||=input.auEta}
  o.promisedEtd=input.etd;o.chinaEta=input.china;o.dispatchReason=input.reason;o.dispatchDelayStatus=input.delayStatus||old.delayStatus;o.dispatchDelayReason=input.delayReason?.trim()||'';o.remainingPlan=input.plan?.trim()||''
  o.dispatchUpdates=[{at:stamp(),before:old,after:{eta:o.eta,etd:o.promisedEtd,china:o.chinaEta,delayStatus:o.dispatchDelayStatus,delayReason:o.dispatchDelayReason,plan:o.remainingPlan},note:input.reason},...(o.dispatchUpdates||[])]
  addEvent(o,`发运承诺 ${old.etd||'TBD'} → ${input.etd||'TBD'}；${input.reason}`,`Dispatch commitment ${old.etd||'TBD'} → ${input.etd||'TBD'}; ${input.reason}`);toast(label('协作日期与延期安排已更新。','Collaboration dates and delay follow-up updated.'))
}

const toolLifecycle=new AbortController()
onMounted(()=>{
  const context=document.modelContext
  if(!context?.registerTool)return
  const tools=[
    {name:'read_demo_orders',description:'Read the fictional orders visible to the current demo role.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>visible.value.map(o=>({id:o.id,po:o.po,part:o.part,status:o.status,eta:o.eta,openQty:openQty(o)}))},
    {name:'open_demo_order',description:'Open an order detail in the current demo role. Does not modify the order.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async input=>{if(!input||typeof input.id!=='string')throw new Error('An order id is required');const order=visible.value.find(o=>o.id===input.id);if(!order)throw new Error('Order not available in current demo scope');openOrder(order);await nextTick();return {opened:order.id}}},
  ]
  for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:toolLifecycle.signal})).catch(()=>{})}catch{}}
})
onUnmounted(()=>toolLifecycle.abort())
</script>

<template>
  <div class="workspace" :class="{'overview-layout':page==='overview','parts-layout':page==='parts'}" @keydown.esc="sidebar=false">
    <aside id="workspace-navigation" class="sidebar" :class="{mobileOpen:sidebar}" :inert="page==='parts'&&!sidebar">
      <button v-if="page==='parts'" class="parts-nav-close" :aria-label="tr(label('收起导航','Hide navigation'))" @click="sidebar=false"><X :size="18"/>{{tr(label('收起导航','Hide navigation'))}}</button>
      <a class="brand" href="#/" @click.prevent="navigate('overview')"><span class="brandmark"><Boxes :size="23"/></span><span>REGENT<small>SUPPLIER COLLABORATION</small></span></a>
      <div class="workspace-label">{{tr("采购与供应商协作")}} <span>AU / CN</span></div>
      <nav :aria-label="tr(&quot;主要导航&quot;)"><button v-for="n in nav.filter(n=>role==='buyer'||!['data','parts'].includes(n.id))" :key="n.id" :class="['navitem',{active:page===n.id}]" @click="navigate(n.id)"><component :is="n.icon" :size="19"/><span>{{tr(n.title)}}</span><span v-if="n.id==='exceptions'&&activeIssues.length" class="navcount">{{tr(activeIssues.length)}}</span></button></nav>
      <div class="sidebar-bottom"><div class="connection"><span class="live-dot"></span><div>{{tr("SAP + 协作平台")}}<small>{{publicTestEnabled?tr(label('真实台账 · 公开测试','Imported ledger · public test')):tr('演示环境 · 业务日期 09/08')}}</small></div></div><button class="help-link" @click="openModal('help')"><CircleHelp :size="17"/> {{tr("预览说明")}} <ArrowUpRight :size="15"/></button><a href="https://github.com/frappe/frappe-ui" target="_blank" rel="noreferrer" class="powered">Built with Frappe UI ↗</a></div>
    </aside>
    <button v-if="page==='parts'&&sidebar" class="parts-nav-backdrop" :aria-label="tr(label('收起导航','Hide navigation'))" @click="sidebar=false"/>
    <div class="main-shell">
      <header v-if="page!=='parts'" class="topbar"><div class="crumb"><button class="mobile-menu" :aria-label="tr(sidebar?label('收起导航','Hide navigation'):label('展开导航','Show navigation'))" :aria-expanded="sidebar" aria-controls="workspace-navigation" @click="sidebar=!sidebar"><PanelLeftClose :size="19"/><span v-if="page==='parts'">{{tr(label('导航','Navigation'))}}</span></button><template v-if="page!=='parts'"><span>{{tr("供应商协作")}}</span><ChevronRight :size="14"/><strong>{{tr(titles[page][0])}}</strong></template><span v-else class="parts-brand">REGENT</span></div><div class="topbar-right"><button v-if="page!=='parts'" class="demo-chip" @click="navigate('data')">{{cloudStatus}}</button><div class="language-switch" role="group" :aria-label="tr('语言切换')"><button type="button" lang="zh-CN" :aria-pressed="language==='zh'" @click="setLanguage('zh')">中文</button><button type="button" lang="en" :aria-pressed="language==='en'" @click="setLanguage('en')">English</button></div><label v-if="!cloudConnected&&!publicTestEnabled" class="role-select"><span class="avatar">{{tr(role==='buyer'?'R':'L')}}</span><select v-model="role" :aria-label="tr(&quot;切换演示角色&quot;)"><option value="buyer">{{tr("Regent · 内部采购")}}</option><option value="supplier">{{tr("Longtree · 供应商")}}</option></select></label></div></header>
      <section v-if="publicTestEnabled&&!cloudConnected&&page!=='parts'" class="cloud-panel"><h2>{{tr(label('正在连接真实台账','Connecting to imported records'))}}</h2><p>{{cloudError||tr(label('从 Firebase 加载完整数据…','Loading the complete dataset from Firebase…'))}}</p><Button v-if="!cloudBusy" @click="startPublicWorkspace">{{tr(label('重新连接','Reconnect'))}}</Button></section>
      <main v-if="!publicTestEnabled||cloudConnected||page==='parts'" :inert="cloudBusy&&page!=='parts'" :class="{'overview-main':page==='overview','orders-main':page==='orders','parts-main':page==='parts'}">
        <div v-if="page==='orders'" class="orders-toolbar">
          <div class="orders-title-group"><h1>{{tr(titles.orders[0])}}</h1><span class="orders-scope">{{tr(scopeLabel)}}</span></div>
          <div class="orders-actions"><Button variant="outline" @click="openModal('reset')"><template #prefix><RefreshCw :size="14"/></template>{{tr("重置演示")}}</Button></div>
        </div>
        <div v-else-if="page!=='overview'&&page!=='parts'" class="page-heading"><div><div class="eyebrow">{{tr(scopeLabel)}}<span> / </span> ORDER COLLABORATION</div><h1>{{tr(titles[page][0])}}</h1><p>{{tr(titles[page][1])}}</p></div><div class="heading-actions"><Button variant="outline" size="lg" @click="openModal('reset')"><template #prefix><RefreshCw :size="15"/></template>{{tr("重置演示")}}</Button></div></div>

        <KeepAlive><PartsWorkbook v-if="page==='parts'" @saved="cloud?.updateWorkbook?.($event)"><template #navigation><button class="mobile-menu" :aria-label="tr(sidebar?label('收起导航','Hide navigation'):label('展开导航','Show navigation'))" :aria-expanded="sidebar" aria-controls="workspace-navigation" @click="sidebar=!sidebar"><PanelLeftClose :size="19"/><span v-if="page==='parts'">{{tr(label('导航','Navigation'))}}</span></button></template><template #header-actions><div class="topbar-right"><button v-if="page!=='parts'" class="demo-chip" @click="navigate('data')">{{cloudStatus}}</button><div class="language-switch" role="group" :aria-label="tr('语言切换')"><button type="button" lang="zh-CN" :aria-pressed="language==='zh'" @click="setLanguage('zh')">中文</button><button type="button" lang="en" :aria-pressed="language==='en'" @click="setLanguage('en')">English</button></div><label v-if="!cloudConnected&&!publicTestEnabled" class="role-select"><span class="avatar">{{tr(role==='buyer'?'R':'L')}}</span><select v-model="role" :aria-label="tr(&quot;切换演示角色&quot;)"><option value="buyer">{{tr("Regent · 内部采购")}}</option><option value="supplier">{{tr("Longtree · 供应商")}}</option></select></label></div></template></PartsWorkbook></KeepAlive>
        <CloudPanel v-if="page==='data'" :configured="cloudConfigured||publicTestEnabled" :public-test="publicTestEnabled" :summary="importSummary" :connected="cloudConnected" :busy="cloudBusy" :status="cloudStatus" :error="cloudError" :email="cloudEmail" :revision="cloudRevision" :saved-at="cloudSavedAt" :deleted="shipments.filter(s=>s.deletedAt)" @connect="loginCloud" @disconnect="leaveCloud" @restore="restoreShipment"/>
        <div v-if="publicTestEnabled&&importSummary&&page!=='parts'" class="import-strip"><b>{{tr(label('真实台账 · Firebase 公开测试','Imported records · Firebase public test'))}}</b><span>{{importSummary.masterRecords}} {{tr(label('条主记录','master records'))}} · {{importSummary.masterCompletion.NG}} {{tr(label('条未完成标记','marked open'))}} · {{tr(label('台账截至 09/04；SAP 收货与在途尚待核对','Ledger as of 04 Sep; SAP receipts and transit need verification'))}}</span></div>
        <Operations v-if="['overview','orders','exceptions','data','shipments'].includes(page)" :view="page" :orders="visible" :shipments="visibleShipments" :issues="visibleIssues" :role="role" :selection="overviewSelection" :synced="synced" @inspect="inspectOverview" @open-order="openOrder" @navigate="navigate" @reset="openModal('reset')" @clear-selection="overviewSelection=null" @review="review" @dispatch="startDispatch" @sync="syncDemo" @shipment="startShipment"/>
        <template v-else-if="page==='delivery'">
          <div class="section-summary"><span><strong>{{tr(pending.length)}}</strong> {{tr("项变更待审核")}}</span><span><strong>{{tr(visible.filter(o=>daysLate(o)>0&&openQty(o)>0).length)}}</strong> {{tr("行存在交期风险")}}</span><span>{{tr("日期统一表示")}} <b>{{tr("预计到仓")}}</b></span></div>
          <section class="panel"><div class="panel-heading"><h2>{{tr("交付承诺")}}</h2><span class="muted">{{tr("需求 → 当前承诺 → 变更申请")}}</span></div><div v-for="o in deliveryOrders" :key="o.id" class="delivery-row"><div><button class="order-link" @click="openOrder(o,'commitment')">{{tr(o.po)}} <span>/ {{tr(o.item)}}</span></button><p>{{tr(o.name)}}</p><small>{{tr(o.supplier)}} · {{tr(o.buyer)}}</small></div><div class="date-block"><small>{{tr("SAP 需求到仓")}}</small><strong>{{tr(dateLabel(o.required))}}</strong></div><ArrowRight class="muted" :size="17"/><div class="date-block"><small>{{tr("当前承诺到仓")}}</small><strong :class="{'danger-text':daysLate(o)>0}">{{tr(dateLabel(o.eta))}}</strong></div><div class="delivery-status"><Badge v-if="o.pending" theme="orange" size="lg">{{tr("申请")}} {{tr(dateLabel(o.pending.eta))}}</Badge><Badge v-else-if="daysLate(o)>0" theme="red" size="lg">{{tr("延后")}} {{tr(daysLate(o))}} {{tr("天")}}</Badge><Badge v-else :theme="o.eta?'green':'gray'" size="lg">{{tr(o.eta?'按计划':'待确认')}}</Badge></div><Button variant="outline" @click="openOrder(o,'commitment')">{{tr(o.pending&&role==='buyer'?'审核变更':'查看安排')}}</Button></div></section>
        </template>





        <template v-else-if="page==='reports'">
          <section class="panel analysis-panel">
            <div class="analysis-intro"><ChartNoAxesCombined :size="26"/><div><h2>{{tr('历史履约分析')}}</h2><p>{{tr('当前演示仅包含订单快照，尚不足以计算历史绩效。接入完整记录后，将在这里按月、季度和供应商进行对比。')}}</p></div><Badge theme="gray">{{tr('待接入历史数据')}}</Badge></div>
            <div class="table-scroll"><table class="analysis-table"><thead><tr><th>{{tr('分析方向')}}</th><th>{{tr('关注的问题')}}</th><th>{{tr('所需历史记录')}}</th></tr></thead><tbody>
              <tr><td>{{tr('供应商响应效率')}}</td><td>{{tr('订单多久被确认，哪些供应商响应较慢')}}</td><td>{{tr('订单通知时间、首次响应与确认时间')}}</td></tr>
              <tr><td>{{tr('承诺兑现与交期变化')}}</td><td>{{tr('首次承诺是否兑现，交期为何反复调整')}}</td><td>{{tr('承诺版本、变更原因、实际到仓与收货记录')}}</td></tr>
              <tr><td>{{tr('运输表现与延期原因')}}</td><td>{{tr('运输耗时与 ETA 偏差主要集中在哪些环节')}}</td><td>{{tr('历史运输节点、ETA 版本及异常原因')}}</td></tr>
            </tbody></table></div>
            <footer class="analysis-footer"><span>{{tr('当前订单、在途数量和货值请查看总览；数据核对由数据中心负责。')}}</span><Button variant="outline" @click="navigate('overview')">{{tr('返回总览')}}</Button><Button v-if="role==='buyer'" variant="outline" @click="navigate('data')">{{tr('数据中心')}}</Button></footer>
          </section>
        </template>


      </main>
    </div>
    <div v-if="notice" class="toast" role="status"><Check :size="18"/>{{tr(notice)}}<button @click="notice=''" :aria-label="tr(&quot;关闭提示&quot;)"><X :size="15"/></button></div>

    <Dialog v-model="detailOpen" :options="{title:tr('订单详情'),size:'3xl'}"><template #body-content><div v-if="selected" class="order-detail"><div class="detail-title"><div><div class="eyebrow">PURCHASE ORDER / {{tr(selected.item)}}</div><h2>{{tr(selected.po)}}</h2><p>{{tr(selected.name)}}</p><small>{{tr(selected.part)}} · {{tr(selected.supplier)}}</small></div><Badge :theme="statusTheme(selected)" size="lg">{{tr(selected.pending?'变更待审核':reportedQty(selected)>selected.shipped?{zh:'业务报发 · 待核实',en:'Reported · unverified'}:selected.status)}}</Badge></div><div class="detail-tabs"><button v-for="t in [['overview',{zh:'订单与关联',en:'Order & links'}],['commitment',{zh:'交期与沟通',en:'Dates & commitments'}],['logistics',{zh:'装运与收货',en:'Dispatch & receipts'}],['activity',{zh:'核对与记录',en:'Review & history'}]]" :key="t[0]" :class="{active:detailTab===t[0]}" @click="detailTab=t[0]">{{tr(t[1])}}</button></div>
      <RecordFacts :order="selected" :shipments="visibleShipments" :issues="selectedIssues" :tab="detailTab" :role="role" :save-dates="saveCollaborationDates" @review="review" @dispatch="startDispatch" @shipment="startShipment"/>
      <div v-if="detailTab==='overview'" class="detail-bottom-action"><Button variant="outline" @click="detailTab='commitment'">{{tr('查看交付承诺')}}</Button><Button v-if="role==='supplier'&&!selected.confirmed" variant="solid" class="primary" @click="startResponse">{{tr('响应订单')}}</Button></div>
      <template v-if="detailTab==='commitment'"><div class="commitment-dates"><div><small>{{tr("需求到仓 · SAP")}}</small><strong>{{tr(dateLabel(selected.required))}}</strong></div><ArrowRight :size="18"/><div><small>{{tr("当前承诺 · 平台")}}</small><strong :class="{'danger-text':daysLate(selected)>0}">{{tr(dateLabel(selected.eta))}}</strong></div></div><div v-if="selected.pending" class="pending-change"><div><Badge theme="orange">{{tr("变更待审核")}}</Badge><strong>{{tr("申请到仓")}} {{tr(selected.pending.eta)}}</strong><p>{{selected.pending.reason}}</p><small>{{tr(selected.pending.who)}} {{tr("提出 · 当前承诺在审核前不变")}}</small></div><div v-if="role==='buyer'" class="button-row"><Button variant="outline" @click="openModal('reject')">{{tr("退回")}}</Button><Button variant="solid" class="primary" @click="approve(selected)">{{tr("接受变更")}}</Button></div></div><div class="detail-subheading"><h3>{{tr("分批交付安排")}}</h3><span>{{tr("已承诺")}} {{tr(fmt(selected.batches.reduce((n,b)=>n+b.qty,0)))}} {{selected?.unit||'EA'}}</span></div><div v-if="!selected.batches.length" class="mini-empty"><CalendarClock :size="27"/><p>{{tr("供应商尚未提交交付承诺")}}</p></div><div v-for="(b,index) in selected.batches" :key="index" class="batch-row"><span class="batch-number">{{tr(String(index+1).padStart(2,'0'))}}</span><div><small>{{tr("交付数量")}}</small><strong>{{tr(fmt(b.qty))}} {{selected?.unit||'EA'}}</strong></div><div><small>{{tr("预计到仓")}}</small><strong>{{tr(b.date)}}</strong></div><Badge theme="gray">{{tr(selected.mode)}}</Badge></div><p class="muted detail-hint">{{tr("交付批次表示数量与到仓承诺；实际发运记录单独跟踪。")}}</p><div class="button-row"><Button v-if="role==='supplier'&&!selected.confirmed" variant="solid" class="primary" size="lg" @click="startResponse">{{tr("响应订单 / 分批确认")}}</Button><Button v-if="selected.confirmed&&!selected.shipped&&!selected.pending" variant="solid" class="primary" size="lg" @click="startEta">{{tr("提交交期变更")}}</Button></div><p v-if="selected.shipped>0" class="info-box">{{tr("该订单已有发运，运输时间请在发运记录中跟进。")}}</p></template>
      <template v-if="detailTab==='activity'"><div class="comment-compose"><label for="order-comment">{{tr("订单沟通")}}</label><textarea id="order-comment" v-model="comment" rows="3" :placeholder="tr(&quot;补充交期原因、跟进进展或供应商说明…&quot;)"></textarea><div><small>{{tr(role==='buyer'?'以 Regent 采购身份留言':'以 Longtree 供应商身份留言')}}</small><Button variant="solid" class="primary" :disabled="!comment.trim()" @click="sendComment">{{tr("发送留言")}}</Button></div></div><div v-for="(c,i) in selected.comments" :key="i" class="comment"><span class="comment-avatar"><MessageSquare :size="16"/></span><div><strong>{{tr(c.who)}}</strong><small>{{tr(c.time)}}</small><p>{{c.userEntered?c.text:tr(c.text)}}</p></div></div><h3 class="history-heading">{{tr("操作历史")}}</h3><div class="timeline"><div v-for="(e,i) in [...selected.history].sort((a,b)=>b.time.localeCompare(a.time))" :key="i"><i></i><small>{{tr(e.time)}} · {{tr(e.who)}}</small><p>{{tr(e.text)}}</p></div></div></template>
    </div></template></Dialog>

    <ReviewDialog v-model="reviewOpen" :issue="reviewCase" :order="orders.find(o=>o.id===reviewCase?.order)" :role="role" :perform="performReview" @open-order="openOrder"/>
    <DispatchDialog v-model="dispatchOpen" :orders="visible" :selected="dispatchSelected" :perform="performDispatch"/>
    <ShipmentEditor :model-value="modalOpen && modal==='shipment'" :shipment="activeShipment" :perform="saveShipment" :remove="removeShipment" @update:model-value="modalOpen=$event"/>
    <Dialog v-if="modal!=='shipment'" v-model="modalOpen" :options="{title:tr(modalTitle),size:modal==='help'?'xl':'lg'}"><template #body-content>
      <template v-if="modal==='response'||modal==='eta'"><div class="modal-context">{{tr(selected?.po)}} / {{tr(selected?.item)}}<strong>{{tr(selected?.name)}}</strong><span>{{tr("未交")}} {{tr(fmt(openQty(selected)))}} {{selected?.unit||'EA'}} · {{tr("需求到仓日期")}} {{tr(selected?.required)}}</span></div><div v-if="modal==='response'" class="response-options"><button v-for="r in [['confirm','确认供货'],['change','请求调整'],['reject','无法供货']]" :key="r[0]" :class="{active:response===r[0]}" @click="response=r[0]">{{tr(r[1])}}</button></div><template v-if="modal==='eta'||response==='confirm'"><div class="form-heading"><strong>{{tr(modal==='eta'?'新的交付安排':'交付安排')}}</strong><Button variant="ghost" @click="batches.push({qty:1,date:selected.required})"><template #prefix><Plus :size="14"/></template>{{tr("添加批次")}}</Button></div><div v-for="(b,i) in batches" :key="i" class="batch-form"><label>{{tr("第")}} {{tr(i+1)}} {{tr("批数量")}}<input v-model="b.qty" type="number" min="1" step="1"/></label><label>{{tr("预计到仓日期")}}<input v-model="b.date" type="date" :min="TODAY"/></label><button v-if="batches.length>1" @click="batches.splice(i,1)" :aria-label="tr(&quot;删除此批次&quot;)"><X :size="16"/></button></div><p class="form-total">{{tr("本次承诺")}} <b>{{tr(fmt(batches.reduce((n,b)=>n+Number(b.qty||0),0)))}}</b> / {{tr(fmt(openQty(selected)))}} {{selected?.unit||'EA'}}</p></template><label class="textarea-label">{{tr(modal==='eta'?'变更原因（必填）':response==='confirm'?'说明 / 剩余数量处理计划':'原因（必填）')}}<textarea v-model="reason" rows="3" :placeholder="tr(&quot;请输入说明，相关人员可在订单历史中追溯。&quot;)"></textarea></label><p v-if="modal==='eta'" class="muted">{{tr("提交后等待内部采购审核，当前交付承诺保持不变。")}}</p></template>
      <template v-else-if="modal==='resolve'"><p class="modal-description">{{tr(activeIssue?.title)}}</p><label class="textarea-label">{{tr("处理状态")}}<select v-model="issueStatus"><option :value="&quot;待处理&quot;">{{tr("待处理")}}</option><option :value="&quot;处理中&quot;">{{tr("处理中")}}</option><option :value="&quot;已解决&quot;">{{tr("已解决")}}</option></select></label><label class="textarea-label">{{tr("处理记录 / 关闭依据")}}<textarea v-model="reason" rows="4" :placeholder="tr(&quot;记录已采取的动作、确认结果和下一步安排。&quot;)"></textarea></label><p class="muted">{{tr("关闭待办不会修改 SAP 数据，也不会消除仍存在的交期风险。")}}</p></template>
      <template v-else-if="modal==='reject'"><label class="textarea-label">{{tr("退回原因")}}<textarea v-model="reason" rows="4" :placeholder="tr(&quot;说明需要供应商重新安排的原因。&quot;)"></textarea></label></template>
      <template v-else-if="modal==='reset'"><p class="modal-description">{{tr("清除本次演示中的确认、变更和留言，恢复最初的模拟订单。不会涉及任何真实业务数据。")}}</p></template>
      <template v-else-if="modal==='help'"><div class="help-content"><span class="demo-chip">{{tr("Frappe UI · 交互原型")}}</span><p>{{tr(label('这是一份使用 Frappe UI 组件的功能预览。Firebase 内部试用和 SAP 同步的启用情况请查看数据中心。','This preview uses Frappe UI components. Check Data center for Firebase internal pilot and SAP sync activation status.'))}}</p><ol><li>{{tr("切换至")}} <b>{{tr("Longtree · 供应商")}}</b>{{tr("，打开待确认订单，提交数量和交付批次。")}}</li><li>{{tr("对已确认、未发运的订单提交交期变更。")}}</li><li>{{tr("切回")}} <b>{{tr("Regent · 内部采购")}}</b>{{tr("，在“交期与承诺”接受或退回变更。")}}</li><li>{{tr("在“异常与待办”记录处理结果，并查看更新后的报表。")}}</li></ol><p>{{tr(label('数据中心显示当前来源和保存状态。成功连接 Firebase 后，网页操作会保存；公开测试没有账户隔离。','Data center shows source and save status. Changes persist after connecting to Firebase; public testing has no account isolation.'))}}</p><a href="https://github.com/frappe/frappe-ui" target="_blank" rel="noreferrer">{{tr("查看 Frappe UI 开源项目 ↗")}}</a></div></template>
      <p v-if="error" class="form-error" role="alert"><CircleAlert :size="16"/>{{tr(error)}}</p>
    </template><template #actions><div class="modal-actions"><Button variant="outline" size="lg" @click="modalOpen=false">{{tr(modal==='help'?'开始体验':'取消')}}</Button><Button v-if="modal!=='help'" variant="solid" class="primary" size="lg" @click="modal==='response'?submitResponse():modal==='eta'?submitEta():modal==='resolve'?saveIssue():modal==='shipment'?saveShipment():modal==='reject'?rejectChange():reset()">{{tr(modal==='reset'?'确认重置':modal==='eta'?'提交变更申请':modal==='response'?'提交响应':'保存记录')}}</Button></div></template></Dialog>
  </div>
</template>
