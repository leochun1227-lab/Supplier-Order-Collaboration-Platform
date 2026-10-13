import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileScript } from '@vue/compiler-sfc'
import { parse as parseJS } from '@babel/parser'
import * as domain from '../src/domain.mjs'
import * as analytics from '../src/analytics.mjs'
import * as managerOverview from '../src/manager-overview.mjs'
import * as i18n from '../src/i18n.mjs'
import * as translations from '../src/translations.mjs'
import * as reconciliation from '../src/reconciliation.mjs'
import * as persistence from '../src/persistence.mjs'
import * as partsWorkbook from '../src/parts-workbook.mjs'
import * as sapReference from '../src/sap-reference.mjs'
import * as partsWorkbookStore from '../src/parts-workbook-store.mjs'
import * as partsWorkbookScope from '../src/parts-workbook-scope.mjs'

// Render the real page templates in Node. Only the third-party UI wrappers are
// replaced; this checks language coverage without browser or visual testing.
const icon={render:()=>null}
const wrapper={setup:(_,ctx)=>()=>Vue.h('div',ctx.slots.default?.())}
const dialog={props:['modelValue','options'],setup:(p,ctx)=>()=>p.modelValue?Vue.h('section',[p.options.title,ctx.slots['body-content']?.(),ctx.slots.actions?.()]):null}
let cloudFactory=async()=>{throw new Error('No Firebase network calls in SSR tests')}
let exceptionDownload=()=>{throw new Error('No downloads in SSR tests')}
let workbookStoreFactory=(...args)=>partsWorkbookStore.createPartsWorkbookStore(...args)
function component(file, expose=''){
  let source=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8')
  if(expose)source=source.replace('</script>',`\ndefineExpose({${expose}})\n</script>`)
  const {descriptor}=parse(source)
  let code=compileScript(descriptor,{id:file,inlineTemplate:true,genDefaultAs:'compiledComponent'}).content
  const imports={vue:Vue,'./manager-overview.mjs':managerOverview,'./sap-reference.mjs':sapReference,'./domain.mjs':domain,'./analytics.mjs':analytics,'./i18n.mjs':i18n,'./translations.mjs':translations,'./reconciliation.mjs':reconciliation,
    './exception-export.mjs':{downloadExceptions:(...args)=>exceptionDownload(...args)},
    './parts-workbook-download.mjs':{createPartsExportWorker(){throw new Error('No downloads in SSR tests')}},
    './parts-workbook.mjs':partsWorkbook,'./parts-workbook-scope.mjs':partsWorkbookScope,'./parts-workbook-store.mjs':{...partsWorkbookStore,createPartsWorkbookStore:(...args)=>workbookStoreFactory(...args)},
    './persistence.mjs':persistence,'./firebase-store.mjs':{cloudConfigured:false,connectCloud:(...args)=>cloudFactory(...args)},
    './runtime-config.mjs':{publicTestEnabled:false},'./public-firebase-store.mjs':{connectPublicWorkspace:async()=>{throw new Error('No public Firebase calls in SSR tests')}},
    'frappe-ui':{Button:wrapper,Badge:wrapper,Dialog:dialog},'lucide-vue-next':new Proxy({},{get:()=>icon})}
  for(const name of ['Operations.vue','TrendChart.vue','RecordFacts.vue','ReviewDialog.vue','DispatchDialog.vue','ShipmentEditor.vue','CloudPanel.vue','PartsWorkbook.vue'])if(source.includes("'./"+name+"'"))imports['./'+name]={default:component(name)}
  const edits=parseJS(code,{sourceType:'module'}).program.body.filter(n=>n.type==='ImportDeclaration').map(n=>({start:n.start,end:n.end,
    text:n.specifiers.map(s=>`const ${s.local.name}=imports[${JSON.stringify(n.source.value)}][${JSON.stringify(s.type==='ImportDefaultSpecifier'?'default':s.imported.name)}];`).join('\n')}))
  for(const edit of edits.reverse())code=code.slice(0,edit.start)+edit.text+code.slice(edit.end)
  return new Function('imports',code+';return compiledComponent')(imports)
}
const exposed='page, role, selected, detailOpen, detailTab, modal, modalOpen, notice, error, activeIssue, activeShipment, batches, response, reason, issueStatus, comment, submitResponse, submitEta, approve, saveIssue, orders, shipments, issues, checks, reviewOpen, reviewCase, dispatchOpen, performReview, performDispatch, syncDemo, saveCollaborationDates, startShipment, saveShipment, loginCloud, cloudBusy, cloudError, cloudRevision, cloudConnected, removeShipment, restoreShipment'
const App=component('App.vue',exposed)
test('trend charts preserve measured zero and break lines at missing periods',async()=>{
  const html=await renderToString(Vue.createSSRApp(component('TrendChart.vue'),{
    title:'Freight trend',labels:['Apr','May','Jun','Jul'],totals:[20,null,0,10],
    series:[{name:'Air',color:'#f18a43',values:[20,null,0,10]}],
    missingLabel:'Unverified',emptyLabel:'No recorded data',
  }))
  const path=html.match(/<path[^>]+d="([^"]*)"/)[1]
  assert.equal((path.match(/M /g)||[]).length,2,'missing May starts a new segment in June')
  assert.equal((path.match(/L /g)||[]).length,1,'only June to July is connected')
  assert.equal((html.match(/class="trend-point"/g)||[]).length,3,'the measured zero is a real point')
  assert.match(html,/Jun · Air: 0/)
  assert.match(html,/May · Air: Unverified/)
  assert.doesNotMatch(html,/class="trend-empty"/)
})

test('all-missing trend data has an empty state without a fabricated zero line',async()=>{
  const html=await renderToString(Vue.createSSRApp(component('TrendChart.vue'),{
    title:'Arrivals',labels:['Week 1','Week 2'],totals:[null,null],
    series:[{name:'Sea',color:'#1e40af',values:[null,null]}],
    missingLabel:'Unverified',emptyLabel:'No verified arrivals',
  }))
  assert.match(html,/No verified arrivals/)
  assert.doesNotMatch(html,/class="trend-point"/)
  assert.doesNotMatch(html,/[ML] \d/)
})

test('the default landing page is the overview dashboard',async()=>{
  i18n.setLanguage('zh')
  const result=await render()
  assert.equal(result.state.page.value,'overview')
  assert.match(result.html,/总览看板/)
})
test('parts grid bounds rendered rows while keeping column filters and the full workbook',async()=>{
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
  assert.equal((html.match(/data-cell/g)||[]).length,2730)
  assert.equal((html.match(/aria-haspopup="dialog"/g)||[]).length,27)
  assert.equal((html.match(/class="pw-resize-column"/g)||[]).length,27)
  assert.equal((html.match(/class="pw-resize-row"/g)||[]).length,103)
  assert.match(html,/1256/)
  assert.match(html,/pw-pagination/)
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

test('SAP comparison view filters by either original PO and shows both PO lines in English',async()=>{
  i18n.setLanguage('en')
  const o={...reconciliation.workspaceOrders()[0],id:'compare',imported:true,cancelled:true,
    sapPo:'SAP-ORIGINAL',sapItem:'00010',sapReferenceStatus:'matched',
    po:'EXCEL-NEW',item:'00020',importFields:{po:'EXCEL-NEW',line:'00020'}}
  const issues=reconciliation.reconcile([o],[])
  const Ops=component('Operations.vue','query,kind,tasks,caseScope')
  const View={...Ops,setup(props,ctx){return Ops.setup(props,{...ctx,expose(s){
    s.caseScope.value='history';s.kind.value='po'
    for(const query of ['SAP-ORIGINAL','EXCEL-NEW']) {
      s.query.value=query;assert.equal(s.tasks.value.length,1)
    }
  }})}}
  const html=await renderToString(Vue.createSSRApp(View,{view:'exceptions',orders:[o],issues,shipments:[],role:'buyer'}))
  assert.match(html,/SAP-ORIGINAL/);assert.match(html,/Excel line: 00020 \/ SAP line: 00010/)
  assert.match(html,/SAP \/ workbook PO mismatch/)
  assertEnglish(html)
})

test('each exception displays simultaneous PO and material differences with six header filters',async()=>{
  i18n.setLanguage('en')
  const o={...reconciliation.workspaceOrders()[0],id:'both',imported:true,cancelled:false,
    sapPo:'SAP-PO-OLD',sapItem:'00010',sapReferenceStatus:'matched',sapPart:'SAP-MATERIAL-OLD',soPart:'EXCEL-MATERIAL-NEW',
    importFields:{po:'EXCEL-PO-NEW',line:'00010'}}
  const issues=reconciliation.reconcile([o],[]).filter(c=>['po','material'].includes(c.kind))
  assert.ok(issues.some(c=>c.kind==='po'));assert.ok(issues.some(c=>c.kind==='material'))
  const html=await renderToString(Vue.createSSRApp(component('Operations.vue'),{view:'exceptions',orders:[o],issues,shipments:[],role:'buyer'}))
  assert.equal((html.match(/aria-haspopup="dialog"/g)||[]).length,6)
  const comparisonRows=[...html.matchAll(/<tr><td><b>.*?<\/tr>/g)]
  assert.equal(comparisonRows.length,2)
  for(const row of comparisonRows){
    for(const value of ['SAP-PO-OLD','EXCEL-PO-NEW','SAP-MATERIAL-OLD','EXCEL-MATERIAL-NEW'])assert.ok(row[0].includes(value))
    assert.ok((row[0].match(/ops-difference/g)||[]).length>=4)
  }
  assertEnglish(html)
})

test('exception scopes keep completed and cancelled history accessible and export only the selected scope',async()=>{
  i18n.setLanguage('en')
  const orders=[{...reconciliation.workspaceOrders()[0],id:'current',imported:true},
    {...reconciliation.workspaceOrders()[0],id:'completed',imported:true,sourceRemaining:0,sourceReported:48},
    {...reconciliation.workspaceOrders()[0],id:'cancelled',imported:true,cancelled:true}]
  const issues=orders.map(o=>({id:'case-'+o.id,order:o.id,kind:'po',title:'PO mismatch',status:'待处理'}))
  let downloaded;exceptionDownload=(...args)=>downloaded=args
  const Ops=component('Operations.vue','caseScope,caseScopeTabs,tasks,exportExceptionView')
  const View={...Ops,setup(props,ctx){return Ops.setup(props,{...ctx,expose(s){
    assert.deepEqual(s.tasks.value.map(c=>c.order),['current','completed','cancelled'])
    assert.deepEqual(s.caseScopeTabs.value.map(t=>t.count),[1,2,3])
    s.caseScope.value='history';assert.deepEqual(s.tasks.value.map(c=>c.order),['completed','cancelled'])
    s.exportExceptionView();assert.deepEqual(downloaded[0].map(c=>c.order),['completed','cancelled'])
    s.caseScope.value='all';assert.equal(s.tasks.value.length,3)
    assert.equal(props.issues.length,3);assert.equal(props.orders.length,3)
  }})}}
  const html=await renderToString(Vue.createSSRApp(View,{view:'exceptions',orders,issues,shipments:[],role:'buyer'}))
  assert.match(html,/Current tasks/);assert.match(html,/Historical records/);assert.match(html,/All records/)
  assertEnglish(html)
})

test('unlinked supplement records remain visible in the web exceptions and data pages without becoming orders',async()=>{
  i18n.setLanguage('en')
  const issue={id:'IMPORT-missing',order:'SOURCE-weekly1',kind:'source_link',status:'待处理',title:{en:'Supplement row requires linking',zh:'补充表记录待关联'},detail:'weekly.xlsx / Sheet1 / 2',owner:'Leo',
    sourceRecord:{po:'4900000999',part:'UNLINKED-PART',importEvidence:[{file:'weekly.xlsx',sheet:'Sheet1',row:2}]}}
  const result=await render({page:'exceptions',orders:[],shipments:[],issues:[issue],checks:[]})
  assert.match(result.html,/4900000999/);assert.match(result.html,/UNLINKED-PART/)
  const Ops=component('Operations.vue','query,tasks,exportExceptionView')
  let downloaded;exceptionDownload=(...args)=>downloaded=args
  const View={...Ops,setup(props,ctx){return Ops.setup(props,{...ctx,expose(s){s.query.value='UNLINKED-PART';assert.equal(s.tasks.value.length,1);s.exportExceptionView()}})}}
  const html=await renderToString(Vue.createSSRApp(View,{view:'data',orders:[],issues:[issue],shipments:[],role:'buyer'}))
  assert.match(html,/4900000999/);assert.equal(downloaded[0][0].id,issue.id);assertEnglish(html)
})

test('header dropdown search and checklists combine across columns and constrain exported results',async()=>{
  i18n.setLanguage('en')
  const orders=['a','b','c'].map(id=>({...reconciliation.workspaceOrders()[0],id,imported:true,
    sapPo:'SAP-'+id,po:'EXCEL-'+id,sapPart:'PART-'+id,soPart:'MATERIAL-'+id}))
  const issues=orders.map((o,i)=>({id:'case-'+o.id,order:o.id,kind:'po',title:'PO mismatch',detail:'Different PO',status:'待处理',owner:i===2?'Other':'Leo',due:'2026-10-01'}))
  let downloaded;exceptionDownload=(...args)=>{downloaded=args}
  const Ops=component('Operations.vue','caseFilterKey,caseFilterDraft,openCaseFilter,closeCaseFilter,keyCaseFilter,caseOptions,visibleCaseOptions,caseFilters,applyCaseFilter,clearCaseFilter,resetCaseFilters,selectCaseOptions,toggleCaseOption,tasks,pageNumber,exportExceptionView')
  const View={...Ops,setup(props,ctx){return Ops.setup(props,{...ctx,expose(s){
    s.openCaseFilter('owner');assert.ok(s.caseOptions.value.includes('Leo / 2026-10-01'))
    s.selectCaseOptions(false);s.toggleCaseOption('Leo / 2026-10-01');s.applyCaseFilter()
    assert.deepEqual(s.tasks.value.map(c=>c.id),['case-a','case-b'])
    s.openCaseFilter('po');s.caseFilterDraft.value.query='SAP-b';s.pageNumber.value=2;s.applyCaseFilter()
    assert.deepEqual(s.tasks.value.map(c=>c.id),['case-b']);assert.equal(s.pageNumber.value,1)
    s.exportExceptionView();assert.deepEqual(downloaded[0].map(c=>c.id),['case-b'])
    s.openCaseFilter('po');s.clearCaseFilter();assert.equal(s.tasks.value.length,2)
    s.openCaseFilter('status');s.selectCaseOptions(false);s.applyCaseFilter();assert.equal(s.tasks.value.length,0)
    s.resetCaseFilters();assert.equal(s.tasks.value.length,3)
    s.openCaseFilter('material');s.caseFilterDraft.value.query='part-a'
    assert.deepEqual(s.visibleCaseOptions.value,['SAP: PART-a'])
    s.keyCaseFilter({key:'Escape',preventDefault(){}});assert.equal(s.caseFilterKey.value,'');assert.equal(s.tasks.value.length,3)
    s.openCaseFilter('material');s.caseFilterDraft.value.query='MATERIAL-c';s.applyCaseFilter()
    assert.deepEqual(s.tasks.value.map(c=>c.id),['case-c'])
  }})}}
  const html=await renderToString(Vue.createSSRApp(View,{view:'exceptions',orders,issues,shipments:[],role:'buyer'}))
  assert.match(html,/Clear column filters/);assertEnglish(html)
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
  for(const page of ['overview','orders','delivery','shipments','exceptions','todos','reports','data']){
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

test('material and unit review dialogs expose separate controls in both languages',async()=>{
  const order=reconciliation.workspaceOrders().at(-1),Review=component('ReviewDialog.vue')
  for(const language of ['zh','en']){
    i18n.setLanguage(language)
    const view=async kind=>renderToString(Vue.createSSRApp(Review,{modelValue:true,role:'buyer',order,
      issue:{id:kind,kind,title:reconciliation.KINDS[kind]},perform:()=>{}}))
    const material=await view('material'),unit=await view('unit')
    assert.doesNotMatch(material,/type="number"/)
    assert.match(unit,/type="number"/)
    assert.match(material,language==='zh'?/物料号待确认/:/Material confirmation required/)
    assert.match(unit,language==='zh'?/单位待确认/:/Unit confirmation required/)
    const imported=await renderToString(Vue.createSSRApp(Review,{modelValue:true,role:'buyer',order:{...order,imported:true},
      issue:{id:'unit',kind:'unit',title:reconciliation.KINDS.unit},perform:()=>{}}))
    assert.doesNotMatch(imported,/type="number"/)
    assert.doesNotMatch(imported,/Confirm &amp; recheck|确认并重新核对/)
  }
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

test('SAP facts received during a collaboration save are applied even when its revision is unchanged',async()=>{
  cloudFactory=async(email,password,receive)=>{
    receive({state:{orders:reconciliation.workspaceOrders(),shipments:reconciliation.workspaceShipments(),issues:[],checks:[]},revision:0,generation:'same-version',email})
    return {save:async state=>{
      const updated=persistence.copy(state);updated.orders[0].sapPart='NEW-SAP-MATERIAL'
      receive({state:updated,revision:1,generation:'same-version',email})
      return {revision:1,at:1}
    },disconnect:async()=>{}}
  }
  const {state:s}=await render();await s.loginCloud({email:'pilot@example.test',password:'test'})
  await s.removeShipment(s.shipments.value[2],'Duplicate registration')
  assert.equal(s.orders.value[0].sapPart,'NEW-SAP-MATERIAL')
  assert.ok(s.shipments.value[2].deletedAt)
  assert.ok(s.checks.value.some(c=>c.kind==='material'&&c.order===s.orders.value[0].id))
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


test('column visibility preserves merged titles, stable identities and local preferences without saving data',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../public/parts-workbook.json',import.meta.url),'utf8'))
  const before=JSON.stringify(source)
  const Parts=component('PartsWorkbook.vue','book,loading,visibleColumns,headerCells,setColumnVisible,showAllColumns,hiddenColumnCount,hiddenColumns,readColumnPreferences,active,switchSheet,dirty')
  const storage=new Map(), previous=globalThis.localStorage
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}
  try {
    const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
      s.book.value=source;s.loading.value=false
      s.active.value={rowId:source.sheets[0].rows[3].id,col:0}
      s.setColumnVisible(0,false);s.setColumnVisible(2,false)
      assert.equal(s.active.value,null)
      assert.equal(s.visibleColumns.value.length,25)
      assert.equal(s.headerCells.value[0][0].cols,25)
      assert.equal(s.headerCells.value[0][0].c,0,'merged title still uses its original cell')
      s.hiddenColumns.value={};s.readColumnPreferences()
      assert.equal(s.hiddenColumnCount.value,2,'reload restores local preferences')
      s.switchSheet('s1');assert.equal(s.visibleColumns.value.length,15)
      s.switchSheet('s0');assert.equal(s.hiddenColumnCount.value,2)
      assert.equal(s.dirty.value,false)
      assert.equal(JSON.stringify(source),before)
    }})}}
    const html=await renderToString(Vue.createSSRApp(View))
    assert.match(html,/colspan="25"/)
    assert.match(html,/备品备件总表（9.4）Parts order list/)
    assert.equal((html.match(/class="pw-resize-column"/g)||[]).length,25)
    assert.doesNotMatch(html,/class="pw-resize-column"[^>]*aria-label="(?:调整列宽 |Resize column )A"/)
    const Guard={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
      s.book.value=source;s.loading.value=false
      for(let c=0;c<27;c++)s.setColumnVisible(c,false)
      assert.equal(s.visibleColumns.value.length,1,'at least one column remains visible')
      s.showAllColumns();assert.equal(s.visibleColumns.value.length,27)
      assert.equal(s.dirty.value,false)
    }})}}
    await renderToString(Vue.createSSRApp(Guard))
  } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
})


test('Excel replacement dialog keeps old data on failure, requires conflict review, and only accepts an acknowledged replacement',async()=>{
  const current={sourceFile:'old.xlsx',sheets:[{id:'s0',name:'Old',headerRows:1,originalRows:2,originalColumns:4,merges:[],columns:[0,1,2,3].map(c=>({id:'s0-c'+c})),rows:[['Purchase Order','Line No','Stockcode','Qty'],['OLD','0010','OLD',10]].map((cells,r)=>({id:'s0-r'+(r+1),cells,formulas:{},types:{}}))}]}
  const candidate=structuredClone(current);candidate.sourceFile='latest.xlsx';candidate.mainSheetId='s0';candidate.sheets[0].name='New';candidate.sheets[0].rows[1].cells=['NEW','0010','NEW',20]
  const original=JSON.stringify(current),factory=workbookStoreFactory
  let shouldFail=true,writes=0,packet={book:current,revision:4,etag:'v4'},state
  workbookStoreFactory=()=>({
    load:async()=>packet,
    replace:async(book,base)=>{writes++;assert.equal(base.revision,4);if(shouldFail)throw new Error('save_conflict');packet={book,backupBook:current,revision:5,etag:'v5'};return packet}
  })
  try {
    const Parts=component('PartsWorkbook.vue','book,base,loading,importOpen,importPreview,importValid,importError,importConflict,importNotice,confirmImport,refreshImportBase,dirty,active,undo,filters')
    const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){state=s;s.book.value=current;s.base.value=packet;s.loading.value=false;s.importOpen.value=true;s.importPreview.value={book:candidate}}})}}
    const html=await renderToString(Vue.createSSRApp(View))
    assert.match(html,/latest.xlsx/);assert.match(html,/Replace all and save|确认完整替换并保存/)
    assert.equal(state.importValid.value,true)
    assert.equal(writes,0,'preview does not save anything')
    await state.confirmImport()
    assert.equal(state.book.value,current);assert.equal(JSON.stringify(current),original);assert.equal(state.importOpen.value,true);assert.equal(state.importConflict.value,true)
    await state.confirmImport();assert.equal(writes,1,'conflict blocks a blind retry')
    await state.refreshImportBase();shouldFail=false
    await state.confirmImport()
    assert.equal(state.book.value.sourceFile,'latest.xlsx');assert.equal(state.base.value.backupBook.sourceFile,'old.xlsx')
    assert.ok(state.book.value.importId);assert.equal(state.book.value.sheets[0].fieldColumns.material,'s0-c2')
    assert.equal(state.importOpen.value,false);assert.equal(state.dirty.value,false);assert.deepEqual(state.undo.value,[])
    assert.match(state.importNotice.value,/latest.xlsx/)
  } finally {workbookStoreFactory=factory}
})


test('parts NEW badge sits in the sequence cell and completion editor retains all three business states',async()=>{
  i18n.setLanguage('zh')
  const book=JSON.parse(fs.readFileSync(new URL('../public/parts-workbook.json',import.meta.url),'utf8'))
  book.sapRefreshRun='refresh2';book.sheets[0].rows=book.sheets[0].rows.slice(0,4)
  const row=book.sheets[0].rows[3];row.sapNewRun='refresh2';row.cells[25]='NG'
  const Parts=component('PartsWorkbook.vue','book,loading,editing,draft')
  const renderGrid=edit=>renderToString(Vue.createSSRApp({...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
    s.book.value=book;s.loading.value=false
    if(edit){s.editing.value={rowId:row.id,col:25};s.draft.value='NG'}
  }})}}))
  const html=await renderGrid(false)
  assert.match(html,/<td[^>]*data-column="0"[^>]*>[\s\S]*?class="pw-new-badge"/)
  assert.match(html,/NEW/);assert.match(html,/NG · 正在进行/)
  assert.match(html,/<tr[^>]+class="pw-status-ng"/)
  row.cells[25]='OK'
  assert.match(await renderGrid(false),/<tr[^>]+class="pw-status-ok"/)
  row.cells[25]='澳洲取消订单'
  assert.doesNotMatch(await renderGrid(false),/class="pw-status-(ng|ok)"/)
  row.cells[25]='NG'
  const baseline=structuredClone(row);baseline.id='china-date-baseline';baseline.cells[13]='2025-01-01';baseline.cells[25]='OK';delete baseline.sapNewRun
  book.sheets[0].rows.push(baseline);row.cells[13]='2025-01-02'
  row.sapOrigin=true;row.sapPending=true;row.cells[25]=null
  const pending=await renderGrid(false)
  assert.match(pending,/<tr[^>]+class="pw-status-sap"/)
  assert.match(pending,/SAP 新增待处理/)
  assert.doesNotMatch(pending,/<tr[^>]+class="pw-status-ng"/)
  partsWorkbook.setCell(book.sheets[0],row.id,25,'NG')
  assert.equal(row.sapPending,false)
  assert.match(await renderGrid(false),/<tr[^>]+class="pw-status-ng"/)
  const editor=await renderGrid(true)
  assert.match(editor,/<option value="NG"[^>]*>NG · 正在进行/)
  assert.match(editor,/<option value="OK"[^>]*>OK · 完成/)
  assert.match(editor,/<option value="澳洲取消订单"/)
  book.sapRefreshRun='refresh3'
  assert.doesNotMatch(await renderGrid(false),/class="pw-new-badge"/)
})

test('parts date scope excludes old SAP from rendered rows, status totals, filters and bulk selection',async()=>{
  i18n.setLanguage('zh')
  const book=JSON.parse(fs.readFileSync(new URL('../public/parts-workbook.json',import.meta.url),'utf8'))
  const sheet=book.sheets[0];sheet.rows=sheet.rows.slice(0,sheet.headerRows+1)
  const china=sheet.rows.at(-1);china.cells[13]='2025-09-12';china.cells[25]='OK'
  const old=structuredClone(china);old.id='hidden-old-sap';old.sapOrigin=true;old.sapPending=true;old.cells[13]='20250911';old.cells[2]='HIDDEN_OLD_PO';old.cells[25]=null
  const current=structuredClone(old);current.id='visible-new-sap';current.cells[13]='20250913';current.cells[2]='VISIBLE_CURRENT_PO'
  const closed=structuredClone(current);closed.id='hidden-closed-sap';closed.cells[2]='HIDDEN_CLOSED_PO';closed.sapOpenPo={eligible:false,reason:'no_open_schedule',openQty:0}
  sheet.rows.push(old,current,closed)
  const before=structuredClone(book)
  const Parts=component('PartsWorkbook.vue','book,loading,matches,completionCounts,openFilter,filterOptions,toggleAllRows,selectedRows,dirty,showPendingSap,filters,search,sort,rowPage,pendingFilterActive,clearFilters,filterDraft,applyFilter')
  const html=await renderToString(Vue.createSSRApp({...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
    s.book.value=book;s.loading.value=false
    assert.equal(s.matches.value.length,2);assert.equal(s.completionCounts.value.pending,1);assert.equal(s.completionCounts.value.OK,1)
    s.openFilter(2);assert.ok(!s.filterOptions.value.some(o=>o.value==='HIDDEN_OLD_PO'))
    assert.ok(!s.filterOptions.value.some(o=>o.value==='HIDDEN_CLOSED_PO'))
    s.toggleAllRows();assert.equal(s.selectedRows.value.length,2);assert.ok(!s.selectedRows.value.includes(old.id));assert.equal(s.dirty.value,false)
    s.openFilter(25)
    assert.deepEqual(s.filterOptions.value.find(o=>o.value===partsWorkbook.SAP_PENDING_FILTER),{value:partsWorkbook.SAP_PENDING_FILTER,count:1})
    s.filterDraft.value={query:'',mode:'all',values:[partsWorkbook.SAP_PENDING_FILTER]};s.applyFilter()
    assert.deepEqual(s.matches.value.map(({row})=>row.id),[current.id])
    s.search.value='no matching PO';s.filters.value={2:{values:['not present']}};s.sort.value={col:2,direction:-1};s.rowPage.value=5
    s.showPendingSap()
    assert.equal(s.search.value,'');assert.equal(s.sort.value,null);assert.equal(s.rowPage.value,1);assert.equal(s.pendingFilterActive.value,true)
    assert.equal(s.matches.value.length,s.completionCounts.value.pending)
    assert.deepEqual(s.matches.value.map(({row})=>row.id),[current.id]);assert.equal(s.dirty.value,false)
    s.clearFilters();assert.equal(s.matches.value.length,2)

  }})}}))
  assert.doesNotMatch(html,/data-row-id="hidden-old-sap"/);assert.match(html,/data-row-id="visible-new-sap"/)
  assert.doesNotMatch(html,/data-row-id="hidden-closed-sap"/)
  assert.match(html,/2025-09-12/);assert.deepEqual(book,before)
})

test('navigation places exceptions and tasks between parts and orders; task page excludes data discrepancies',async()=>{
  i18n.setLanguage('zh')
  const app=await render(),nav=app.html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)[0]
  const positions=['备品备件表格','异常','待办','订单工作台'].map(text=>nav.indexOf(text))
  assert.ok(positions.every((value,i)=>value>=0&&(!i||value>positions[i-1])))
  const base=reconciliation.workspaceOrders()[0]
  const orders=[{...base,id:'open',imported:true,importCompletion:'NG'},{...base,id:'done',imported:true,importCompletion:'OK'}]
  const issues=[{id:'po',kind:'po',order:'open',status:'待处理',title:'PO mismatch'},
    {id:'delivery',kind:'delivery',order:'open',status:'待处理',title:'Dispatch follow-up'},
    {id:'old',kind:'delivery',order:'done',status:'待处理',title:'Completed follow-up'}]
  const Ops=component('Operations.vue','tasks,caseScope')
  const View={...Ops,setup(props,ctx){return Ops.setup(props,{...ctx,expose(s){
    assert.equal(s.caseScope.value,'current');assert.deepEqual(s.tasks.value.map(c=>c.id),['delivery'])
    s.caseScope.value='all';assert.deepEqual(s.tasks.value.map(c=>c.id),['delivery','old'])
  }})}}
  const html=await renderToString(Vue.createSSRApp(View,{view:'todos',orders,issues,shipments:[],role:'buyer'}))
  assert.match(html,/导出待办 Excel/);assert.doesNotMatch(html,/PO mismatch/)
})


test('the separate task page can paginate beyond its first forty tasks',async()=>{
  i18n.setLanguage('en')
  const order=reconciliation.workspaceOrders()[0]
  const issues=Array.from({length:41},(_,i)=>({id:'todo-'+i,kind:'delivery',order:order.id,status:'待处理',title:'Follow-up '+i}))
  const html=await renderToString(Vue.createSSRApp(component('Operations.vue'),{view:'todos',orders:[order],issues,shipments:[],role:'buyer'}))
  assert.match(html,/class="ops-pagination"/);assert.match(html,/41 records · 1 \/ 2/);assert.match(html,/Next/)
})


test('8,400 workbook rows stay bounded in the DOM and all rows remain selectable and reachable',async()=>{
  i18n.setLanguage('en')
  const book={sourceFile:'large.xlsx',sheets:[{id:'s0',name:'Sheet1',headerRows:1,merges:[],columns:[{id:'s0-c0'},{id:'s0-c1'}],
    rows:[{id:'header',cells:['Sequence','Material'],formulas:{},types:{}},...Array.from({length:8400},(_,i)=>({id:'row-'+i,cells:[i+1,'material-'+i],formulas:{},types:{}}))]}]}
  const Parts=component('PartsWorkbook.vue','book,loading,shown,matches,rowPage,rowPageCount,changeRowPage,toggleAllRows,selectedRows,dirty')
  const View={...Parts,setup(props,ctx){return Parts.setup(props,{...ctx,expose(s){
    s.book.value=book;s.loading.value=false
    assert.equal(s.shown.value.length,100);assert.equal(s.matches.value.length,8400);assert.equal(s.rowPageCount.value,84)
    s.toggleAllRows();assert.equal(s.selectedRows.value.length,8400)
    s.changeRowPage(84);assert.equal(s.shown.value[0].row.id,'row-8300');assert.equal(s.shown.value.at(-1).row.id,'row-8399')
    assert.equal(s.dirty.value,false);assert.equal(book.sheets[0].rows.length,8401)
  }})}}
  const html=await renderToString(Vue.createSSRApp(View))
  assert.equal((html.match(/data-row-id=/g)||[]).length,100)
  assert.match(html,/material-8399/);assert.match(html,/8301–8400/)
})

test('large real-data overview and exception navigation use indexed order access during initial setup',async()=>{
  i18n.setLanguage('en')
  let idReads=0
  const orders=Array.from({length:8400},(_,i)=>({...reconciliation.workspaceOrders()[0],get id(){idReads++;return 'large-'+i},po:'PO-'+i,imported:true,importCompletion:'NG',qty:5,reported:0,sourceReported:0,sourceRemaining:5}))
  const checks=orders.map(o=>({id:'CHECK-'+o.id,order:o.id,kind:'delivery',rule:true,title:'Follow up dispatch',status:'待处理'}))
  const html=await renderToString(Vue.createSSRApp(component('Operations.vue'),{view:'overview',orders,issues:checks,shipments:[],role:'buyer'}))
  assert.match(html,/Overview/)
  assert.ok(idReads<8400*25,'order lookups must not scan all orders for every case: '+idReads)
  idReads=0
  const app=await render({orders,shipments:[],issues:[],checks})
  assert.match(app.html,/Tasks/)
  assert.ok(idReads<8400*50,'sidebar and visible-issue lookups must remain linear: '+idReads)
})
