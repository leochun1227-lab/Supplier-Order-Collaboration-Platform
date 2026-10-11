<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: String,
  labels: { type: Array, required: true },
  series: { type: Array, required: true },
  totals: { type: Array, required: true },
  selectable: { type: Array, default: () => [] },
  formatValue: { type: Function, default: value => String(value) },
  emptyLabel: String,
  missingLabel: String,
})
const emit = defineEmits(['select'])
const known = value => typeof value === 'number' && Number.isFinite(value)
const values = computed(() => props.series.flatMap(series => series.values).filter(known))
const step = computed(() => {
  const raw = Math.max(1, ...values.value) / 3
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  return Math.max(1, [1, 2, 5, 10].find(n => n * magnitude >= raw) * magnitude)
})
const ceiling = computed(() => step.value * 3)
const ticks = computed(() => Array.from({ length: 4 }, (_, i) => (3 - i) * step.value))
const x = index => (index + .5) / props.labels.length * 100
const y = value => 100 - value / ceiling.value * 100
const lines = computed(() => props.series.map(series => {
  let connected = false
  const points = []
  const path = props.labels.map((_, index) => {
    const value = series.values[index]
    if (!known(value)) { connected = false; return '' }
    points.push({ index, value, x: x(index), y: y(value) })
    const command = `${connected ? 'L' : 'M'} ${x(index)} ${y(value)}`
    connected = true
    return command
  }).join(' ')
  return { ...series, path, points }
}))
const axisLabel = value => new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const valueLabel = value => known(value) ? props.formatValue(value) : '—'
function description(index) {
  return `${props.labels[index]} · ${props.series.map(series => `${series.name}: ${known(series.values[index]) ? props.formatValue(series.values[index]) : props.missingLabel}`).join(' · ')}`
}
</script>

<template>
  <div class="trend-chart" role="group" :aria-label="title">
    <div class="trend-plot">
      <div v-for="(tick, index) in ticks" :key="index" class="trend-gridline" :style="{top:index / 3 * 100 + '%'}" aria-hidden="true"><span>{{values.length ? axisLabel(tick) : '—'}}</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path v-for="series in lines" :key="series.name" :d="series.path" :stroke="series.color" :stroke-dasharray="series.dash" fill="none" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <template v-for="series in lines" :key="series.name">
        <span v-for="point in series.points" :key="point.index" class="trend-point" :style="{left:point.x+'%',top:point.y+'%',borderColor:series.color}" :title="description(point.index)" aria-hidden="true"></span>
      </template>
      <div v-if="!values.length" class="trend-empty">{{emptyLabel}}</div>
    </div>
    <div class="trend-periods" :style="{gridTemplateColumns:`repeat(${labels.length},minmax(0,1fr))`}">
      <component :is="selectable[index] ? 'button' : 'div'" v-for="(period,index) in labels" :key="period" class="trend-period" :type="selectable[index] ? 'button' : undefined" :aria-label="description(index)" :title="description(index)" @click="selectable[index] && emit('select',index)">
        <strong>{{valueLabel(totals[index])}}</strong><small>{{period}}</small>
      </component>
    </div>
  </div>
</template>

<style scoped>
.trend-chart{display:flex;flex-direction:column;flex:1;min-height:135px;padding:12px 12px 7px 42px}
.trend-plot{position:relative;flex:1;min-height:58px;margin:6px 0 8px}
.trend-plot>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.trend-gridline{position:absolute;left:0;right:0;border-top:1px dashed #e3ebf0}
.trend-gridline>span{position:absolute;right:calc(100% + 8px);top:0;transform:translateY(-50%);font-size:10px;color:#748795;font-variant-numeric:tabular-nums}
.trend-gridline:nth-child(4){border-top-style:solid}
.trend-point{position:absolute;width:8px;height:8px;transform:translate(-50%,-50%);border:2px solid;border-radius:50%;background:white}
.trend-point:hover{width:11px;height:11px}
.trend-empty{position:absolute;inset:0;display:grid;place-items:center;color:#8a9da9;font-size:12px;pointer-events:none}
.trend-periods{display:grid;gap:0}
.trend-period{min-width:0;text-align:center;padding:3px 1px;border-radius:4px;line-height:1.5}
button.trend-period:hover{background:#edf5fa}
.trend-period>strong{display:block;font-size:12px;color:#31566b;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.trend-period>small{display:block;font-size:10px;white-space:nowrap}
@media(min-width:1100px){.trend-chart{min-height:120px}.trend-plot{min-height:36px}}
</style>
