import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, evaluate, calculate, submitRequest, decideRequest } from '../policy.mjs';

for (const [value, route] of [[0,'Auto'],[5,'Auto'],[5.01,'Manager'],[15,'Manager'],[15.01,'Director'],[25,'Director'],[25.01,'Block'],[100,'Block']]) {
  test(`boundary ${value}% → ${route}`, () => assert.equal(evaluate(value).route, route));
}
test('invalid discounts fail closed', () => {
  for (const value of [-1,101,null,undefined,'5',NaN,Infinity]) assert.throws(() => evaluate(value));
});
test('overlap, missing policy, and invalid configuration fail closed', () => {
  assert.throws(() => evaluate(7, []), /No active/);
  assert.throws(() => evaluate(7, [{min:0,max:10,route:'Auto',active:true},{min:5,max:20,route:'Manager',active:true}]), /Overlapping/);
  assert.throws(() => evaluate(7, [{min:0,max:10,route:'Oops',active:true}]), /Invalid/);
  assert.throws(() => evaluate(7, [{min:20,max:10,route:'Auto',active:true}]), /Invalid/);
});
test('inactive rules cannot authorize a request', () => {
  assert.throws(() => evaluate(3, defaultRules.map(rule => ({...rule,active:false}))));
});
test('configuration changes take effect without changing the evaluator', () => {
  const rules = defaultRules.map(rule => ({...rule})); rules[0].max=8; rules[1].min=8;
  assert.equal(evaluate(7,rules).route,'Auto'); assert.equal(evaluate(8.01,rules).route,'Manager');
});
test('calculates currency with two-decimal rounding', () => {
  assert.deepEqual(calculate(100000,12),{saving:12000,net:88000});
  assert.equal(calculate(99.99,5).net,94.99);
  assert.throws(() => calculate(0,5)); assert.throws(() => calculate(-1,5));
});
test('creates auto and manual requests; blocked requests are never accepted', () => {
  const input={customer:'Example',amount:10000,discount:5};
  assert.equal(submitRequest(input).status,'Approved');
  assert.equal(submitRequest({...input,discount:12}).status,'Pending');
  assert.throws(() => submitRequest({...input,discount:30}),/exceeds/);
  assert.throws(() => submitRequest({...input,customer:' '}),/customer/);
});
test('only the assigned actor can decide once', () => {
  const request=submitRequest({customer:'Example',amount:10000,discount:12});
  assert.throws(() => decideRequest(request,'Approved','Director'),/assigned/);
  const approved=decideRequest(request,'Approved','Manager','Reviewed');
  assert.equal(approved.status,'Approved'); assert.equal(approved.comment,'Reviewed');
  assert.throws(() => decideRequest(approved,'Rejected','Manager'),/pending/);
  assert.equal(decideRequest(request,'Rejected','Manager').status,'Rejected');
});
