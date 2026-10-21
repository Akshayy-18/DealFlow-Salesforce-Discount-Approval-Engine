import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOrderServer} from './server.mjs';
const payload={quoteId:'quote-version-1',version:1,currency:'INR',net:90,lines:[{sku:'DF-START',quantity:1,unitPrice:100,discount:10,net:90}]};
async function fixture(run){const directory=await mkdtemp(path.join(tmpdir(),'dealflow-'));const server=await createOrderServer({directory,token:'test-token'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;const post=(body=payload,headers={})=>fetch(url+'/orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':body.quoteId,'X-API-Key':'test-token',...headers},body:JSON.stringify(body)});try{await run({post,url,directory});}finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}}
test('repeated and concurrent requests create one order',()=>fixture(async({post,url})=>{
  const responses=await Promise.all(Array.from({length:8},()=>post()));
  const results=await Promise.all(responses.map(response=>response.json()));
  assert.equal(responses.filter(response=>response.status===201).length,1);assert.equal(new Set(results.map(result=>result.orderId)).size,1);
  const orders=await(await fetch(url+'/orders',{headers:{'X-API-Key':'test-token'}})).json();assert.equal(orders.orders.length,1);
}));
test('lost response after commit is recovered using the same key',()=>fixture(async({post})=>{
  assert.equal((await post(payload,{'X-Demo-Failure':'after-commit'})).status,503);
  const retry=await post();assert.equal(retry.status,200);assert.equal((await retry.json()).replayed,true);
}));
test('changed payload on an existing key is rejected',()=>fixture(async({post})=>{
  await post();assert.equal((await post({...payload,version:2})).status,409);
}));
test('new quote versions create distinct orders',()=>fixture(async({post})=>{
  const first=await(await post()).json();const second=await(await post({...payload,quoteId:'quote-version-2',version:2})).json();assert.notEqual(first.orderId,second.orderId);
}));
test('outage before commit can be retried',()=>fixture(async({post})=>{
  assert.equal((await post(payload,{'X-Demo-Failure':'before-commit'})).status,503);assert.equal((await post()).status,201);
}));
test('auth and total validation',()=>fixture(async({post})=>{
  assert.equal((await post(payload,{'X-API-Key':'wrong'})).status,401);assert.equal((await post({...payload,net:12})).status,400);
}));
test('idempotency history survives process restart',()=>fixture(async({post,directory})=>{
  const first=await(await post()).json();const secondServer=await createOrderServer({directory,token:'test-token'});await new Promise(resolve=>secondServer.listen(0,'127.0.0.1',resolve));
  try{const response=await fetch(`http://127.0.0.1:${secondServer.address().port}/orders`,{method:'POST',headers:{'Idempotency-Key':payload.quoteId,'X-API-Key':'test-token'},body:JSON.stringify(payload)});assert.equal(response.status,200);assert.equal((await response.json()).orderId,first.orderId);}finally{await new Promise(resolve=>secondServer.close(resolve));}
}));
