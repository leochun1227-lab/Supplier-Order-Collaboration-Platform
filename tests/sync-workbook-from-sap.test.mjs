import test from 'node:test'
import assert from 'node:assert/strict'
import { syncWorkbookFromSap } from '../scripts/sync-workbook-from-sap.mjs'

function fixture({snapshotError=false,conflict=false,run='run1'}={}) {
  const calls=[];let connections=0,closed=0
  const connect=async(onChange,onError)=>{
    connections++
    if(conflict&&connections===1)onError(new Error('save_conflict'))
    onChange({state:{orders:[{sapReferenceRefreshError:snapshotError}]},summary:{workbookRevision:2,masterRecords:3,masterCompletion:{NG:1,OK:1,SAP:1}}})
    return {disconnect:async()=>{closed++}}
  }
  const fetcher=async(url,options={})=>{
    calls.push({url,options})
    if(url.endsWith('/partsWorkbook.json'))return Response.json({schemaVersion:1,revision:2,bookJson:JSON.stringify({sheets:[{id:'s0'}],sapRefreshRun:'run1'})},{headers:{etag:'v2'}})
    if(url.endsWith('/sap/current.json'))return Response.json({run})
    if(url.endsWith('/sync/workbookLastCheck.json')&&options.method==='PUT')return Response.json(JSON.parse(options.body))
    throw new Error('Unexpected network request')
  }
  return {connect,fetcher,calls,prepareMapping:async()=>{},get closed(){return closed},get connections(){return connections}}
}

test('headless refresh verifies Firebase readback and records status without accessing SAP or Git',async()=>{
  const f=fixture(),result=await syncWorkbookFromSap({...f,databaseURL:'https://example.test'})
  assert.equal(result.status,'complete');assert.equal(result.workbookRevision,2)
  assert.equal(result.completion.SAP,1);assert.equal(result.completion.NG,1)
  assert.equal(f.closed,1)
  assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,1)
  assert.ok(f.calls.every(c=>c.url.startsWith('https://example.test/supplierCollaboration/')))
})

test('headless refresh retries conditional conflicts but never reports failed SAP reads as success',async()=>{
  const f=fixture({conflict:true})
  await syncWorkbookFromSap({...f,databaseURL:'https://example.test'})
  assert.equal(f.connections,2);assert.equal(f.closed,2)
  const failed=fixture({snapshotError:true})
  await assert.rejects(syncWorkbookFromSap({...failed,databaseURL:'https://example.test'}),/sap_snapshot_unavailable/)
  assert.equal(failed.closed,1);assert.equal(failed.calls.length,0)
})

test('a newer snapshot during verification is not marked complete until the workbook catches up',async()=>{
  const f=fixture({run:'newer-run'})
  await assert.rejects(syncWorkbookFromSap({...f,databaseURL:'https://example.test'}),/save_conflict/)
  assert.equal(f.connections,3);assert.equal(f.closed,3)
  assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,0)
})
