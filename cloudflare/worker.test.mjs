import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('Worker authentication, persistent atomic replay, conflict and daily cutoff', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dealflow-worker-'));
  const options = {
    workers: [{ name: 'dealflow-test', modules: true, scriptPath: fileURLToPath(new URL('worker.mjs', import.meta.url)),
    compatibilityDate: '2026-10-28',
    bindings: { MOCK_API_TOKEN: 'local-test-key' },
    durableObjects: { ORDERS: { className: 'OrderStore', useSQLite: true } } }],
    resourcePersistencePath: directory, isolatedResourcePersistencePath: directory
  };
  let mf = new Miniflare(convertV4MiniflareOptions(options));
  const payload = { quoteId: 'worker-test-v1', version: 1, currency: 'INR', net: 90,
    lines: [{ sku: 'DF-START', quantity: 1, unitPrice: 100, discount: 10, net: 90 }] };
  const post = (p = payload) => mf.dispatchFetch('https://test/orders', {
    method: 'POST', headers: { 'X-API-Key': 'local-test-key', 'Idempotency-Key': p.quoteId }, body: JSON.stringify(p)
  });
  try {
    assert.equal((await mf.dispatchFetch('https://test/health')).status, 200);
    assert.equal((await mf.dispatchFetch('https://test/orders')).status, 401);
    const replies = await Promise.all(Array.from({ length: 8 }, () => post()));
    assert.equal(replies.filter(r => r.status === 201).length, 1);
    const bodies = await Promise.all(replies.map(r => r.json()));
    assert.equal(new Set(bodies.map(b => b.orderId)).size, 1);
    assert.equal((await post({ ...payload, version: 2 })).status, 409);
    assert.equal((await post({ ...payload, net: 3 })).status, 400);
    await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
    const replay = await post(); assert.equal(replay.status, 200);
    assert.equal((await replay.json()).orderId, bodies[0].orderId);
    // 8 initial calls + conflict + invalid + replay = 11 of the daily 250.
    for (let i = 11; i < 250; i++) assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 429);
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});



