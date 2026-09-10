import assert from 'node:assert/strict'
import { connectPublicWorkspace,PUBLIC_DATABASE } from '../src/public-firebase-store.mjs'
import { workspaceOrders,workspaceShipments } from '../src/reconciliation.mjs'
import { projectState,copy } from '../src/persistence.mjs'
const id=`verification-${crypto.randomUUID()}`,url=`${PUBLIC_DATABASE}/supplierCollaboration/workspaces/${id}.json`
const source={kind:'excel',schemaVersion:1,generation:id,dataJson:JSON.stringify({orders:workspaceOrders(),shipments:workspaceShipments(),issues:[]})}
const created=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})})
if(!created.ok)throw new Error(`Fixture creation HTTP ${created.status}`)
const clients=[]
try{
  let first,second,reloaded
  const errors=[]
  clients.push(await connectPublicWorkspace(p=>first=p,e=>errors.push(e),{workspace:id,interval:60000}))
  clients.push(await connectPublicWorkspace(p=>second=p,e=>errors.push(e),{workspace:id,interval:60000}))
  const modified=copy(first.state);modified.shipments[0].eta='';modified.shipments[0].courierNo='VERIFICATION-ONLY';modified.orders[0].comments=[]
  const result=await clients[0].save(modified,'verification',0,id);assert.equal(result.revision,1);assert.ok(Number.isFinite(result.at))
  const stale=copy(second.state);stale.shipments[0].courierNo='STALE-TEST'
  await assert.rejects(clients[1].save(stale,'verification-stale',0,id),/save_conflict/)
  clients.push(await connectPublicWorkspace(p=>reloaded=p,e=>errors.push(e),{workspace:id,interval:60000}))
  assert.equal(reloaded.revision,1);assert.equal(reloaded.state.shipments[0].eta,'');assert.equal(reloaded.state.shipments[0].courierNo,'VERIFICATION-ONLY');assert.deepEqual(reloaded.state.orders[0].comments,[])
  assert.equal(errors.length,0)
  console.log('PASS: write acknowledgement, reload, cleared fields, conflict rejection; real orders unchanged.')
}finally{
  await Promise.all(clients.map(c=>c.disconnect()))
  const check=await (await fetch(`${PUBLIC_DATABASE}/supplierCollaboration/workspaces/${id}/source/generation.json`)).json()
  if(check===id){const removed=await fetch(url,{method:'DELETE'});if(!removed.ok)throw new Error('Verification cleanup failed');console.log('Temporary verification workspace removed.')}
}
