import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPurchasingGroupClassification, validatePurchasingMapping, PURCHASING_MAPPING_PATH } from '../src/purchasing-groups.mjs'
import { applySapSnapshotReferences } from '../src/sap-reference.mjs'
import { connectPublicWorkspace } from '../src/public-firebase-store.mjs'
import { syncPurchasingGroupMapping, PURCHASING_MAPPING_SOURCE } from '../scripts/sync-purchasing-groups.mjs'

test('SAP group mapping determines purpose even when Excel buyer disagrees; unknowns are not guessed',()=>{
  const state={orders:['E01','E03','E00','OTHER','Karen A.',''].map((group,i)=>({id:String(i),imported:true,sapPurchasingGroup:group,buyer:'Karen Andrews',type:'生产订单',sourceType:'make',importFields:{buyer:'Karen Andrews',completion:'OK'},comments:[{text:'Keep'}]}))}
  applyPurchasingGroupClassification(state,{E01:'Karen A.',E03:'Nishi A.',E00:''})
  assert.deepEqual(state.orders.map(o=>o.type),['生产订单','售后配件','用途待确认','用途待确认','生产订单','用途待确认'])
  assert.equal(state.orders[1].buyer,'Nishi A.')
  assert.equal(state.orders[1].importFields.buyer,'Karen Andrews')
  assert.equal(state.orders[1].importFields.completion,'OK');assert.equal(state.orders[1].sourceType,'make')
  assert.equal(state.orders[1].comments[0].text,'Keep')
  applyPurchasingGroupClassification(state,{E01:'Karen Andrews'})
  assert.equal(state.orders[0].type,'用途待确认','Only the specified mapped names qualify')
  assert.throws(()=>validatePurchasingMapping({E01:{name:'Karen A.'}}),/purchasing_mapping_unavailable/)
})

test('an unchanged SAP snapshot still adopts an updated group mapping on refresh',async()=>{
  const orders=[{id:'one',imported:true,po:'4500000001',item:'10',qty:1,part:'P',sapReferenceStatus:'matched',importFields:{po:'4500000001',line:'10',material:'P',qty:1,buyer:'Excel original'},comments:[],history:[]}]
  const sap={EBELN:'4500000001',EBELP:'10',MENGE:1,MATNR:'P',EKGRP:'E01'}
  let mapping={E01:'Karen A.'},state,poReads=0
  const fetcher=async url=>{
    if(url.endsWith('/source.json'))return Response.json({kind:'excel',schemaVersion:1,generation:'g',dataJson:JSON.stringify({orders,shipments:[],issues:[]}),summary:{}})
    if(url.endsWith('/purchasingGroupMapping.json'))return Response.json({schemaVersion:1,mapping})
    if(url.includes('/versions.json?')||url.endsWith('/partsWorkbook.json'))return Response.json(null)
    if(url.endsWith('/current.json'))return Response.json({run:'1800000000000-1234567890abcdef1234567890abcdef',finishedAt:1800000000000,counts:{po:1},hash:'hash'})
    if(url.endsWith('/hash.json'))return Response.json('hash')
    if(url.endsWith('/tables/po.json')){poReads++;return Response.json({one:sap})}
    throw Error(url)
  }
  const cloud=await connectPublicWorkspace(p=>{state=p.state},e=>{throw e},{databaseURL:'https://example.test',fetcher,persistSapLinks:false})
  try{
    assert.equal(state.orders[0].type,'生产订单')
    mapping={E01:'Nishi A.'};await cloud.refresh()
    assert.equal(state.orders[0].type,'售后配件');assert.equal(poReads,1)
    assert.equal(state.orders[0].importFields.buyer,'Excel original')
    applySapSnapshotReferences(state,[],1800000000001)
    applyPurchasingGroupClassification(state,mapping)
    assert.equal(state.orders[0].type,'用途待确认','Missing SAP links do not retain stale group assignments')
  }finally{await cloud.disconnect()}
})

test('mapping sync only writes the collaboration copy, uses conditional writes and rejects invalid source data',async()=>{
  const databaseURL='https://example.test',target=`${databaseURL}/${PURCHASING_MAPPING_PATH}.json`,calls=[]
  let stored=null,remote={E01:'Karen A.',E03:'Nishi A.'}
  const fetcher=async(url,options={})=>{
    calls.push({url,options})
    if(url===PURCHASING_MAPPING_SOURCE){assert.equal(options.method,undefined);return Response.json(remote)}
    assert.equal(url,target)
    if(options.method==='PUT'){assert.equal(options.headers['If-Match'],'v1');stored=JSON.parse(options.body)}
    return Response.json(stored,{headers:{etag:'v1'}})
  }
  await syncPurchasingGroupMapping({databaseURL,fetcher})
  assert.equal(stored.mapping.E03,'Nishi A.')
  await syncPurchasingGroupMapping({databaseURL,fetcher})
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,1)
  remote=null
  await assert.rejects(syncPurchasingGroupMapping({databaseURL,fetcher}),/purchasing_mapping_unavailable/)
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,1)
})
