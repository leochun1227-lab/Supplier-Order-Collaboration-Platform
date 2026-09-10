<script setup>
import { ref, watch } from 'vue'
import { Button, Badge } from 'frappe-ui'
import { t as tr } from './i18n.mjs'
import { label, factsFor, remainingQty, reportedQty, relatedShipments, allocations, priceReady } from './reconciliation.mjs'
const props=defineProps({order:Object,shipments:Array,issues:Array,tab:String,role:String,saveDates:Function})
const emit=defineEmits(['review','dispatch','shipment'])
const l=(zh,en)=>tr(label(zh,en))
const etd=ref(''),china=ref(''),reason=ref(''),error=ref('')
watch(()=>props.order,o=>{etd.value=o?.promisedEtd||'';china.value=o?.chinaEta||'';reason.value='';error.value=''}, {immediate:true})
function save(){try{props.saveDates(props.order,{etd:etd.value,china:china.value,reason:reason.value});reason.value='';error.value=''}catch(e){error.value=e.message}}
</script>
<template><div class="ops ops-record">
  <template v-if="tab==='overview'">
    <div class="ops-record-summary"><div><small>{{l('订购','Ordered')}}</small><b>{{order.qty}} {{order.unit||'EA'}}</b></div><div><small>{{l('业务报发','Reported dispatch')}}</small><b>{{reportedQty(order)}} {{order.unit||'EA'}}</b></div><div><small>{{l('剩余待发','To dispatch')}}</small><b>{{remainingQty(order)}} {{order.unit||'EA'}}</b></div><div><small>{{l('SAP 收货','SAP receipts')}}</small><b>{{order.received}} {{order.unit||'EA'}}</b></div></div>
    <div class="ops-record-refs"><div><small>{{l('澳洲 PO／行','AU PO / line')}}</small><b>{{order.po}} / {{order.item}}</b></div><div><small>{{l('工厂 SO','Factory SO')}}</small><b>{{order.so||l('待关联','Not linked')}}</b></div><div><small>{{l('合同供应商／采购员','Contract supplier / buyer')}}</small><b>{{order.supplier}} / {{order.buyer}}</b></div><div><small>{{l('用途／来源','Purpose / source')}}</small><b>{{tr(order.type)}} / {{l(order.sourceType==='make'?'自制件':'外购件',order.sourceType==='make'?'In-house':'Purchased')}}</b></div></div>
    <div class="ops-detail-heading"><h3>{{l('原始数据与采用口径','Source values & adopted basis')}}</h3><Badge theme="gray">{{l('SAP 原值只读','SAP originals read-only')}}</Badge></div>
    <div class="ops-scroll"><table class="ops-facts-table"><thead><tr><th>{{l('字段','Field')}}</th><th>SAP</th><th>{{l('业务／SO','Business / SO')}}</th><th>{{l('采用口径','Adopted basis')}}</th></tr></thead><tbody><tr v-for="f in factsFor(order,shipments)" :key="f.field.en"><td>{{tr(f.field)}}</td><td>{{tr(f.sap)}}</td><td>{{tr(f.business)}}<small>{{tr(f.source)}}</small></td><td>{{tr(f.adopted)}}</td></tr></tbody></table></div>
    <p class="ops-note">{{l('初始化来源截至','Initial source as of')}} {{order.sourceAsOf||'—'}} · {{l('SAP 快照日期','SAP snapshot date')}} {{order.sapAsOf||'—'}} · {{l('同步时间','Sync time')}} {{order.syncedAt||'—'}}</p>
    <div class="ops-inline-note"><span>{{l('货值覆盖','Value coverage')}}</span><b>{{l(priceReady(order)?'采用已确认 AUD 采购价格':'该行暂未纳入已确认货值',priceReady(order)?'Confirmed AUD PO price':'Excluded from confirmed value')}}</b></div>
  </template>
  <template v-if="tab==='commitment'">
    <div class="ops-record-refs"><div><small>{{l('原约定发运','Original agreed dispatch')}}</small><b>{{order.initialEtd||'—'}}</b></div><div><small>{{l('最新承诺发运','Latest dispatch commitment')}}</small><b>{{order.promisedEtd||'TBD'}}</b></div><div><small>{{l('国内到货 · ETA China','China inbound ETA')}}</small><b>{{order.chinaEta||'—'}}</b></div><div><small>{{l('澳洲到仓承诺','AU arrival commitment')}}</small><b>{{order.eta||'—'}}</b></div></div>
    <details class="ops-definitions"><summary>{{l('维护发运承诺与国内 ETA','Maintain dispatch & China ETA')}}</summary><div class="ops-form-grid"><label>{{l('承诺发运日期','Promised dispatch')}}<input v-model="etd" type="date"/></label><label>{{l('国内到货日期','China inbound date')}}<input v-model="china" type="date"/></label></div><label class="ops-form-label">{{l('变更原因（必填）','Reason (required)')}}<textarea v-model="reason" rows="2"></textarea></label><p v-if="error" class="ops-error" role="alert">{{error}}</p><Button variant="outline" @click="save">{{l('保存协作日期','Save collaboration dates')}}</Button><p>{{l('这些日期不会替换澳洲到仓承诺；到仓变更仍走下方审核流程。','These dates do not replace the AU arrival commitment; arrival changes use the approval flow below.')}}</p></details>
  </template>
  <template v-if="tab==='logistics'">
    <div class="ops-detail-heading"><h3>{{l('装运分配与收货','Shipment allocations & receipts')}}</h3><Button variant="outline" @click="emit('dispatch',order)">{{l('登记业务报发','Record dispatch')}}</Button></div>
    <div v-for="s in relatedShipments(order,shipments)" :key="s.id" class="ops-panel ops-detail-batch"><header><h3>{{s.id}}</h3><Badge :theme="s.sapPosted?'green':'orange'">{{l(s.sapPosted?'已关联 SAP 过账':'业务报发 · 待核实',s.sapPosted?'SAP PGI linked':'Reported · unverified')}}</Badge></header><div class="ops-record-refs"><div><small>{{l('箱号／运单','Container / waybill')}}</small><b>{{s.ref}}</b></div><div><small>{{l('车架／装载位置','Chassis / loading position')}}</small><b>{{s.chassis||'—'}} / {{tr(s.position)||'—'}}</b></div><div><small>{{l('业务报发／SAP 过账','Report / SAP PGI')}}</small><b>{{s.reportedAt||s.etd}} / {{s.pgiAt||'—'}}</b></div><div><small>{{l('澳洲到仓 ETA','AU warehouse ETA')}}</small><b>{{s.eta||l('待补充','Not provided')}}</b></div></div><div class="ops-inline-note" v-for="a in allocations(s).filter(a=>a.order===order.id)" :key="a.order"><span>{{l('本行分配／已关联收货','This line allocated / received')}}</span><b>{{a.qty}} / {{a.receivedQty||0}} {{order.unit||'EA'}}</b></div><p class="ops-note">{{l('批次关联订单行','Order lines in this batch')}}: {{allocations(s).length}} · {{tr(s.location)}}</p><Button variant="outline" @click="emit('shipment',s)">{{tr('更新物流进展')}}</Button></div>
    <p v-if="!relatedShipments(order,shipments).length" class="ops-empty">{{l('暂无装运记录，可登记首个报发批次。','No shipments yet. Record the first dispatch batch.')}}</p>
  </template>
  <template v-if="tab==='activity'">
    <div class="ops-detail-heading"><h3>{{l('关联核对任务','Linked review tasks')}}</h3><small>{{issues.length}} {{l('项','tasks')}}</small></div>
    <div class="ops-record-case" v-for="c in issues" :key="c.id"><div><b>{{tr(c.title)}}</b><small>{{c.owner}} · {{c.due}} · {{tr(c.status)}}</small><p>{{c.userEntered?c.detail:tr(c.detail)}}</p><p v-if="c.note">{{c.rule||c.noteUserEntered?c.note:tr(c.note)}}</p><p v-if="c.closure" class="ops-green">{{tr(c.closure)}}</p><details v-if="c.log?.length"><summary>{{l('处理历史','Review history')}}</summary><p v-for="(entry,i) in c.log" :key="i">{{entry.at}} · {{entry.text}}</p></details></div><Button v-if="c.status!=='已解决'" variant="outline" @click="emit('review',c)">{{l('跟进','Review')}}</Button></div><p v-if="!issues.length" class="ops-note">{{l('暂无关联任务','No linked tasks')}}</p>
  </template>
</div></template>
