import { PURCHASING_MAPPING_PATH,validatePurchasingMapping } from '../src/purchasing-groups.mjs'

export const PURCHASING_MAPPING_SOURCE = 'https://partssr-default-rtdb.asia-southeast1.firebasedatabase.app/app_admin/purchasing_group_mapping.json'

// Read the existing catalogue's mapping; write only our own collaboration config.
export async function syncPurchasingGroupMapping({databaseURL,fetcher=fetch}) {
  const response = await fetcher(PURCHASING_MAPPING_SOURCE,{signal:AbortSignal.timeout(20000)})
  if (!response.ok) throw new Error('purchasing_mapping_unavailable')
  const mapping = validatePurchasingMapping(await response.json())
  const url = `${databaseURL}/${PURCHASING_MAPPING_PATH}.json`
  const current = await fetcher(url,{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(20000)})
  if (!current.ok) throw new Error('purchasing_mapping_unavailable')
  const previous = await current.json()
  if (previous?.schemaVersion === 1 && previous.sourceURL === PURCHASING_MAPPING_SOURCE &&
      JSON.stringify(previous.mapping) === JSON.stringify(mapping)) return previous
  const etag = current.headers.get('etag')
  if (!etag) throw new Error('purchasing_mapping_unavailable')
  const packet = {schemaVersion:1,mapping,sourceURL:PURCHASING_MAPPING_SOURCE,syncedAt:Date.now()}
  const saved = await fetcher(url,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(packet),signal:AbortSignal.timeout(20000)})
  if (!saved.ok) throw new Error('purchasing_mapping_sync_failed')
  return packet
}
