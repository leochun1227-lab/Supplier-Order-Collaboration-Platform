import { createHash } from 'node:crypto'
export const keys={po:['EBELN','EBELP'],so:['VBELN','POSNR'],deliveries:['VBELN','POSNR'],schedules:['EBELN','EBELP','ETENR'],history:['EBELN','EBELP','ZEKKN','VGABE','GJAHR','BELNR','BUZEI']}
export function buildSnapshot(input){
  if(input.schemaVersion!==1||!Number.isFinite(input.startedAt)||!Number.isFinite(input.finishedAt)||input.finishedAt<input.startedAt)throw new Error('Invalid extraction timestamps.')
  const tables={},counts={}
  for(const [table,fields] of Object.entries(keys)){
    const rows=input.tables?.[table]
    if(!Array.isArray(rows)||rows.length>50000)throw new Error(`Missing or oversized table: ${table}`)
    const records={}
    for(const row of rows){
      if(fields.some(f=>row[f]===undefined||row[f]===null||String(row[f])===''))throw new Error(`Missing SAP key in ${table}`)
      const key=fields.map(f=>String(row[f])).join('_')
      if(/[.#$\[\]/\u0000-\u001f]/.test(key)||records[key])throw new Error(`Invalid or duplicate key in ${table}`)
      records[key]=row
    }
    tables[table]=records;counts[table]=rows.length
  }
  if(!counts.po)throw new Error('Empty PO extraction requires investigation; latest snapshot unchanged.')
  const canonical=Object.fromEntries(Object.entries(tables).map(([table,rows])=>[table,Object.keys(rows).sort().map(k=>[k,rows[k]])]))
  const hash=createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return {schemaVersion:1,scope:input.scope,startedAt:input.startedAt,finishedAt:input.finishedAt,counts,tables,hash}
}
