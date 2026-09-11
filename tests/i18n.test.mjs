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
import * as persistence from '../src/persistence.mjs'
import * as partsWorkbook from '../src/parts-workbook.mjs'
import * as partsWorkbookStore from '../src/parts-workbook-store.mjs'

// Render the real page templates in Node. Only the third-party UI wrappers are
// replaced; this checks language coverage without browser or visual testing.
const icon={render:()=>null}
const wrapper={setup:(_,ctx)=>()=>Vue.h('div',ctx.slots.default?.())}
const dialog={props:['modelValue','options'],setup:(p,ctx)=>()=>p.modelValue?Vue.h('section',[p.options.title,ctx.slots['body-content']?.(),ctx.slots.actions?.()]):null}
let cloudFactory=async()=>{throw new Error('No Firebase network calls in SSR tests')}
let exceptionDownload=()=>{throw new Error('No downloads in SSR tests')}
function component(file, expose=''){
  let source=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8')
  if(expose)source=source.replace('</script>',`\ndefineExpose({${expose}})\n</script>`)
  const {descriptor}=parse(source)
  let code=compileScript(descriptor,{id:file,inlineTemplate:true,genDefaultAs:'compiledComponent'}).content
  const imports={vue:Vue,'./domain.mjs':domain,'./analytics.mjs':analytics,'./i18n.mjs':i18n,'./translations.mjs':translations,'./reconciliation.mjs':reconciliation,
    './exception-export.mjs':{downloadExceptions:(...args)=>exceptionDownload(...args)},
    './parts-workbook-download.mjs':{createPartsExportWorker(){throw new Error('No downloads in SSR tests')}},
    './parts-workbook.mjs':partsWorkbook,'./parts-workbook-store.mjs':partsWorkbookStore,
    './persistence.mjs':persistence,'./firebase-store.mjs':{cloudConfigured:false,connectCloud:(...args)=>cloudFactory(...args)},
    './runtime-config.mjs':{publicTestEnabled:false},'./public-firebase-store.mjs':{connectPublicWorkspace:async()=>{throw new Error('No public Firebase calls in SSR tests')}},
    'frappe-ui':{Button:wrapper,Badge:wrapper,Dialog:dialog},'lucide-vue-next':new Proxy({},{get:()=>icon})}
  for(const name of ['Operations.vue','RecordFacts.vue','ReviewDialog.vue','DispatchDialog.vue','ShipmentEditor.vue','CloudPanel.vue','PartsWorkbook.vue'])if(source.includes("'./"+name+"'"))imports['./'+name]={default:component(name)}
  const edits=parseJS(code,{sourceType:'module'}).program.body.filter(n=>n.type==='ImportDeclaration').map(n=>({start:n.start,end:n.end,
    text:n.specifiers.map(s=>`const ${s.local.name}=imports[${JSON.stringify(n.source.value)}][${JSON.stringify(s.type==='ImportDefaultSpecifier'?'default':s.imported.name)}];`).join('\n')}))
  for(const edit of edits.reverse())code=code.slice(0,edit.start)+edit.text+code.slice(edit.end)
  return new Function('imports',code+';return compiledComponent')(imports)
}
const exposed='page, role, selected, detailOpen, detailTab, modal, modalOpen, notice, error, activeIssue, activeShipment, batches, response, reason, issueStatus, comment, submitResponse, submitEta, approve, saveIssue, orders, shipments, issues, checks, reviewOpen, reviewCase, dispatchOpen, performReview, performDispatch, syncDemo, saveCollaborationDates, startShipment, saveShipment, loginCloud, cloudBusy, cloudError, cloudRevision, cloudConnected, removeShipment, restoreShipment'
const App=component('App.vue',exposed)
test('the default landing page is the parts workbook',async()=>{
  i18n.setLanguage('zh')
  const result=await render()
  assert.equal(result.state.page.value,'parts')
  assert.match(result.html,/备品备件总表/)
})
test('parts grid renders every source row in one scrolling table with column filters visible by default',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../public/parts-workbook.json',import.meta.url),'utf8'))
  const Parts=component('PartsWorkbook.vue','book, sheetId, loading')
  async function grid(sheetId){
    const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){s.book.value=source;s.sheetId.value=sheetId;s.loading.value=false}})}}
    return renderToString(Vue.createSSRApp(View))
  }
  const html=await grid('s0')
  assert.match(html,/colspan="27"/)
  assert.match(html,/备品备件总表（9.4）Parts order list/)
  assert.match(html,/Sheet2/)
  assert.match(html,/AA/)
  assert.match(html,/导出 Excel|Export Excel/)
  assert.equal((html.match(/data-cell/g)||[]).length,33861)
  assert.equal((html.match(/aria-haspopup="dialog"/g)||[]).length,27)
  assert.equal((html.match(/class="pw-resize-column"/g)||[]).length,27)
  assert.equal((html.match(/class="pw-resize-row"/g)||[]).length,1256)
  assert.match(html,/>1256</)
  assert.doesNotMatch(html,/pw-pagination|Rows per page|每页行数/)
  const summary=await grid('s1')
  assert.match(summary,/取消订单/)
  assert.equal((summary.match(/data-cell/g)||[]).length,75)
})
test('column filter controls apply combined checklists, select all results, and leave workbook data unsaved',async()=>{
  i18n.setLanguage('en')
  const source={sourceFile:'test.xlsx',sheets:[{id:'s0',name:'Sheet1',headerRows:1,originalRows:5,originalColumns:2,merges:[],columns:[{id:'a'},{id:'b'}],rows:[['Material','Quantity'],['A',0],['B',null],['A',2],['C',0]].map((cells,i)=>({id:'r'+i,cells,formulas:{},types:{}}))}]}
  const before=JSON.stringify(source)
  const Parts=component('PartsWorkbook.vue','book,loading,openFilter,closeFilter,filterDraft,filterOpen,applyFilter,clearColumnFilter,toggleOption,selectFilterOptions,visibleOptions,filters,matches,toggleAllRows,selectedRows,dirty')
  const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
    s.book.value=source;s.loading.value=false
    s.openFilter(0);s.selectFilterOptions(false);s.toggleOption('A');s.applyFilter()
    assert.deepEqual(s.matches.value.map(r=>r.row.id),['r1','r3'])
    s.toggleAllRows();assert.deepEqual(s.selectedRows.value,['r1','r3'])
    s.toggleAllRows();assert.deepEqual(s.selectedRows.value,[])
    s.openFilter(1);s.filterDraft.value.query='0';s.selectFilterOptions(true);s.applyFilter()
    assert.deepEqual(s.matches.value.map(r=>r.row.id),['r1'])
    s.clearColumnFilter();assert.equal(s.matches.value.length,2)
    s.openFilter(0);s.filterDraft.value.query='B';s.closeFilter(false)
    assert.equal(s.matches.value.length,2,'cancelled filter edits do not apply')
    s.openFilter(0);assert.equal(s.filterDraft.value.query,'')
    assert.equal(s.visibleOptions.value.length,3)
    assert.equal(s.dirty.value,false);assert.equal(JSON.stringify(source),before)
  }})}}
  const html=await renderToString(Vue.createSSRApp(View))
  assert.match(html,/Apply filter/);assert.match(html,/Blank only/);assert.match(html,/Select search results/)
  assert.match(html,/class="pw-filter-popover" role="dialog" aria-modal="false"/)
  assert.match(html,/aria-expanded="true" aria-controls="pw-column-filter-popover"/)
  assert.doesNotMatch(html,/dialog-overlay|backdrop-filter/)
  assertEnglish(html.replace(/<[^>]*>/g,' '))
})

test('cell color toolbar applies a saved edit, supports undo and redo, and renders the palette and fill',async()=>{
  i18n.setLanguage('en')
  const source=JSON.parse(fs.readFileSync(new URL('../public/parts-workbook.json',import.meta.url),'utf8'))
  source.sheets[0].rows=source.sheets[0].rows.slice(0,5)
  const Parts=component('PartsWorkbook.vue','book,loading,active,colorOpen,openColors,applyColor,undoChange,redoChange,dirty')
  const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
    s.book.value=source;s.loading.value=false;s.active.value={rowId:'s0-r4',col:8}
    s.openColors();assert.equal(s.colorOpen.value,true)
    s.applyColor('#FFF2CC');assert.equal(s.colorOpen.value,false);assert.equal(s.dirty.value,true)
    assert.equal(s.book.value.sheets[0].rows[3].fills['s0-c8'],'#FFF2CC')
    s.undoChange();assert.equal(s.book.value.sheets[0].rows[3].fills,undefined)
    s.redoChange();assert.equal(s.book.value.sheets[0].rows[3].fills['s0-c8'],'#FFF2CC')
    s.active.value={rowId:'s0-r4',col:8};s.applyColor('');assert.equal(s.book.value.sheets[0].rows[3].fills,undefined)
    s.applyColor('#DDEBF7');s.openColors()
    assert.equal(source.sheets[0].rows[3].fills,undefined)
  }})}}
  const html=await renderToString(Vue.createSSRApp(View))
  assert.match(html,/Fill color/);assert.match(html,/Cell fill color · I4/)
  assert.match(html,/Clear fill color/);assert.match(html,/--pw-cell-fill:#DDEBF7/)
  assert.match(html,/class="has-fill focused/)
})

test('dragging row and column boundaries previews locally, saves on release, and supports cancel and undo',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../public/parts-workbook.json',import.meta.url),'utf8'))
  source.sheets[0].rows=source.sheets[0].rows.slice(0,5)
  const Parts=component('PartsWorkbook.vue','book,loading,startResize,moveResize,finishResize,cancelResize,width,rowSize,undoChange,redoChange,dirty,resetDimension')
  const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
    s.book.value=source;s.loading.value=false
    let captured=false
    const handle={parentElement:{getBoundingClientRect:()=>({width:150,height:44})},focus(){},setPointerCapture(){captured=true},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false}}
    const event={button:0,pointerId:1,clientX:100,clientY:100,currentTarget:handle}
    s.startResize(event,'column','s0-c8');s.moveResize({...event,clientX:180})
    assert.equal(s.width(8),230);assert.equal(s.dirty.value,false)
    s.cancelResize();assert.equal(s.width(8),150);assert.equal(captured,false)
    s.startResize(event,'column','s0-c8');s.finishResize({...event,clientX:180})
    assert.equal(s.book.value.sheets[0].columns[8].widthPx,230);assert.equal(s.dirty.value,true)
    s.undoChange();assert.equal(s.width(8),150);s.redoChange();assert.equal(s.width(8),230)
    s.startResize(event,'row','s0-r4');s.finishResize({...event,clientY:120})
    assert.equal(s.rowSize(s.book.value.sheets[0].rows[3]),64)
    s.resetDimension('column','s0-c8');assert.equal(s.width(8),150)
    assert.equal(source.sheets[0].rows[3].heightPx,undefined)
  }})}}
  const html=await renderToString(Vue.createSSRApp(View))
  assert.match(html,/--pw-row-height:64px/)
  assert.match(html,/class="pw-sized-row/)
})

test('exception export uses all filtered tasks rather than the current page and reports download failures',async()=>{
  i18n.setLanguage('en')
  const orders=[{...reconciliation.workspaceOrders()[0],id:'order-a',po:'MATCH-PO'}]
  const issues=Array.from({length:83},(_,i)=>({id:'check-'+i,order:'order-a',kind:'material',title:'Material mismatch',detail:'OLD ↔ NEW',status:'待处理',owner:'Leo'}))
  issues.push({...issues[0],id:'excluded-type',kind:'price'},{...issues[0],id:'excluded-owner',owner:'Someone else'},{...issues[0],id:'excluded-closed',status:'已解决'})
  let downloaded
  exceptionDownload=(...args)=>{downloaded=args}
  const Ops=component('Operations.vue','query,kind,owner,caseStatus,pageNumber,exportExceptionView,tasks,pagedTasks,exceptionExportError')
  const View={...Ops,setup(props,ctx){return Ops.setup(props,{...ctx,expose(s){
    s.kind.value='material';s.owner.value='Leo';s.query.value='MATCH-PO';s.pageNumber.value=2
    assert.equal(s.tasks.value.length,83);assert.equal(s.pagedTasks.value.length,40)
    s.exportExceptionView();assert.equal(downloaded[0].length,83);assert.equal(downloaded[0].at(-1).id,'check-82')
    assert.equal(downloaded[2].language,'en')
    exceptionDownload=()=>{throw new Error('download failed')};s.exportExceptionView()
    assert.match(s.exceptionExportError.value,/Could not export/)
    s.caseStatus.value='closed';assert.equal(s.tasks.value.length,1)
  }})}}
  const html=await renderToString(Vue.createSSRApp(View,{view:'exceptions',orders,issues,shipments:[],role:'buyer'}))
  assert.match(html,/Export exceptions to Excel/);assert.match(html,/role="alert"/)
})

test('remote column changes retain the selected cell identity and clear stale filters; deleting that cell clears selection',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../public/parts-workbook.json',import.meta.url),'utf8'))
  source.sheets[0].rows=source.sheets[0].rows.slice(0,5)
  const Parts=component('PartsWorkbook.vue','book,loading,active,filters,sort,selectedRows,accept,filterOpen')
  const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
    s.book.value=source;s.loading.value=false;s.active.value={rowId:'s0-r4',col:8}
    s.filters.value={8:{query:'abc'}};s.sort.value={col:8,direction:1};s.selectedRows.value=['s0-r4'];s.filterOpen.value=true
    const next=partsWorkbook.cloneBook(source);partsWorkbook.insertColumn(next.sheets[0],3)
    s.accept({book:next,revision:2})
    assert.deepEqual(s.active.value,{rowId:'s0-r4',col:9});assert.deepEqual(s.filters.value,{})
    assert.equal(s.sort.value,null);assert.equal(s.filterOpen.value,false)
    const deleted=partsWorkbook.cloneBook(next);partsWorkbook.deleteRows(deleted.sheets[0],['s0-r4'])
    s.accept({book:deleted,revision:3})
    assert.equal(s.active.value,null);assert.deepEqual(s.selectedRows.value,[])
  }})}}
  await renderToString(Vue.createSSRApp(View))
})

async function render(state={},run){
  let setupState
  const View={...App,setup(props,ctx){const result=App.setup(props,{...ctx,expose(s){setupState=s;for(const [key,value] of Object.entries(state))s[key].value=value;run?.(s)}});return result}}
  const html=await renderToString(Vue.createSSRApp(View))
  return {html,state:setupState,text:html.replace(/<[^>]*>/g,' ').replaceAll('中文','')}
}
// Source filenames are user data and must retain their original spelling.
function assertEnglish(text){text=text.replaceAll('2026 Parts order list发澳洲.xlsx','');assert.equal(/[\u3400-\u9fff]/.test(text),false,text.match(/.{0,40}[\u3400-\u9fff].{0,80}/g)?.join('\n'))}

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


test('cloud save failure restores business records and keeps the editor open',async()=>{
  i18n.setLanguage('en')
  let attempt
  cloudFactory=async(email,password,receive)=>{
    receive({state:{orders:reconciliation.workspaceOrders(),shipments:reconciliation.workspaceShipments(),issues:[],checks:[]},revision:4,generation:'seed-1',email})
    return {save:async(state,action,expected,generation)=>{attempt={state,action,expected,generation};throw new Error('save_conflict')},disconnect:async()=>{}}
  }
  const {state:s}=await render();await s.loginCloud({email:'pilot@example.test',password:'test'})
  assert.equal(s.cloudConnected.value,true)
  const batch=s.shipments.value[2];s.startShipment(batch)
  const before=persistence.copy(s.shipments.value)
  await assert.rejects(s.saveShipment({mode:'海运',stage:0,eta:'2026-09-23',containerNo:'NEW-BOX',delayStatus:'delayed',delayReason:'Schedule changed',nextAction:'Check sailing',note:'Verified by carrier'}),/updated/)
  assert.deepEqual(s.shipments.value,before);assert.equal(s.modalOpen.value,true)
  assert.equal(s.cloudBusy.value,false);assert.equal(s.cloudRevision.value,4)
  assert.equal(attempt.expected,4);assert.equal(attempt.generation,'seed-1');assert.equal(attempt.action,'saveShipment')
  assert.match(s.cloudError.value,/not saved/)
})

test('cloud deletion saves a tombstone and advances revision after acknowledgement',async()=>{
  i18n.setLanguage('en');let saved
  cloudFactory=async(email,password,receive)=>{
    receive({state:{orders:reconciliation.workspaceOrders(),shipments:reconciliation.workspaceShipments(),issues:[],checks:[]},revision:0,generation:'seed-2',email})
    return {save:async state=>{saved=persistence.copy(state);return {revision:1,at:1}},disconnect:async()=>{}}
  }
  const {state:s}=await render();await s.loginCloud({email:'pilot@example.test',password:'test'})
  await s.removeShipment(s.shipments.value[2],'Duplicate registration')
  assert.equal(s.cloudRevision.value,1)
  assert.ok(saved.shipments[2].deletedAt);assert.equal(saved.orders[0].reported,0)
  assert.equal(s.cloudBusy.value,false)
})

test('imported orders paginate and keep unknown receipt facts out of completed status',async()=>{
  i18n.setLanguage('en')
  const orders=Array.from({length:85},(_,i)=>({...reconciliation.workspaceOrders()[0],id:`import-${i}`,po:`TEST-PO-${i}`,imported:true,sourceRemaining:1,sourceReported:0,reported:0,qty:1,received:null,shipped:null,type:'用途待确认',quantityComparable:false,importChecks:[]}))
  const r=await render({page:'orders',orders,shipments:[],issues:[],checks:[]})
  assert.equal((r.html.match(/TEST-PO-\d+/g)||[]).length,40)
  assert.match(r.text,/85 records/);assert.match(r.text,/Purpose unconfirmed/)
  assertEnglish(r.text)
})

test('completed history is visible by default and global tabs escape drill-down and filters',async()=>{
  i18n.setLanguage('en')
  const base={...reconciliation.workspaceOrders()[0],imported:true,qty:1,received:null,shipped:null,type:'用途待确认',quantityComparable:false,importChecks:[]}
  const orders=[
    {...base,id:'closed',po:'HISTORY-OK',sourceRemaining:0,sourceReported:1,reported:1,importCompletion:'OK'},
    {...base,id:'open',po:'CURRENT-NG',sourceRemaining:1,sourceReported:0,reported:0,importCompletion:'NG'},
    {...base,id:'cancel',po:'CANCELLED-ROW',sourceRemaining:0,sourceReported:0,reported:0,cancelled:true},
  ]
  let state
  const Ops=component('Operations.vue','status,rows,orderViews,pagedRows,selectStatus,query,owner,shipping,pageNumber,pageSize,goToPage')
  const props=Vue.reactive({view:'orders',orders,shipments:[],issues:[],role:'buyer',selection:null})
  // SSR does not schedule parent re-renders; mirror the parent prop update explicitly.
  let liveProps
  const View={...Ops,setup(p,ctx){liveProps=Vue.reactive({...p});return Ops.setup(liveProps,{...ctx,expose:s=>{state=s}})}}
  const app=()=>Vue.createSSRApp({render:()=>Vue.h(View,{...props,onClearSelection:()=>{props.selection=null;liveProps.selection=null}})})
  let html=await renderToString(app())
  assert.match(html,/HISTORY-OK/);assert.match(html,/CURRENT-NG/);assert.match(html,/CANCELLED-ROW/)
  assert.match(html,/Ledger completed/);assert.match(html,/not confirmed SAP receipt/)
  assert.deepEqual(state.orderViews.value.slice(0,4).map(v=>v.records.length),[3,1,1,1])
  props.selection={ids:['open'],label:'Open orders'}
  html=await renderToString(app())
  assert.doesNotMatch(html,/HISTORY-OK/);assert.equal(state.status.value,'all')
  state.owner.value='Non-matching owner';state.query.value='Not found';state.shipping.value='空运'
  state.selectStatus('completed')
  assert.equal(props.selection,null);assert.equal(state.owner.value,'');assert.equal(state.query.value,'');assert.equal(state.shipping.value,'')
  assert.deepEqual(state.rows.value.map(o=>o.id),['closed'])
  state.selectStatus('all');assert.equal(state.rows.value.length,3)
  state.selectStatus('cancelled');assert.deepEqual(state.rows.value.map(o=>o.id),['cancel'])
})

test('history pagination reaches final records and respects the selected page size',async()=>{
  i18n.setLanguage('en')
  const base={...reconciliation.workspaceOrders()[0],imported:true,sourceRemaining:0,sourceReported:1,reported:1,qty:1,received:null,shipped:null}
  const orders=Array.from({length:1253},(_,i)=>({...base,id:`history-${i}`}))
  let state
  const Ops=component('Operations.vue','pagedRows,pageSize,pageNumber,goToPage,maxPage')
  const View={...Ops,setup(p,ctx){return Ops.setup(p,{...ctx,expose:s=>{state=s}})}}
  await renderToString(Vue.createSSRApp(View,{view:'orders',orders,shipments:[],issues:[],role:'buyer'}))
  assert.equal(state.maxPage.value,32)
  state.goToPage(32);assert.equal(state.pagedRows.value.length,13);assert.equal(state.pagedRows.value.at(-1).id,'history-1252')
  state.pageSize.value=100;state.goToPage(999)
  assert.equal(state.pageNumber.value,13);assert.equal(state.pagedRows.value.length,53);assert.equal(state.pagedRows.value.at(-1).id,'history-1252')
  state.goToPage(-5);assert.equal(state.pageNumber.value,1);assert.equal(state.pagedRows.value.length,100)
})
