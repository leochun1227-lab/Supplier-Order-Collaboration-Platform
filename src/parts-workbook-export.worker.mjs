import { buildPartsWorkbookXlsx } from './parts-workbook-export.mjs'
self.onmessage=async({data})=>{
  try {
    const [templateResponse,baselineResponse]=await Promise.all([fetch('/parts-workbook-template.xlsx'),fetch('/parts-workbook.json')])
    if(!templateResponse.ok||!baselineResponse.ok)throw new Error('export_template_unavailable')
    const [buffer,baseline]=await Promise.all([templateResponse.arrayBuffer(),baselineResponse.json()])
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('')
    if(hash!==baseline.sourceHash)throw new Error('export_template_mismatch')
    const result=buildPartsWorkbookXlsx(data.book,new Uint8Array(buffer),baseline)
    self.postMessage({buffer:result.buffer},[result.buffer])
  }catch(error){self.postMessage({error:error.message})}
}
