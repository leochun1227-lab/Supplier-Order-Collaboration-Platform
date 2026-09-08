import { ref, watch } from 'vue'
import { translate } from './translations.mjs'
const key='regent-ui-language'
function initialLanguage(){try{return globalThis.localStorage?.getItem(key)==='en'?'en':'zh'}catch{return 'zh'}}
export const language=ref(initialLanguage())
export const t=value=>translate(value,language.value)
watch(language,value=>{
  try{globalThis.localStorage?.setItem(key,value)}catch{/* Language switching also works when storage is unavailable. */}
  if(typeof document!=='undefined'){
    document.documentElement.lang=value==='en'?'en':'zh-CN'
    document.title=value==='en'?'Regent | Supplier Collaboration':'Regent | 供应商协作平台'
  }
},{immediate:true,flush:'sync'})
export function setLanguage(value){if(value==='zh'||value==='en')language.value=value}
export function dateLabel(value){
  if(!value)return t('待确认')
  return language.value==='en'?new Intl.DateTimeFormat('en-AU',{day:'2-digit',month:'short',timeZone:'UTC'}).format(new Date(value)):value.slice(5).replace('-','/')
}
