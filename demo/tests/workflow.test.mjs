import {test} from 'node:test';import assert from 'node:assert/strict';
import {QuoteWorkflow,priceLines} from '../workflow.mjs';
const input=(discount=3)=>({customer:'Synthetic Customer',lines:[{sku:'DF-START',quantity:10,discount}]});
test('server-style pricing ignores supplied prices and calculates weighted discount',()=>{
  const totals=priceLines([{sku:'DF-START',quantity:2,discount:5,price:1},{sku:'DF-SUPPORT',quantity:1,discount:20}]);
  assert.equal(totals.gross,30000);assert.equal(totals.net,27600);assert.equal(totals.discount,8);
  assert.throws(()=>priceLines([{sku:'DF-START',quantity:1.5,discount:2}]));
});
test('approved quote cannot be resubmitted; revisions require fresh approval',()=>{
  const workflow=new QuoteWorkflow();const first=workflow.create(input());workflow.submit(first.id);
  assert.throws(()=>workflow.submit(first.id),/Draft/);
  const second=workflow.create({...input(12),previousId:first.id});assert.equal(second.version,2);assert.equal(second.status,'Draft');
  workflow.submit(second.id);assert.equal(second.status,'Pending');assert.equal(first.status,'Approved');assert.equal(first.discount,3);
  workflow.decide(second.id,'Approved','Manager');assert.equal(workflow.dispatches.length,2);
});
test('repeated revisions from the same source get unique increasing versions',()=>{
  const workflow=new QuoteWorkflow();const first=workflow.create(input());workflow.submit(first.id);
  assert.equal(workflow.create({...input(),previousId:first.id}).version,2);assert.equal(workflow.create({...input(),previousId:first.id}).version,3);
});
test('timeout after external commit followed by retry creates only one order',()=>{
  const workflow=new QuoteWorkflow();const quote=workflow.create(input());workflow.submit(quote.id);
  workflow.deliver(quote.id,'after-commit');assert.equal(workflow.externalOrders.size,1);assert.equal(workflow.dispatches[0].status,'Retryable');
  workflow.retry(quote.id,'Operations');assert.equal(workflow.externalOrders.size,1);assert.equal(workflow.dispatches[0].status,'Succeeded');
  workflow.stage(quote);assert.equal(workflow.dispatches.length,1);assert.equal(workflow.deliver(quote.id).attempts,2);
});
test('role checks and rejection prevent unauthorized orders',()=>{
  const workflow=new QuoteWorkflow();assert.throws(()=>workflow.create(input(),'Manager'),/Sales Rep/);
  const quote=workflow.create(input(12));workflow.submit(quote.id);assert.throws(()=>workflow.decide(quote.id,'Approved','Operations'),/assigned/);
  workflow.decide(quote.id,'Rejected','Manager');assert.equal(workflow.dispatches.length,0);
});
test('retries stop after five attempts',()=>{
  const workflow=new QuoteWorkflow();const quote=workflow.create(input());workflow.submit(quote.id);workflow.deliver(quote.id,'before-commit');
  assert.throws(()=>workflow.retry(quote.id,'Sales'),/Operations/);
  for(let i=1;i<5;i++)workflow.retry(quote.id,'Operations','before-commit');
  assert.equal(workflow.dispatches[0].status,'Needs Attention');assert.equal(workflow.externalOrders.size,0);assert.throws(()=>workflow.retry(quote.id,'Operations'));
});
