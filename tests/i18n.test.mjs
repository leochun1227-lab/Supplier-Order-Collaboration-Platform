import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileScript } from '@vue/compiler-sfc'
import { parse as parseJS } from '@babel/parser'
import * as domain from '../src/domain.mjs'
import * as analytics from '../src/analytics.mjs'
import * as i18n from '../src/i18n.mjs'
import * as translations from '../src/translations.mjs'
import * as reconciliation from '../src/reconciliation.mjs'

// Render the real page templates in Node. Only the third-party UI wrappers are
// replaced; this checks language coverage without browser or visual testing.
const icon={render:()=>null}
const wrapper={setup:(_,ctx)=>()=>Vue.h('div',ctx.slots.default?.())}
const dialog={props:['modelValue','options'],setup:(p,ctx)=>()=>p.modelValue?Vue.h('section',[p.options.title,ctx.slots['body-content']?.(),ctx.slots.actions?.()]):null}
function component(file, expose=''){
  let source=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8')
  if(expose)source=source.replace('</script>',`\ndefineExpose({${expose}})\n</script>`)
  const {descriptor}=parse(source)
  let code=compileScript(descriptor,{id:file,inlineTemplate:true,genDefaultAs:'compiledComponent'}).content
  const imports={vue:Vue,'./domain.mjs':domain,'./analytics.mjs':analytics,'./i18n.mjs':i18n,'./translations.mjs':translations,'./reconciliation.mjs':reconciliation,
    'frappe-ui':{Button:wrapper,Badge:wrapper,Dialog:dialog},'lucide-vue-next':new Proxy({},{get:()=>icon})}
  for(const name of ['Operations.vue','RecordFacts.vue','ReviewDialog.vue','DispatchDialog.vue','ShipmentEditor.vue'])if(source.includes("'./"+name+"'"))imports['./'+name]={default:component(name)}
  const edits=parseJS(code,{sourceType:'module'}).program.body.filter(n=>n.type==='ImportDeclaration').map(n=>({start:n.start,end:n.end,
    text:n.specifiers.map(s=>`const ${s.local.name}=imports[${JSON.stringify(n.source.value)}][${JSON.stringify(s.type==='ImportDefaultSpecifier'?'default':s.imported.name)}];`).join('\n')}))
  for(const edit of edits.reverse())code=code.slice(0,edit.start)+edit.text+code.slice(edit.end)
  return new Function('imports',code+';return compiledComponent')(imports)
}
const exposed='page, role, selected, detailOpen, detailTab, modal, modalOpen, notice, error, activeIssue, activeShipment, batches, response, reason, issueStatus, comment, submitResponse, submitEta, approve, saveIssue, orders, shipments, checks, reviewOpen, reviewCase, dispatchOpen, performReview, performDispatch, syncDemo, saveCollaborationDates, startShipment, saveShipment'
const App=component('App.vue',exposed)
async function render(state={},run){
  let setupState
  const View={...App,setup(props,ctx){const result=App.setup(props,{...ctx,expose(s){setupState=s;for(const [key,value] of Object.entries(state))s[key].value=value;run?.(s)}});return result}}
  const html=await renderToString(Vue.createSSRApp(View))
  return {html,state:setupState,text:html.replace(/<[^>]*>/g,' ').replaceAll('中文','')}
}
function assertEnglish(text){assert.equal(/[\u3400-\u9fff]/.test(text),false,text.match(/.{0,40}[\u3400-\u9fff].{0,80}/g)?.join('\n'))}

test('all seven pages render in English, including role-specific views',async()=>{
  i18n.setLanguage('en')
  for(const page of ['overview','orders','delivery','shipments','exceptions','reports','data']){
    for(const role of page==='data'?['buyer']:['buyer','supplier'])assertEnglish((await render({page,role})).text)
  }
})

test('order detail tabs and all action dialogs use English labels',async()=>{
  i18n.setLanguage('en')
  const selected=domain.seedOrders()[2]
  for(const detailTab of ['overview','commitment','logistics','activity'])assertEnglish((await render({selected,detailOpen:true,detailTab})).text)
  for(const modal of ['response','eta','resolve','shipment','reject','reset','help']){
    assertEnglish((await render({modal,modalOpen:true,selected,activeIssue:domain.seedIssues()[0],activeShipment:domain.seedShipments()[0],batches:[{qty:40,date:'2026-10-02'}]})).text)
  }
})

test('language changes preserve business values and translate feedback and history',async()=>{
  i18n.setLanguage('en')
  const selected=domain.seedOrders()[0]
  const r=await render({page:'orders',role:'supplier',selected,detailOpen:true,detailTab:'activity',batches:[{qty:120,date:'2026-09-18'}]},s=>s.submitResponse())
  assert.equal(selected.status,'已确认')
  assert.equal(selected.batches[0].qty,120)
  assertEnglish(translations.translate(selected.history[0].text,'en'))
  assertEnglish(translations.translate(r.state.notice.value,'en'))
  i18n.setLanguage('zh')
  assert.equal(i18n.t('已确认'),'已确认')
  assert.equal(selected.status,'已确认')
  assert.equal(selected.batches[0].date,'2026-09-18')
  i18n.setLanguage('en')
  const failed=await render({role:'supplier',selected:domain.seedOrders()[0],batches:[{qty:999,date:'2026-09-18'}]},s=>s.submitResponse())
  assertEnglish(i18n.t(failed.state.error.value))
  assert.match(i18n.t(failed.state.error.value),/exceed/)
})

test('select values remain language-independent and free text is retained',async()=>{
  i18n.setLanguage('en')
  const r=await render({page:'orders'})
  assert.match(r.html,/value="生产订单"[^>]*>Production/)
  assert.match(r.html,/value="空运"[^>]*>Air freight/)
  const selected=domain.seedOrders()[0]
  selected.comments=[{who:'Regent',time:'09/08 12:00',text:'请保留我的原始备注',userEntered:true}]
  assert.match((await render({selected,detailOpen:true,detailTab:'activity'})).text,/请保留我的原始备注/)
})

test('dynamic dashboard labels and sample record descriptions have translations',()=>{
  for(const text of ['生产订单 · 未完成','Longtree · 未完成','海运在途订单','账龄 16–30 天','高优先级','Longtree / 供应商','较首次 ETA 延后 2 天','3 行交期风险','数量构成：未发 800 件，在途 420 件，已收 500 件'])assertEnglish(translations.translate(text,'en'))
  assert.equal(translations.translate('请保留原文','en'),'请保留原文')
  i18n.setLanguage('en');assert.equal(i18n.dateLabel('2026-09-18'),'18 Sept')
  i18n.setLanguage('zh');assert.equal(i18n.dateLabel('2026-09-18'),'09/18')
})

test('source comparisons and rule-review dialogs render in English for all sample cases',async()=>{
  i18n.setLanguage('en')
  for(const selected of reconciliation.workspaceOrders()){
    for(const detailTab of ['overview','commitment','logistics','activity'])assertEnglish((await render({selected,detailOpen:true,detailTab})).text)
  }
  for(const reviewCase of reconciliation.reconcile(reconciliation.workspaceOrders(),reconciliation.workspaceShipments())){
    assertEnglish((await render({reviewOpen:true,reviewCase})).text)
  }
  assertEnglish((await render({dispatchOpen:true})).text)
})

test('UI actions update shared facts, close matching cases and preserve reported dispatch',async()=>{
  i18n.setLanguage('en')
  const r=await render({page:'data'},s=>{
    const material=s.checks.value.find(c=>c.kind==='material')
    s.performReview(material,{action:'confirm',owner:'Buyer',due:'2026-09-10',note:'Verified mapping',factor:1})
    assert.equal(s.checks.value.find(c=>c.id===material.id).status,'已解决')
    assert.equal(s.orders.value.at(-1).sapPart,'P135-01999')
    s.syncDemo()
    assert.equal(s.orders.value[0].reported,48)
    assert.equal(s.orders.value[0].shipped,48)
    assert.ok(s.checks.value.filter(c=>c.kind==='shipment').every(c=>c.status==='已解决'))
  })
  assertEnglish(r.text)
  assert.match(r.text,/Passed \/ resolved/)
})

test('logistics editor updates all linked orders and renders separate inputs in both languages',async()=>{
  i18n.setLanguage('en')
  const r=await render({page:'shipments'},s=>{
    const batch=s.shipments.value[2];s.startShipment(batch)
    s.saveShipment({mode:'海运',stage:0,eta:'2026-09-23',containerNo:'DEMO-BOX',waybillNo:'DEMO-BL',courierNo:'DEMO-EXP',carrier:'Demo Express',location:'Warehouse',chassis:'DEMO-VAN',position:'Parts',delayStatus:'delayed',delayReason:'Vessel rescheduled',nextAction:'Confirm sailing',note:'Carrier confirmed'})
    assert.ok(s.orders.value.slice(0,2).every(o=>translations.translate(o.history[0].text,'en').includes(batch.id)))
    assert.equal(s.orders.value[0].shipped,0)
    assert.ok(s.checks.value.some(c=>c.kind==='logistics'&&c.order===s.orders.value[0].id))
  })
  assertEnglish(r.text);assert.match(r.text,/Courier tracking number/);assert.match(r.text,/Container number/);assert.match(r.text,/AU warehouse ETA/)
  i18n.setLanguage('zh')
  const chinese=await render({modal:'shipment',modalOpen:true,activeShipment:reconciliation.workspaceShipments()[0]})
  assert.match(chinese.text,/快递追踪号/);assert.match(chinese.text,/延期原因/)
})

test('language preference restores safely and updates document language without a reload',async()=>{
  const values=new Map([['regent-ui-language','en']])
  globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}
  globalThis.document={documentElement:{lang:''},title:''}
  try{
    const session=await import('../src/i18n.mjs?preference-test')
    assert.equal(session.language.value,'en')
    assert.equal(document.documentElement.lang,'en')
    session.setLanguage('zh')
    assert.equal(values.get('regent-ui-language'),'zh')
    assert.equal(document.documentElement.lang,'zh-CN')
    assert.equal(session.t('总览看板'),'总览看板')
    session.setLanguage('unsupported')
    assert.equal(session.language.value,'zh')
    localStorage.setItem=()=>{throw new Error('Storage disabled')}
    assert.doesNotThrow(()=>session.setLanguage('en'))
    assert.equal(session.t('总览看板'),'Overview')
  }finally{delete globalThis.localStorage;delete globalThis.document}
})
