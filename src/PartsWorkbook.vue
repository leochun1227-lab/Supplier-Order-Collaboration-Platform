<script setup>
import { computed, ref, shallowRef, onMounted, onUnmounted, onDeactivated, watch, nextTick } from 'vue'
import { Table2, Search, Plus, Trash2, Undo2, Redo2, Filter, RefreshCw, CloudCheck, LoaderCircle, ArrowDown, ArrowUp, X, Columns3, Download, PaintBucket, Check } from 'lucide-vue-next'
import { Dialog } from 'frappe-ui'
import { language } from './i18n.mjs'
import { cloneBook, columnName, sheetValues, setCell, insertRow, deleteRows, insertColumn, deleteColumn, filteredRows, externalFormula, cellFill, setCellFill, setDimension, dimensionLimits } from './parts-workbook.mjs'
import { createPartsWorkbookStore } from './parts-workbook-store.mjs'
import { createPartsExportWorker } from './parts-workbook-download.mjs'
const emit=defineEmits(['saved'])

const tx = (zh, en) => language.value === 'en' ? en : zh
const store = createPartsWorkbookStore()
const book = shallowRef(null), base = shallowRef(null), sheetId = ref('s0'), loading = ref(true), saving = ref(false), dirty = ref(false), error = ref(''), conflict = ref(false)
const search = ref(''), filters = ref({}), sort = ref(null), selectedRows = ref([]), active = ref(null), editing = ref(null), draft = ref(''), editor = ref(null), confirmation = ref(null), confirmOpen = ref(false)
const colorOpen = ref(false)
const fillPalette = [
  {color:'#FFF2CC',zh:'黄色',en:'Yellow'}, {color:'#FCE4D6',zh:'橙色',en:'Orange'},
  {color:'#F4CCCC',zh:'红色',en:'Red'}, {color:'#E2F0D9',zh:'绿色',en:'Green'},
  {color:'#DDEBF7',zh:'蓝色',en:'Blue'}, {color:'#E4DFEC',zh:'紫色',en:'Purple'},
  {color:'#D9EAD3',zh:'浅绿',en:'Sage'}, {color:'#E7E6E6',zh:'灰色',en:'Gray'}
]
function openColors() { if (activeRow.value && commit()) colorOpen.value = true }
function applyColor(color) {
  if (!activeRow.value || !commit()) return
  if (cellFill(sheet.value, activeRow.value, active.value.col) !== color) mutate(s => setCellFill(s, active.value.rowId, active.value.col, color))
  colorOpen.value = false
}
const filterOpen = ref(false), filterColumn = ref(0), filterDraft = ref({query:'',mode:'all',values:null})
const filterAnchor = shallowRef(null), filterPopover = ref(null), filterSearch = ref(null), filterPosition = ref({})
function positionFilter() {
  if (!filterOpen.value || !filterAnchor.value) return
  if (!filterAnchor.value.isConnected) { closeFilter(false); return }
  const rect = filterAnchor.value.getBoundingClientRect(), grid = tableScroll.value?.getBoundingClientRect()
  if (grid && (rect.right <= grid.left || rect.left >= grid.right)) { closeFilter(false); return }
  const width = Math.min(330, window.innerWidth - 16), below = window.innerHeight - rect.bottom - 13
  const above = Math.max(0, rect.top - 13), upwards = below < 260 && above > below
  const height = Math.min(450, upwards ? above : below)
  filterPosition.value = {
    width: width+'px', left: Math.max(8, Math.min(rect.left, window.innerWidth-width-8))+'px',
    top: Math.max(8, upwards ? rect.top-height-5 : rect.bottom+5)+'px', maxHeight: Math.max(100,height)+'px'
  }
}
function closeFilter(restoreFocus = true) {
  filterOpen.value = false
  if (restoreFocus) filterAnchor.value?.focus({preventScroll:true})
}
function filterOutside(event) {
  if (filterOpen.value && !filterPopover.value?.contains(event.target) && !filterAnchor.value?.contains(event.target)) closeFilter(false)
}
function filterScroll(event) { if (!filterPopover.value?.contains(event.target)) positionFilter() }
const undo = shallowRef([]), redo = shallowRef([]), tableScroll = ref(null), latestRemote = shallowRef(null)
const resizing = shallowRef(null)
function startResize(event, axis, id) {
  if (event.button !== 0 || !commit()) return
  cancelResize(); closeFilter(false)
  const handle = event.currentTarget, rect = handle.parentElement.getBoundingClientRect()
  const size = axis === 'column' ? rect.width : rect.height
  resizing.value = {axis,id,sheetId:sheetId.value,handle,pointerId:event.pointerId,start:axis==='column'?event.clientX:event.clientY,startSize:size,size}
  handle.focus({preventScroll:true}); handle.setPointerCapture(event.pointerId)
}
function moveResize(event) {
  const drag = resizing.value
  if (!drag || event.pointerId !== drag.pointerId) return
  const {min,max} = dimensionLimits[drag.axis]
  resizing.value = {...drag,size:Math.max(min,Math.min(max,Math.round(drag.startSize+(drag.axis==='column'?event.clientX:event.clientY)-drag.start)))}
}
function cancelResize() {
  const drag = resizing.value; resizing.value = null
  if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId)
}
function finishResize(event) {
  if (!resizing.value || event.pointerId !== resizing.value.pointerId) return
  moveResize(event)
  const drag = resizing.value; cancelResize()
  if (drag.sheetId === sheetId.value && Math.round(drag.startSize) !== drag.size) mutate(s => setDimension(s,drag.axis,drag.id,drag.size))
}
function resetDimension(axis,id) { if (commit()) { cancelResize(); mutate(s => setDimension(s,axis,id,null)) } }
function sizeKey(event,axis,id,current) {
  if (event.key === 'Escape') { event.preventDefault(); cancelResize(); return }
  const step = ['ArrowRight','ArrowDown'].includes(event.key)?10:['ArrowLeft','ArrowUp'].includes(event.key)?-10:0
  if (step && commit()) { event.preventDefault(); mutate(s => setDimension(s,axis,id,current+step)) }
}
function rowSize(row) { return resizing.value?.axis==='row'&&resizing.value.id===row.id?resizing.value.size:row.heightPx }
function rowStyle(row) { const size = rowSize(row); return size ? {'--pw-row-height':size+'px',height:size+'px'} : {} }
const exporting=ref(false),exportError=ref(''),exportNotice=ref('')
let exportWorker,exportTimeout
let saveTimer, pollTimer, stopped = false, generation = 0
const sheet = computed(() => book.value?.sheets.find(s => s.id === sheetId.value))
const values = computed(() => sheet.value ? sheetValues(sheet.value) : [])
const matches = computed(() => sheet.value ? filteredRows(sheet.value, values.value, search.value, filters.value, sort.value) : [])
const shown = matches
const filterCount = computed(() => Object.values(filters.value).filter(Boolean).length)
const selectedRowSet = computed(() => new Set(selectedRows.value))
const allSelected = computed(() => shown.value.length > 0 && shown.value.every(({ row }) => selectedRowSet.value.has(row.id)))
const activeRow = computed(() => sheet.value?.rows.find(r => r.id === active.value?.rowId))
const activeIndex = computed(() => sheet.value?.rows.findIndex(r => r.id === active.value?.rowId) ?? -1)
const formula = computed(() => activeRow.value?.formulas[active.value?.col] || '')
const displayActive = computed(() => activeIndex.value >= 0 ? values.value[activeIndex.value][active.value.col] : '')
const status = computed(() => loading.value ? tx('正在加载…', 'Loading…') : error.value ? tx('尚未保存', 'Not saved') : saving.value ? tx('正在保存到 Firebase…', 'Saving to Firebase…') : dirty.value ? tx('有待保存的修改', 'Unsaved changes') : tx('已保存到 Firebase', 'Saved to Firebase'))
watch([search, filters, sort], () => { selectedRows.value = []; if (tableScroll.value) tableScroll.value.scrollTop = 0 }, { deep: true })
const filterOptions = computed(() => {
  if (!filterOpen.value || !sheet.value) return []
  const counts = new Map()
  for (const cells of values.value.slice(sheet.value.headerRows)) {
    const value = String(cells[filterColumn.value] ?? '')
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts].map(([value,count]) => ({value,count})).sort((a,b) => a.value.localeCompare(b.value, 'zh-CN', {numeric:true}))
})
const visibleOptions = computed(() => filterOptions.value.filter(({value}) =>
  value.toLocaleLowerCase().includes(filterDraft.value.query.toLocaleLowerCase()) &&
  (filterDraft.value.mode !== 'blank' || value === '') && (filterDraft.value.mode !== 'nonblank' || value !== '')))
function columnLabel(c) { return String(values.value[sheet.value.headerRows - 1]?.[c] || columnName(c)) }
function filterLabel(c) {
  const f = filters.value[c]
  if (!f) return tx('筛选','Filter')
  return f.mode === 'blank' ? tx('空白','Blank') : f.mode === 'nonblank' ? tx('非空白','Nonblank') : f.query || (f.values ? tx('已选 '+f.values.length+' 项', f.values.length+' selected') : tx('已筛选','Filtered'))
}
function openFilter(c, anchor = null) {
  if (!commit()) return
  if (anchor && filterOpen.value && filterColumn.value === c) { closeFilter(); return }
  filterAnchor.value = anchor
  filterColumn.value = c
  filterDraft.value = filters.value[c] ? cloneBook(filters.value[c]) : {query:'',mode:'all',values:null}
  filterOpen.value = true
  if (anchor) { positionFilter(); nextTick(() => { if (filterOpen.value) filterSearch.value?.focus({preventScroll:true}) }) }
}
function optionSelected(value) { return filterDraft.value.values == null || filterDraft.value.values.includes(value) }
function toggleOption(value) {
  const selected = new Set(filterDraft.value.values ?? filterOptions.value.map(o => o.value))
  if (selected.has(value)) selected.delete(value); else selected.add(value)
  filterDraft.value.values = [...selected]
}
function selectFilterOptions(selected) {
  filterDraft.value.values = selected ? visibleOptions.value.map(o => o.value) : []
}
function applyFilter() {
  const f = cloneBook(filterDraft.value)
  if (f.values?.length === filterOptions.value.length) f.values = null
  if (!f.query && f.mode === 'all' && f.values == null) delete filters.value[filterColumn.value]
  else filters.value[filterColumn.value] = f
  closeFilter()
}
function clearColumnFilter() { delete filters.value[filterColumn.value]; closeFilter() }

function errorText(e) {
  return ({ save_conflict: tx('其他人已修改此表。你的修改仍保留在当前页面，请先查看云端版本。', 'Someone else changed this workbook. Your edits remain here; review the cloud version.'), unsupported_formula: tx('支持加减乘除、单元格引用和 SUM(A1:B3)。外部查找公式只能保留原结果。', 'Use arithmetic, cell references or SUM(A1:B3). External lookups retain their existing results.'), invalid_date: tx('日期请填写 YYYY-MM-DD，例如 2026-09-11。', 'Enter a date as YYYY-MM-DD, for example 2026-09-11.') })[e.message] || tx('连接或保存失败。修改仍在当前页面，请检查网络后重试。', 'Connection or save failed. Your edits remain here; check the network and retry.')
}
function accept(packet) {
  const previous=sheet.value, columnId=previous?.columns[active.value?.col]?.id
  base.value=packet; book.value=packet.book
  if (!book.value.sheets.some(s=>s.id===sheetId.value)) sheetId.value=book.value.sheets[0].id
  const next=sheet.value
  if (previous && (previous.id!==next.id || previous.columns.map(c=>c.id).join('|')!==next.columns.map(c=>c.id).join('|'))) {
    filters.value={};sort.value=null;closeFilter(false);colorOpen.value=false
  }
  if (active.value) {
    const col=next.columns.findIndex(c=>c.id===columnId)
    active.value=col>=0&&next.rows.some(r=>r.id===active.value.rowId)?{...active.value,col}:null
  }
  selectedRows.value=selectedRows.value.filter(id=>next.rows.some(r=>r.id===id))
  emit('saved',packet)
}
async function load() {
  loading.value = true; error.value = ''
  try {
    let packet = await store.load()
    if (!packet.book) {
      const response = await fetch('/parts-workbook.json')
      if (!response.ok) throw new Error('seed_unavailable')
      packet = await store.initialize(await response.json())
    }
    if (!stopped) accept(packet)
  } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
async function save() {
  clearTimeout(saveTimer)
  if (!dirty.value || saving.value || conflict.value || !base.value) return
  const snapshot = book.value, currentGeneration = generation
  saving.value = true; error.value = ''
  try {
    const packet = await store.save(snapshot, base.value)
    base.value = packet
    if (generation === currentGeneration) { book.value = packet.book; dirty.value = false }
    emit('saved',packet)
  } catch (e) { error.value = errorText(e); conflict.value = e.message === 'save_conflict' }
  finally { saving.value = false; if (dirty.value && !error.value && !stopped) saveTimer = setTimeout(save, 300) }
}
function schedule() { dirty.value = true; generation++; clearTimeout(saveTimer); saveTimer = setTimeout(save, 650) }
function mutate(change) {
  const previous = book.value, next = cloneBook(previous), target = next.sheets.find(s => s.id === sheetId.value)
  try { change(target); undo.value = [...undo.value.slice(-19), previous]; redo.value = []; book.value = next; if (!conflict.value) error.value = ''; schedule(); return true }
  catch (e) { error.value = errorText(e); return false }
}
function undoChange() { if (!undo.value.length || editing.value) return; redo.value = [...redo.value, book.value]; book.value = undo.value.at(-1); undo.value = undo.value.slice(0, -1); active.value = null; selectedRows.value = []; schedule() }
function redoChange() { if (!redo.value.length || editing.value) return; undo.value = [...undo.value, book.value]; book.value = redo.value.at(-1); redo.value = redo.value.slice(0, -1); active.value = null; selectedRows.value = []; schedule() }
function selectCell(row, col) { if (editing.value && !commit()) return; active.value = { rowId: row.id, col } }
async function startEdit(row, col) {
  if (editing.value && !commit()) return
  active.value = { rowId: row.id, col }; editing.value = { ...active.value }
  draft.value = String(row.formulas[col] || (row.cells[col] ?? ''))
  await nextTick(); const el = Array.isArray(editor.value) ? editor.value[0] : editor.value; el?.focus(); el?.select()
}
function commit() {
  if (!editing.value) return true
  const { rowId, col } = editing.value, row = sheet.value.rows.find(r => r.id === rowId)
  if (draft.value === String(row.formulas[col] || (row.cells[col] ?? ''))) { editing.value = null; return true }
  if (!mutate(s => setCell(s, rowId, col, draft.value))) return false
  editing.value = null; return true
}
function keyCell(event, row, col) {
  if (editing.value) return
  if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); startEdit(row, col) }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); mutate(s => setCell(s, row.id, col, '')) }
  else if (event.key.startsWith('Arrow')) {
    event.preventDefault()
    const cells = [...tableScroll.value.querySelectorAll('[data-cell]')], index = cells.indexOf(event.currentTarget)
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowUp' ? index - sheet.value.columns.length : index + sheet.value.columns.length
    cells[next]?.focus(); cells[next]?.click()
  }
}
function paste(event, row, col) {
  if (editing.value) return
  const text = event.clipboardData?.getData('text/plain')
  if (text == null) return
  event.preventDefault()
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'))
  const visibleRows = [...sheet.value.rows.slice(0, sheet.value.headerRows).map((r, index) => ({row:r,index})), ...matches.value]
  const start = visibleRows.findIndex(item => item.row.id === row.id)
  if (lines.some((line, r) => !visibleRows[start + r] || col + line.length > sheet.value.columns.length)) { error.value = tx('粘贴内容超出当前行列范围，请先新增行或列。', 'Paste exceeds the grid. Add rows or columns first.'); return }
  mutate(s => lines.forEach((line, r) => line.forEach((value, c) => setCell(s, visibleRows[start + r].row.id, col + c, value))))
}
function toggleRow(id) { selectedRows.value = selectedRows.value.includes(id) ? selectedRows.value.filter(x => x !== id) : [...selectedRows.value, id] }
function toggleAllRows() { const ids = shown.value.map(({row}) => row.id); selectedRows.value = allSelected.value ? [] : ids }
async function addRow() {
  if (!commit()) return
  let id
  if (!mutate(s => { id = insertRow(s, activeIndex.value >= s.headerRows ? activeIndex.value + 1 : s.rows.length) })) return
  clearFilters(); sort.value = null; active.value = {rowId:id,col:0}
  await nextTick()
  const cell = tableScroll.value?.querySelector('[data-row-id="'+id+'"] [data-cell]')
  cell?.scrollIntoView({block:'center',inline:'nearest'}); cell?.focus({preventScroll:true})
}
function askDelete(kind) { if (!commit()) return; confirmation.value = kind; confirmOpen.value = true }
function remove() {
  if (confirmation.value === 'rows') mutate(s => deleteRows(s, selectedRows.value))
  if (confirmation.value === 'column') { mutate(s => deleteColumn(s, active.value.col)); filters.value = {}; sort.value = null }
  if (confirmation.value === 'reload') { editing.value=null; if (latestRemote.value) accept(latestRemote.value); dirty.value = false; conflict.value = false; error.value = ''; undo.value = []; redo.value = []; clearTimeout(saveTimer) }
  selectedRows.value = []; active.value = null; confirmOpen.value = false
}
async function reviewRemote() { try { latestRemote.value = await store.load(); confirmation.value = 'reload'; confirmOpen.value = true } catch (e) { error.value = errorText(e) } }
async function retry() { if (dirty.value) return save(); if (!book.value) return load(); try { const next = await store.load(); if (!dirty.value && !editing.value) { accept(next); error.value = '' } } catch (e) { error.value = errorText(e) } }
function clearFilters() { search.value = ''; filters.value = {} }
async function exportExcel() {
  if(exporting.value||!book.value||!commit())return
  const snapshot=cloneBook(book.value)
  exporting.value=true;exportError.value='';exportNotice.value=''
  try {
    exportWorker=createPartsExportWorker()
    const buffer=await new Promise((resolve,reject)=>{
      exportTimeout=setTimeout(()=>reject(new Error('export_timeout')),120000)
      exportWorker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.buffer)
      exportWorker.onerror=()=>reject(new Error('export_failed'))
      exportWorker.postMessage({book:snapshot})
    })
    const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    const url=URL.createObjectURL(blob),link=document.createElement('a')
    link.href=url;link.download=snapshot.sourceFile.replace(/\.xlsx$/i,'')+'_'+new Date().toISOString().slice(0,10)+'.xlsx'
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
    exportNotice.value=tx('已导出全部工作表，包含当前修改和所有数据行。','Exported all worksheets, including current edits and all data rows.')
  } catch { exportError.value=tx('Excel 导出失败，请检查网络后重试。当前表格内容已保留。','Excel export failed. Check your connection and retry. Your workbook is unchanged.') }
  finally {clearTimeout(exportTimeout);exportWorker?.terminate();exportWorker=null;exporting.value=false}
}
function switchSheet(id) { if (!commit()) return; closeFilter(false); cancelResize(); sheetId.value = id; clearFilters(); sort.value = null; active.value = null; selectedRows.value = []; if (tableScroll.value) tableScroll.value.scrollTop = 0 }
function merged(r, c) { return sheet.value.merges.find(m => r >= m.r && r < m.r + m.rows && c >= m.c && c < m.c + m.cols) }
function covered(r, c) { const m = merged(r, c); return m && (m.r !== r || m.c !== c) }
function width(c) {
  const col = sheet.value.columns[c]
  if (resizing.value?.axis==='column'&&resizing.value.id===col.id) return resizing.value.size
  if (Number.isFinite(col.widthPx)) return col.widthPx
  const source = Number(/^s\d+-c(\d+)$/.exec(col.id)?.[1] ?? c)
  return sheet.value.id === 's1' ? (source === 0 ? 150 : 120) : [60,110,160,95,150,280,280,245,150,120,110,145,170,150,160,160,160,200,170,140,165,240,170,210,180,170,320][source] || 170
}
function beforeUnload(event) { if (dirty.value || saving.value || editing.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { document.addEventListener('pointerdown', filterOutside); document.addEventListener('focusin', filterOutside); window.addEventListener('resize', positionFilter); window.addEventListener('scroll', filterScroll, true) })
onDeactivated(() => { closeFilter(false); cancelResize() })
onUnmounted(cancelResize)
onUnmounted(() => { document.removeEventListener('pointerdown', filterOutside); document.removeEventListener('focusin', filterOutside); window.removeEventListener('resize', positionFilter); window.removeEventListener('scroll', filterScroll, true) })
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); await load(); pollTimer = setInterval(async () => { if (dirty.value || saving.value || editing.value || resizing.value || loading.value || stopped || !base.value) return; try { const next = await store.load(); if (!stopped && !dirty.value && !saving.value && !editing.value && !resizing.value) { if (next.revision > base.value.revision) { accept(next); undo.value = []; redo.value = [] } error.value = '' } } catch (e) { if (!stopped) error.value = errorText(e) } }, 15000) })
onUnmounted(() => { stopped = true; clearTimeout(saveTimer); clearInterval(pollTimer); clearTimeout(exportTimeout); exportWorker?.terminate(); window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <section class="parts-workbook" :class="{'pw-resizing-columns':resizing?.axis==='column','pw-resizing-rows':resizing?.axis==='row'}" :aria-label="tx('备品备件表格','Parts workbook')">
    <header class="pw-heading"><slot name="navigation"/><div class="pw-title" :title="book?.sourceFile"><span class="pw-icon"><Table2 :size="23" /></span><div><h1>{{tx('备品备件总表','Parts order workbook')}}</h1><p>{{book?.sourceFile || '2026 Parts order list发澳洲.xlsx'}}</p></div></div><div class="pw-status" :class="{failed:error}" aria-live="polite"><LoaderCircle v-if="loading || saving" :size="17" class="pw-spin"/><CloudCheck v-else :size="17"/><span>{{status}}<small v-if="base?.savedAt">{{new Date(base.savedAt).toLocaleTimeString(language==='en'?'en-AU':'zh-CN')}} · {{tx('版本','Version')}} {{base.revision}}</small></span></div><slot name="header-actions"/></header>
    <div v-if="error" class="pw-error" role="alert"><span>{{error}}</span><button v-if="conflict" @click="reviewRemote">{{tx('查看云端版本','Review cloud version')}}</button><button v-else @click="retry">{{tx('重试','Retry')}}</button></div>
    <div v-if="exportError" class="pw-error" role="alert">{{exportError}}</div><p v-if="exportNotice" class="pw-export-notice" role="status">{{exportNotice}}</p>
    <div v-if="!book" class="pw-loading">{{loading ? tx('正在加载完整工作簿…','Loading the complete workbook…') : tx('工作簿加载失败，请重试。','Could not load the workbook. Please retry.')}}</div>
    <template v-else>
      <div class="pw-toolbar"><label class="pw-search"><Search :size="17"/><input v-model="search" :placeholder="tx('搜索当前工作表…','Search this worksheet…')" :aria-label="tx('搜索当前工作表','Search worksheet')"/></label><span class="pw-filter-hint"><Filter :size="16"/>{{filterCount ? tx(filterCount+' 列已筛选',filterCount+' columns filtered') : tx('每列表头均可筛选','Filter any column below')}}</span><button v-if="search || filterCount || sort" @click="clearFilters();sort=null"><X :size="15"/>{{tx('清除','Clear')}}</button><span class="pw-toolbar-divider"/><button class="pw-primary" @click="addRow"><Plus :size="16"/>{{tx('新增行','Add row')}}</button><button @click="commit() && mutate(s => insertColumn(s))"><Columns3 :size="16"/>{{tx('新增列','Add column')}}</button><button :disabled="!selectedRows.length" @click="askDelete('rows')"><Trash2 :size="16"/>{{tx('删除行','Delete rows')}}<b v-if="selectedRows.length">{{selectedRows.length}}</b></button><button :disabled="!active || sheet.columns.length <= 1" @click="askDelete('column')">{{tx('删除列','Delete column')}}</button><span class="pw-toolbar-divider"/><button :disabled="!activeRow" @click="openColors" :title="tx('为选中的单元格标注颜色','Color the selected cell')"><PaintBucket :size="16"/><i class="pw-current-fill" :style="{background:activeRow?cellFill(sheet,activeRow,active.col)||'#ffffff':'#ffffff'}"/>{{tx('填色','Fill color')}}</button><button :disabled="!undo.length || !!editing" :title="tx('撤销','Undo')" :aria-label="tx('撤销','Undo')" @click="undoChange"><Undo2 :size="17"/></button><button :disabled="!redo.length || !!editing" :title="tx('重做','Redo')" :aria-label="tx('重做','Redo')" @click="redoChange"><Redo2 :size="17"/></button><button :disabled="saving || !dirty || conflict" @click="commit() && save()"><RefreshCw :size="15"/>{{tx('保存','Save')}}</button><button class="pw-export" :disabled="exporting" @click="exportExcel" :title="tx('按原文件格式导出全部工作表，不受筛选影响','Export all worksheets in the original format, regardless of filters')"><LoaderCircle v-if="exporting" :size="16" class="pw-spin"/><Download v-else :size="16"/>{{exporting?tx('正在导出…','Exporting…'):tx('导出 Excel','Export Excel')}}</button></div>
      <div class="pw-formulabar"><span class="pw-address">{{active ? columnName(active.col)+(activeIndex+1) : '—'}}</span><span class="pw-fx">fx</span><button class="pw-formulavalue" :disabled="!activeRow" @click="startEdit(activeRow,active.col)" :title="tx('点击编辑完整内容','Click to edit the full value')">{{formula || displayActive || tx('选择单元格，双击或按 Enter 编辑','Select a cell; double-click or press Enter to edit')}}</button><span v-if="externalFormula(formula)" class="pw-external">{{tx('外部公式 · 原文件缓存值','External formula · cached value')}}</span></div>
      <div class="pw-grid-scroll" ref="tableScroll">
        <table class="pw-grid" :aria-label="sheet.name" :style="{width: 48+sheet.columns.reduce((n,_,c)=>n+width(c),0)+'px'}">
          <colgroup><col style="width:48px"/><col v-for="(col,c) in sheet.columns" :key="col.id" :style="{width:width(c)+'px'}"/></colgroup>
          <thead><tr class="pw-letters"><th><input type="checkbox" :checked="allSelected" @change="toggleAllRows" :aria-label="tx('选择全部筛选结果','Select all matching data rows')"/></th><th v-for="(col,c) in sheet.columns" :key="col.id"><button @click="sort=sort?.col===c&&sort.direction===1?{col:c,direction:-1}:sort?.col===c?null:{col:c,direction:1}" :aria-label="tx('排序列 ','Sort column ')+columnName(c)">{{columnName(c)}}<ArrowDown v-if="sort?.col===c&&sort.direction===1" :size="12"/><ArrowUp v-else-if="sort?.col===c" :size="12"/></button><span class="pw-resize-column" role="separator" tabindex="0" aria-orientation="vertical" :aria-label="tx('调整列宽 ','Resize column ')+columnName(c)" :aria-valuemin="48" :aria-valuemax="1200" :aria-valuenow="width(c)" :title="tx('拖动调整列宽；双击恢复默认','Drag to resize column; double-click to reset')" @pointerdown.stop.prevent="startResize($event,'column',col.id)" @pointermove.stop="moveResize" @pointerup.stop="finishResize" @pointercancel="cancelResize" @lostpointercapture="cancelResize" @click.stop @dblclick.stop.prevent="resetDimension('column',col.id)" @keydown.stop="sizeKey($event,'column',col.id,width(c))"/></th></tr>
            <tr v-for="(row,r) in sheet.rows.slice(0,sheet.headerRows)" :key="row.id" :style="rowStyle(row)" :class="['pw-source-header',{'pw-sized-row':!!rowSize(row),'pw-source-title':r===0&&sheet.headerRows>1,'pw-source-group':r===1&&sheet.headerRows>1}]"><th class="pw-row-number">{{r+1}}<span class="pw-resize-row" role="separator" tabindex="0" aria-orientation="horizontal" :aria-label="tx('调整行高 ','Resize row ')+(r+1)" :aria-valuemin="24" :aria-valuemax="546" :aria-valuenow="rowSize(row)||34" :title="tx('拖动调整行高；双击恢复默认','Drag to resize row; double-click to reset')" @pointerdown.stop.prevent="startResize($event,'row',row.id)" @pointermove.stop="moveResize" @pointerup.stop="finishResize" @pointercancel="cancelResize" @lostpointercapture="cancelResize" @click.stop @dblclick.stop.prevent="resetDimension('row',row.id)" @keydown.stop="sizeKey($event,'row',row.id,rowSize(row)||34)"/></th><template v-for="(col,c) in sheet.columns" :key="col.id"><th v-if="!covered(r,c)" :colspan="merged(r,c)?.cols || 1" :rowspan="merged(r,c)?.rows || 1" tabindex="0" data-cell :style="{'--pw-cell-fill':cellFill(sheet,row,c)}" :class="{'has-fill':!!cellFill(sheet,row,c),focused:active?.rowId===row.id&&active?.col===c}" @click="selectCell(row,c)" @dblclick="startEdit(row,c)" @keydown="keyCell($event,row,c)" @paste="paste($event,row,c)"><textarea v-if="editing?.rowId===row.id&&editing?.col===c" ref="editor" v-model="draft" :aria-label="columnName(c)+(r+1)" @blur="commit" @keydown.enter.exact.prevent="commit" @keydown.esc.prevent="editing=null"/><span v-else>{{values[r][c]}}</span></th></template></tr>
            <tr class="pw-filter-row"><th><Filter :size="14"/></th><th v-for="(col,c) in sheet.columns" :key="col.id"><button class="pw-column-filter" :class="{active:!!filters[c]}" @click="openFilter(c,$event.currentTarget)" @keydown.down.prevent="openFilter(c,$event.currentTarget)" :aria-label="tx('筛选列 ','Filter column ')+columnName(c)+' · '+columnLabel(c)" :title="columnLabel(c)+' · '+filterLabel(c)" aria-haspopup="dialog" :aria-expanded="filterOpen&&filterColumn===c" :aria-controls="filterOpen&&filterColumn===c?'pw-column-filter-popover':undefined"><Filter :size="13"/><span>{{filterLabel(c)}}</span></button></th></tr>
          </thead>
          <tbody><tr v-for="{row,index} in shown" :key="row.id" v-memo="[row,index,values[index],rowSize(row),active?.rowId===row.id?active.col:null,editing?.rowId===row.id?editing.col:null,editing?.rowId===row.id?draft:null,selectedRowSet.has(row.id),language]" :data-row-id="row.id" :style="rowStyle(row)" :class="{'pw-sized-row':!!rowSize(row),'pw-row-selected':selectedRowSet.has(row.id)}"><th class="pw-row-number"><label><span>{{index+1}}</span><input type="checkbox" :checked="selectedRowSet.has(row.id)" :aria-label="tx('选择第 ','Select row ')+(index+1)" @change="toggleRow(row.id)"/></label><span class="pw-resize-row" role="separator" tabindex="0" aria-orientation="horizontal" :aria-label="tx('调整行高 ','Resize row ')+(index+1)" :aria-valuemin="24" :aria-valuemax="546" :aria-valuenow="rowSize(row)||34" :title="tx('拖动调整行高；双击恢复默认','Drag to resize row; double-click to reset')" @pointerdown.stop.prevent="startResize($event,'row',row.id)" @pointermove.stop="moveResize" @pointerup.stop="finishResize" @pointercancel="cancelResize" @lostpointercapture="cancelResize" @click.stop @dblclick.stop.prevent="resetDimension('row',row.id)" @keydown.stop="sizeKey($event,'row',row.id,rowSize(row)||34)"/></th><td v-for="(col,c) in sheet.columns" :key="col.id" tabindex="0" data-cell :style="{'--pw-cell-fill':cellFill(sheet,row,c)}" :class="{'has-fill':!!cellFill(sheet,row,c),focused:active?.rowId===row.id&&active?.col===c,numeric:typeof values[index][c]==='number',formula:!!row.formulas[c]}" @click="selectCell(row,c)" @dblclick="startEdit(row,c)" @keydown="keyCell($event,row,c)" @paste="paste($event,row,c)" @copy="!editing && ($event.clipboardData.setData('text/plain',String(values[index][c]??'')),$event.preventDefault())"><textarea v-if="editing?.rowId===row.id&&editing?.col===c" ref="editor" v-model="draft" :aria-label="columnName(c)+(index+1)" @blur="commit" @keydown.enter.exact.prevent="commit" @keydown.esc.prevent="editing=null"/><span v-else :title="String(values[index][c]??'')">{{values[index][c]}}</span></td></tr></tbody>
        </table><div v-if="!shown.length" class="pw-empty">{{tx('没有符合筛选条件的行。','No rows match these filters.')}}<button @click="clearFilters">{{tx('清除筛选','Clear filters')}}</button></div>
      </div>
      <footer class="pw-footer" :title="tx('拖动列头／行号边界调整尺寸 · 双击边界恢复 · 双击格子编辑','Drag header edges to resize · Double-click edges to reset · Double-click cells to edit')"><div class="pw-sheet-tabs" role="tablist" :aria-label="tx('工作表','Worksheets')"><button v-for="s in book.sheets" :key="s.id" role="tab" :aria-selected="sheetId===s.id" :class="{active:sheetId===s.id}" @click="switchSheet(s.id)"><Table2 :size="15"/>{{s.name}}<small>{{s.rows.length}} × {{s.columns.length}}</small></button></div><div class="pw-footer-meta"><span>{{tx('原文件','Original')}}: {{sheet.originalRows}} {{tx('行','rows')}} × {{sheet.originalColumns}} {{tx('列','columns')}} · {{tx('当前','Current')}}: {{sheet.rows.length}} × {{sheet.columns.length}} {{tx('（含标题行）','(including headers)')}}</span></div><div class="pw-row-count" role="status">{{tx('显示','Showing')}} {{matches.length}} / {{sheet.rows.length-sheet.headerRows}} {{tx('数据行 · 连续滚动','data rows · Continuous scrolling')}}</div></footer>

    </template>
    <Dialog v-model="colorOpen" :options="{title:tx('单元格填色','Cell fill color')+' · '+(active?columnName(active.col)+(activeIndex+1):''),size:'sm'}">
      <template #body-content><div class="pw-fill-palette"><button v-for="option in fillPalette" :key="option.color" :style="{background:option.color}" :aria-pressed="!!activeRow&&cellFill(sheet,activeRow,active.col)===option.color" @click="applyColor(option.color)"><span>{{tx(option.zh,option.en)}}</span><Check v-if="activeRow&&cellFill(sheet,activeRow,active.col)===option.color" :size="16"/></button></div><p class="pw-filter-help">{{tx('选择颜色后自动保存，导出 Excel 也会保留。','Colors save automatically and are included in Excel exports.')}}</p></template>
      <template #actions><button class="pw-dialog-button" @click="applyColor('')">{{tx('清除标注颜色','Clear fill color')}}</button><button class="pw-dialog-button" @click="colorOpen=false">{{tx('取消','Cancel')}}</button></template>
    </Dialog>
    <div v-if="filterOpen" id="pw-column-filter-popover" ref="filterPopover" class="pw-filter-popover" role="dialog" aria-modal="false" aria-labelledby="pw-filter-heading" :style="filterPosition" @keydown.esc.stop.prevent="closeFilter()">
      <div class="pw-popover-heading"><strong id="pw-filter-heading" :title="sheet?columnLabel(filterColumn):''">{{tx('筛选列 ','Filter column ')+columnName(filterColumn)+' · '+(sheet?columnLabel(filterColumn):'')}}</strong><button :aria-label="tx('关闭筛选','Close filter')" @click="closeFilter()"><X :size="16"/></button></div>
      <div class="pw-filter-panel">
        <label>{{tx('包含文字','Contains text')}}<input ref="filterSearch" v-model="filterDraft.query" :placeholder="tx('搜索本列的值…','Search values in this column…')"/></label>
        <label>{{tx('空白条件','Blank values')}}<select v-model="filterDraft.mode"><option value="all">{{tx('全部','All')}}</option><option value="blank">{{tx('仅空白','Blank only')}}</option><option value="nonblank">{{tx('仅非空白','Nonblank only')}}</option></select></label>
        <div class="pw-filter-actions"><button @click="selectFilterOptions(true)">{{tx('全选搜索结果','Select search results')}}</button><button @click="selectFilterOptions(false)">{{tx('取消全选','Deselect all')}}</button><span>{{visibleOptions.length}} {{tx('个不同值','distinct values')}}</span></div>
        <div class="pw-filter-options"><label v-for="option in visibleOptions" :key="option.value"><input type="checkbox" :checked="optionSelected(option.value)" @change="toggleOption(option.value)"/><span>{{option.value || tx('（空白）','(Blank)')}}</span><small>{{option.count}}</small></label><p v-if="!visibleOptions.length">{{tx('没有符合条件的值','No matching values')}}</p></div>
        <p class="pw-filter-help">{{tx('多个列的条件同时生效。筛选仅改变显示，不会删除数据。','Column filters apply together. Filtering changes the view without deleting data.')}}</p>
      </div>
      <div class="pw-popover-footer"><button class="pw-dialog-button" @click="clearColumnFilter">{{tx('清除此列筛选','Clear column filter')}}</button><button class="pw-dialog-button" @click="closeFilter()">{{tx('取消','Cancel')}}</button><button class="pw-dialog-button pw-apply" @click="applyFilter">{{tx('应用筛选','Apply filter')}}</button></div>
    </div>
    <Dialog v-model="confirmOpen" :options="{title:confirmation==='reload'?tx('云端版本','Cloud version'):tx('确认删除','Confirm deletion'),size:'lg'}"><template #body-content><p class="pw-confirm-text" v-if="confirmation==='reload'">{{tx('云端版本','Cloud version')}} {{latestRemote?.revision}} · {{tx('当前基础版本','Your base version')}} {{base?.revision}}<br/>{{tx('载入云端版本会放弃当前未保存的修改。取消可继续保留当前内容。','Loading the cloud version discards your unsaved edits. Cancel to keep your current work.')}}</p><p class="pw-confirm-text" v-else>{{confirmation==='rows'?tx('将删除所选的 '+selectedRows.length+' 行及其内容。','Delete the '+selectedRows.length+' selected rows and their contents?'):tx('将删除 '+columnName(active?.col||0)+' 列及其全部内容。','Delete column '+columnName(active?.col||0)+' and all its contents?')}} {{tx('删除会保存到 Firebase 并同步其他页面，可通过撤销恢复。','Deletion saves to Firebase and updates other pages. Undo can restore it.')}}</p></template><template #actions><button class="pw-dialog-button" @click="confirmOpen=false">{{tx('取消','Cancel')}}</button><button class="pw-dialog-button pw-danger" @click="remove">{{confirmation==='reload'?tx('放弃修改并载入','Discard edits and load'):tx('删除并保存','Delete and save')}}</button></template></Dialog>
  </section>
</template>

<style scoped>
.parts-workbook{color:#243e50;min-width:0;font-size:14px}.pw-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:0 0 18px}.pw-title{display:flex;align-items:center;gap:12px}.pw-icon{display:grid;place-items:center;width:45px;height:45px;background:#e5efef;color:#286a70;border:1px solid #c8dddd;border-radius:10px}.pw-heading h1{font-size:23px;font-weight:650;letter-spacing:-.5px;margin:0}.pw-heading p{font-size:12px;color:#71818e;margin:4px 0 0}.pw-status{display:flex;align-items:center;gap:8px;color:#277268;font-size:13px}.pw-status small{display:block;font-size:12px;color:#738591;margin-top:3px}.pw-status.failed{color:#b34d3b}.pw-toolbar{display:flex;align-items:center;gap:6px;padding:12px;background:white;border:1px solid #d6e0e7;border-radius:9px 9px 0 0;flex-wrap:wrap}.parts-workbook button{cursor:pointer}.pw-toolbar button,.pw-error button,.pw-empty button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #d6e0e7;border-radius:5px;background:white;padding:7px 9px;font-size:13px;min-height:34px;color:#395364}.parts-workbook button:disabled{opacity:.4;cursor:default}.pw-toolbar button:hover:not(:disabled){background:#edf4f5;border-color:#8fb2b9}.pw-toolbar .pw-primary{background:#246474;border-color:#246474;color:white}.pw-toolbar .pw-export{border-color:#7ba4af;color:#205a6b;margin-left:auto}.pw-export-notice{margin:0 0 10px;font-size:13px;color:#277268}.pw-toolbar .selected{background:#e7f1f3;color:#236273;border-color:#a7c7ce}.pw-toolbar-divider{width:1px;height:23px;background:#dbe4e8;margin:0 3px}.pw-search{display:flex;align-items:center;gap:8px;min-width:170px;flex:1;max-width:290px;color:#77909d}.pw-search input{border:0!important;box-shadow:none!important;width:100%;padding:7px 0;background:transparent;font-size:14px;color:#243e50}.pw-formulabar{display:flex;align-items:center;min-height:41px;border:1px solid #d6e0e7;border-top:0;background:#fff;gap:12px}.pw-address{width:75px;text-align:center;align-self:stretch;display:grid;place-items:center;border-right:1px solid #dde5e9;font:13px monospace;flex-shrink:0}.pw-fx{font:italic 17px Georgia;color:#8b9aa4}.pw-formulavalue{font-size:13px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;flex:1;min-width:0;max-height:110px;overflow:auto;padding:8px 0;color:#536b7b}.pw-external{font-size:12px;color:#9b6a23;padding:5px 10px;max-width:200px}.pw-grid-scroll{position:relative;max-height:calc(100dvh - 330px);min-height:220px;overflow:auto;border:1px solid #d6e0e7;border-top:0;background:#fff;scrollbar-color:#a9bbc4 #f0f4f7}.pw-grid{table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:14px;color:#2e4555}.pw-grid thead{position:sticky;top:0;z-index:4}.pw-grid th,.pw-grid td{border-right:1px solid #e1e7eb;border-bottom:1px solid #e1e7eb;padding:0;position:relative;font-weight:400;vertical-align:middle}.pw-grid td{height:43px;background:white}.pw-grid td>span{display:block;padding:9px 10px;max-height:76px;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}.pw-grid td.numeric>span{text-align:right;font-variant-numeric:tabular-nums}.pw-grid tbody tr:nth-child(even) td{background:#f8fafb}.pw-grid tbody tr:hover td{background:#eef5f8}.pw-grid .pw-row-selected td{background:#eaf4f6!important}.pw-grid .focused{outline:2px solid #2b8290;outline-offset:-2px;z-index:2;background:#edf7f7!important}.pw-grid [data-cell]:focus-visible{outline:2px solid #2b8290;outline-offset:-2px}.pw-grid textarea{display:block;width:100%;min-height:70px;border:0;outline:2px solid #287f8c;outline-offset:-2px;border-radius:0;padding:9px 10px;resize:vertical;box-shadow:none;color:#233f51;background:#fff;font-size:14px;line-height:1.5}.pw-grid .pw-row-number{position:sticky;left:0;z-index:3;width:48px;background:#f0f4f6!important;text-align:center;color:#738695;font-size:12px;border-right:1px solid #cddbe1}.pw-row-number label{display:flex;flex-direction:column;align-items:center;gap:3px;padding:3px 0}.pw-grid input[type=checkbox]{width:13px;height:13px;accent-color:#246474;margin:0;border-color:#adc0ca;border-radius:3px}.pw-letters th{background:#edf2f5;color:#8395a1;height:29px;text-align:center;font-size:12px}.pw-letters th:first-child{position:sticky;left:0;z-index:5}.pw-letters button{display:flex;align-items:center;justify-content:center;width:100%;gap:5px;height:28px}.pw-source-header th{background:#e8eff3;text-align:left;color:#355568}.pw-source-header th>span{display:block;padding:10px;white-space:pre-wrap;line-height:1.6;font-size:13px;font-weight:600}.pw-source-title th{background:#294f65;color:white}.pw-source-title th>span{font-size:16px;padding:12px 14px;letter-spacing:.1px}.pw-source-group th{background:#d9e8ed;color:#3e697b}.pw-source-group th>span{padding:7px 12px;font-size:12px;font-weight:550}.pw-filter-row th{background:#f7fafb;padding:5px}.pw-column-filter{display:flex;align-items:center;gap:6px;width:100%;min-height:29px;border:1px solid #cbdde3;border-radius:4px;background:white;color:#597785;font-size:12px;padding:4px 6px}.pw-column-filter span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pw-column-filter svg{flex-shrink:0}.pw-column-filter:hover,.pw-column-filter.active{background:#dcedef;border-color:#55929d;color:#195d6b}.pw-filter-hint{display:flex;gap:5px;align-items:center;color:#567a87;font-size:12px}.pw-filter-panel{display:grid;gap:14px;color:#395364;font-size:14px}.pw-filter-panel>label{display:grid;gap:6px}.pw-filter-panel>label input,.pw-filter-panel select{width:100%;padding:9px;border:1px solid #cbdde3;border-radius:5px;background:white}.pw-filter-actions{display:flex;gap:12px;align-items:center;font-size:12px}.pw-filter-actions button{color:#246474;text-decoration:underline;cursor:pointer}.pw-filter-actions span{margin-left:auto;color:#758994}.pw-filter-options{max-height:260px;overflow:auto;border:1px solid #d6e0e7;border-radius:6px}.pw-filter-options label{display:flex;align-items:center;gap:9px;padding:8px 12px;border-bottom:1px solid #edf2f5;cursor:pointer}.pw-filter-options label:hover{background:#f0f7f7}.pw-filter-options input{accent-color:#246474;flex-shrink:0}.pw-filter-options span{overflow-wrap:anywhere;min-width:0;flex:1;white-space:pre-wrap}.pw-filter-options small{color:#78909b}.pw-filter-options p{padding:20px}.pw-filter-help{font-size:12px;color:#758994;line-height:1.6}.pw-apply{background:#246474;color:white}.pw-grid td.formula:after{content:'';position:absolute;right:3px;top:3px;width:4px;height:4px;border-radius:50%;background:#91adb8;pointer-events:none}.pw-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:white;border:1px solid #d6e0e7;border-top:0;border-radius:0 0 9px 9px;padding:0 12px 0 0}.pw-sheet-tabs{display:flex;align-self:stretch}.pw-sheet-tabs button{display:flex;gap:7px;align-items:center;padding:14px 17px;border-right:1px solid #e4ebef;border-bottom:3px solid transparent;color:#718797;font-size:14px}.pw-sheet-tabs button.active{border-bottom-color:#277c88;color:#235d6d;background:#f0f7f7;font-weight:600}.pw-sheet-tabs small{font-size:12px;font-weight:400;color:#7e969f}.pw-row-count{font-size:12px;color:#6a8190;padding:10px 0}.pw-footnote{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:12px;color:#7a8e9b;margin-top:11px;line-height:1.6}.pw-error{display:flex;align-items:center;gap:12px;border:1px solid #ecc9be;background:#fff5f0;color:#a84932;padding:10px 14px;margin-bottom:12px;font-size:14px}.pw-error span{flex:1}.pw-loading,.pw-empty{padding:50px 24px;text-align:center;color:#748b98}.pw-empty{position:sticky;left:0}.pw-empty button{margin-left:14px}.pw-confirm-text{line-height:1.9;font-size:15px;color:#405b6b}.pw-dialog-button{padding:8px 14px;border:1px solid #ccd9e0;border-radius:5px;font-size:14px}.pw-danger{background:#a94938;color:white}.pw-spin{animation:pw-spin 1.5s linear infinite}@keyframes pw-spin{to{transform:rotate(360deg)}}@media(max-width:800px){.pw-heading{align-items:flex-start;gap:10px}.pw-heading h1{font-size:20px}.pw-status{font-size:12px}.pw-icon{display:none}.pw-toolbar{gap:7px}.pw-search{max-width:none;flex-basis:100%}.pw-footer{padding:0 8px 10px}.pw-grid-scroll{max-height:60dvh}.pw-external{display:none}.pw-toolbar-divider{display:none}.pw-footnote{gap:4px}.pw-toolbar button{min-height:38px}.pw-sheet-tabs button{padding:12px}.pw-status small{font-size:11px}}
/* Keep controls compact and give all remaining height to the scrolling grid. */
.parts-workbook{display:flex;flex-direction:column;flex:1;min-height:0;width:100%;overflow:hidden}
.parts-workbook>header,.pw-toolbar,.pw-formulabar,.pw-footer,.pw-footnote{flex-shrink:0}
.pw-heading{min-height:32px;gap:12px;margin:0 0 5px}
.pw-title{gap:8px;min-width:0}
.pw-title>div{display:flex;align-items:baseline;gap:12px;min-width:0}
.pw-heading h1{font-size:18px;white-space:nowrap;letter-spacing:0}
.pw-heading p{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
.pw-icon{width:28px;height:28px;border-radius:5px;flex-shrink:0}
.pw-icon svg{width:18px;height:18px}
.pw-status{font-size:12px;flex-shrink:0}
.pw-status>span{display:flex;align-items:center;gap:8px}
.pw-status small{margin:0;font-size:12px}
.pw-toolbar{padding:5px 7px;gap:5px;flex-wrap:nowrap;overflow-x:auto;border-radius:5px 5px 0 0}
.pw-toolbar>button,.pw-toolbar-divider{flex-shrink:0}
.pw-toolbar button{padding:5px 8px;min-height:30px;white-space:nowrap}
.pw-toolbar .pw-search{flex:1 0 185px;min-width:185px;max-width:300px}
.pw-search input{padding:4px 0;font-size:13px}
.pw-filter-hint{white-space:nowrap}
.pw-toolbar-divider{height:19px;margin:0 2px}
.pw-formulabar{min-height:29px;gap:8px}
.pw-address{width:65px}
.pw-formulavalue{padding:4px 0;max-height:48px}
.pw-grid-scroll{flex:1;min-height:0;max-height:none;overscroll-behavior:contain}
.pw-grid td{height:34px}
.pw-grid td>span{padding:5px 8px;line-height:1.4;max-height:56px}
.pw-letters th{height:23px}
.pw-letters button{height:22px}
.pw-source-header th>span{padding:5px 8px;line-height:1.35;max-height:60px;overflow:hidden}
.pw-source-title th>span{font-size:14px;padding:4px 10px;line-height:1.4}
.pw-source-group th>span{padding:3px 9px;line-height:1.4}
.pw-filter-row th{padding:3px 4px}
.pw-column-filter{min-height:25px;padding:2px 5px}
.pw-footer{border-radius:0 0 5px 5px;gap:4px 12px;padding-right:9px;flex-wrap:nowrap;overflow-x:auto}
.pw-sheet-tabs button{padding:1px 9px;min-height:24px;line-height:20px;border-bottom-width:2px;white-space:nowrap}
.pw-row-count{padding:1px 0;line-height:20px;white-space:nowrap}
.pw-footnote{margin-top:0;padding-bottom:0;line-height:16px;gap:0 12px;white-space:nowrap;flex-wrap:nowrap;overflow-x:auto;font-size:12px}
.pw-error{flex-shrink:0;max-height:85px;overflow:auto;margin-bottom:5px;padding:6px 10px}
.pw-export-notice{margin-bottom:4px;font-size:12px;flex-shrink:0}
@media(max-width:1200px){.pw-heading p{display:none}.pw-status small{display:none}.pw-filter-hint{display:none}}
@media(max-width:650px){.pw-heading{min-height:31px;align-items:center;gap:6px}.pw-heading h1{font-size:16px;white-space:normal;line-height:1.2}.pw-status{font-size:12px;max-width:45%}.pw-status>span{display:block}.pw-heading .pw-icon{display:none}.pw-toolbar{padding:4px}.pw-toolbar .pw-search{flex-basis:170px;min-width:170px}.pw-toolbar button{min-height:32px}.pw-grid-scroll{max-height:none}.pw-footer{padding:0 6px 0 0}.pw-sheet-tabs button{padding:6px 9px}.pw-footnote{display:none}}
.pw-grid td.has-fill,.pw-grid th.has-fill,.pw-grid .pw-row-selected td.has-fill{background:var(--pw-cell-fill)!important;color:#243e50}
.pw-current-fill{display:block;width:12px;height:12px;border:1px solid #adbdc5;border-radius:2px}
.pw-fill-palette{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;padding:4px 0 14px}
.pw-fill-palette button{display:flex;align-items:center;justify-content:center;gap:4px;min-height:45px;border:1px solid #52687830;border-radius:5px;color:#243e50;font-size:14px;cursor:pointer}
.pw-fill-palette button:hover,.pw-fill-palette button[aria-pressed=true]{outline:2px solid #287f8c;outline-offset:2px}
.pw-filter-popover{position:fixed;z-index:60;width:330px;max-width:calc(100vw - 16px);max-height:450px;display:flex;flex-direction:column;background:#fff;border:1px solid #aebfc9;border-radius:6px;box-shadow:0 5px 20px #203e4d30;color:#395364;text-align:left;overflow:hidden}
.pw-popover-heading{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #e1e7eb;flex-shrink:0}
.pw-popover-heading strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.pw-popover-heading button{display:grid;place-items:center;width:26px;height:26px;border-radius:4px;cursor:pointer}
.pw-popover-heading button:hover{background:#edf4f5}
.pw-filter-popover .pw-filter-panel{padding:10px;gap:9px;min-height:0;overflow:auto;font-size:13px}
.pw-filter-popover .pw-filter-panel>label{gap:4px}
.pw-filter-popover .pw-filter-panel>label input,.pw-filter-popover .pw-filter-panel select{padding:6px 8px;font-size:13px}
.pw-filter-popover .pw-filter-actions{gap:9px;font-size:12px;flex-wrap:wrap}
.pw-filter-popover .pw-filter-options{max-height:185px;min-height:65px}
.pw-filter-popover .pw-filter-options label{padding:5px 8px}
.pw-filter-popover .pw-filter-help{margin:0;font-size:12px}
.pw-popover-footer{display:flex;justify-content:flex-end;gap:5px;padding:8px;border-top:1px solid #e1e7eb;flex-shrink:0;background:#f7fafb;flex-wrap:wrap}
.pw-popover-footer .pw-dialog-button{padding:5px 7px;font-size:12px;min-height:29px;cursor:pointer}
.pw-popover-footer .pw-dialog-button:first-child{margin-right:auto}
.pw-resize-column,.pw-resize-row{position:absolute;display:block;z-index:8;touch-action:none;user-select:none;background:transparent}
.pw-resize-column{top:0;right:-1px;width:8px;height:100%;cursor:col-resize}
.pw-resize-row{bottom:-1px;left:0;width:100%;height:7px;cursor:row-resize}
.pw-resize-column:hover,.pw-resize-column:focus-visible{background:#2b829055;outline:1px solid #2b8290}
.pw-resize-row:hover,.pw-resize-row:focus-visible{background:#2b829055;outline:1px solid #2b8290}
.pw-resizing-columns,.pw-resizing-columns *{cursor:col-resize!important;user-select:none!important}
.pw-resizing-rows,.pw-resizing-rows *{cursor:row-resize!important;user-select:none!important}
.pw-grid tr.pw-sized-row>td,.pw-grid tr.pw-sized-row>th{height:var(--pw-row-height)}
.pw-grid tr.pw-sized-row>[data-cell]>span{height:calc(var(--pw-row-height) - 1px);max-height:calc(var(--pw-row-height) - 1px);box-sizing:border-box;overflow:hidden}
.pw-grid tr.pw-sized-row>.pw-row-number label{flex-direction:row;justify-content:center;gap:2px;padding:0 1px;height:calc(var(--pw-row-height) - 1px);overflow:hidden}
.pw-footer-meta{flex:1;min-width:0;font-size:12px;color:#7a8e9b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pw-footer{gap:6px 12px;min-height:26px}
@media(max-width:1000px){.pw-footer-meta{display:none}}
/* One compact application row above the tools. */
.pw-heading{min-height:30px;margin:0;gap:9px;padding:2px 3px;flex-wrap:nowrap}
.pw-title{margin-right:auto;flex-shrink:1}
.pw-heading h1{font-size:15px;line-height:22px;white-space:nowrap}
.pw-heading .pw-icon,.pw-heading p,.pw-status small{display:none}
.pw-status{font-size:12px;gap:5px}
.pw-toolbar{padding:2px 5px;gap:4px}
.pw-toolbar button{min-height:26px;padding:2px 7px;line-height:20px}
.pw-search input{padding:2px 0;line-height:22px}
.pw-formulabar{min-height:24px;gap:7px}
.pw-formulavalue{padding:1px 0;line-height:21px;max-height:43px}
.pw-external{padding:1px 7px}
@media(max-width:700px){.pw-heading{gap:5px}.pw-heading h1{font-size:14px}.pw-status>span{display:none}.pw-status{max-width:none}.pw-toolbar button{min-height:28px}}
</style>
