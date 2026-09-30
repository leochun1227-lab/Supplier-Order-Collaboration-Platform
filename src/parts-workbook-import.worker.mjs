import { parsePartsWorkbookXlsx } from './parts-workbook-import.mjs'
self.onmessage=async({data})=>{
  try { self.postMessage(await parsePartsWorkbookXlsx(data.buffer,data.filename)) }
  catch(error) { self.postMessage({error:error.message}) }
}
