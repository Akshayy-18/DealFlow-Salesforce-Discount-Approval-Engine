import { DurableObject } from 'cloudflare:workers';

const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' }
});
const DAILY_CAP = 250;
const ORDER_CAP = 1000;
const BODY_CAP = 32768;

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      return json({ status: 'ok', service: 'DealFlow Mock Order API' });
    }
    // Fail closed until the deployment secret has been configured.
    if (!env.MOCK_API_TOKEN) return json({ error: 'API not configured' }, 503);
    const supplied = request.headers.get('X-API-Key') || '';
    const encoder = new TextEncoder();
    const [a, b] = await Promise.all([supplied, env.MOCK_API_TOKEN].map(
      value => crypto.subtle.digest('SHA-256', encoder.encode(value))
    ));
    if (!crypto.subtle.timingSafeEqual(a, b)) return json({ error: 'Unauthorized' }, 401);
    if (path !== '/orders' || !['GET', 'POST'].includes(request.method)) {
      return json({ error: 'Not found' }, 404);
    }
    return env.ORDERS.get(env.ORDERS.idFromName('demo-orders-v1')).fetch(request);
  }
};

export class OrderStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS orders (
      key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, record TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS budget (
      id INTEGER PRIMARY KEY CHECK(id = 1), day TEXT NOT NULL, used INTEGER NOT NULL,
      orders INTEGER NOT NULL
    )`);
    this.sql.exec("INSERT OR IGNORE INTO budget VALUES (1, '', 0, 0)");
  }

  async fetch(request) {
    const day = new Date().toISOString().slice(0, 10);
    const allowed = this.ctx.storage.transactionSync(() => {
      const row = this.sql.exec('SELECT * FROM budget WHERE id = 1').one();
      const used = row.day === day ? row.used : 0;
      if (used >= DAILY_CAP) return false;
      this.sql.exec('UPDATE budget SET day = ?, used = ? WHERE id = 1', day, used + 1);
      return true;
    });
    if (!allowed) return json({ error: 'Demo daily processing cap reached' }, 429);
    if (request.method === 'GET') {
      // Bounded inspection; avoid returning every stored order on each request.
      const orders = this.sql.exec('SELECT record FROM orders ORDER BY rowid DESC LIMIT 25')
        .toArray().map(row => JSON.parse(row.record));
      return json({ orders, limit: 25 });
    }
    let raw;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'Invalid JSON' }, 400);
      const chunks = []; let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > BODY_CAP) { await reader.cancel(); return json({ error: 'Payload too large' }, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const payload = JSON.parse(raw), key = request.headers.get('Idempotency-Key');
      if (!valid(payload, key)) return json({ error: 'Invalid order contract' }, 400);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const fingerprint = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      // No await inside the transaction: a unique key and its order commit together.
      const result = this.ctx.storage.transactionSync(() => {
        const existing = this.sql.exec('SELECT * FROM orders WHERE key = ?', key).toArray()[0];
        if (existing) {
          if (existing.fingerprint !== fingerprint) return { status: 409, body: { error: 'Idempotency key was already used for a different payload' } };
          return { status: 200, body: { orderId: JSON.parse(existing.record).orderId, replayed: true } };
        }
        const count = this.sql.exec('SELECT orders FROM budget WHERE id = 1').one().orders;
        if (count >= ORDER_CAP) return { status: 507, body: { error: 'Demo storage cap reached' } };
        const order = { orderId: 'ORD-' + crypto.randomUUID().slice(0, 8).toUpperCase(), quoteId: key, payload, createdAt: new Date().toISOString() };
        this.sql.exec('INSERT INTO orders VALUES (?, ?, ?)', key, fingerprint, JSON.stringify(order));
        this.sql.exec('UPDATE budget SET orders = orders + 1 WHERE id = 1');
        return { status: 201, body: { orderId: order.orderId, replayed: false } };
      });
      return json(result.body, result.status);
    } catch (error) {
      return json({ error: error instanceof SyntaxError || error instanceof TypeError ? 'Invalid JSON' : 'Unable to persist order' }, error instanceof SyntaxError || error instanceof TypeError ? 400 : 500);
    }
  }
}

function valid(p, key) {
  if (!p || typeof key !== 'string' || !key || key.length > 100 || p.quoteId !== key || p.currency !== 'INR' || !Number.isFinite(p.net) || p.net < 0 || !Array.isArray(p.lines) || !p.lines.length || p.lines.length > 50) return false;
  if (p.lines.some(l => !l || typeof l.sku !== 'string' || !l.sku || !Number.isInteger(l.quantity) || l.quantity <= 0 || !Number.isFinite(l.unitPrice) || l.unitPrice <= 0 || !Number.isFinite(l.discount) || l.discount < 0 || l.discount > 100 || !Number.isFinite(l.net) || l.net < 0)) return false;
  return Math.abs(p.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPrice * (1 - l.discount / 100) * 100) / 100, 0) - p.net) <= .01;
}
