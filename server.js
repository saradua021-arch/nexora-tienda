require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const FREE_SHIPPING = Number(process.env.FREE_SHIPPING) || 1000000;
const SHIPPING = Number(process.env.SHIPPING) || 15000;
const isProd = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  }
}));
app.use(express.json({ limit: '50kb' }));

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' } });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos.' } });

/* ---------- utilidades ---------- */
const newCode = prefix => `${prefix}-${crypto.randomInt(100000, 999999)}`;
const emailOk = s => /^\S+@\S+\.\S+$/.test(s) && s.length <= 120;

// Valida [{id, qty}] y agrupa repetidos. Devuelve [[id, qty], ...] o null.
function cleanItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 30) return null;
  const m = new Map();
  for (const it of items) {
    const id = Number(it && it.id), qty = Number(it && it.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 100) return null;
    m.set(id, (m.get(id) || 0) + qty);
  }
  return [...m];
}

/* ---------- API pública ---------- */
app.get('/api/products', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, category, price, old_price, stock, image_url FROM products WHERE active ORDER BY id'
  );
  res.json(rows);
}));

// Pedido: el precio SIEMPRE se calcula aquí con los datos de la base, nunca con lo que envía el navegador.
// Importante: nunca se reciben ni se guardan datos de tarjeta (la pasarela es una simulación visual).
app.post('/api/orders', publicLimiter, wrap(async (req, res) => {
  const { customer = {}, items } = req.body || {};
  const name = String(customer.name || '').trim();
  const email = String(customer.email || '').trim();
  const list = cleanItems(items);
  if (name.length < 3 || name.length > 100 || !emailOk(email) || !list) {
    throw new HttpError(400, 'Datos del pedido inválidos.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, name, price, stock FROM products WHERE id = ANY($1) AND active FOR UPDATE',
      [list.map(([id]) => id)]
    );
    const byId = new Map(rows.map(r => [r.id, r]));
    let subtotal = 0;
    for (const [id, qty] of list) {
      const p = byId.get(id);
      if (!p) throw new HttpError(400, 'Uno de los productos ya no está disponible.');
      if (p.stock < qty) throw new HttpError(409, `Stock insuficiente para ${p.name}.`);
      subtotal += p.price * qty;
    }
    const shipping = subtotal >= FREE_SHIPPING ? 0 : SHIPPING;
    const total = subtotal + shipping;
    const code = newCode('NX');

    const o = await client.query(
      `INSERT INTO orders (code, customer_name, customer_email, subtotal, shipping, total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [code, name, email, subtotal, shipping, total]
    );
    for (const [id, qty] of list) {
      const p = byId.get(id);
      await client.query(
        'INSERT INTO order_items (order_id, product_id, name, unit_price, qty) VALUES ($1,$2,$3,$4,$5)',
        [o.rows[0].id, id, p.name, p.price, qty]
      );
      await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2', [qty, id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ code, subtotal, shipping, total });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

app.post('/api/quotes', publicLimiter, wrap(async (req, res) => {
  const { name: rawName, email: rawEmail, items } = req.body || {};
  const name = String(rawName || '').trim();
  const email = String(rawEmail || '').trim();
  const list = cleanItems(items);
  if (name.length < 2 || name.length > 100 || !emailOk(email) || !list) {
    throw new HttpError(400, 'Datos de la cotización inválidos.');
  }

  const { rows } = await pool.query(
    'SELECT id, name, price FROM products WHERE id = ANY($1) AND active',
    [list.map(([id]) => id)]
  );
  const byId = new Map(rows.map(r => [r.id, r]));
  let subtotal = 0, units = 0;
  for (const [id, qty] of list) {
    const p = byId.get(id);
    if (!p) throw new HttpError(400, 'Uno de los productos ya no está disponible.');
    subtotal += p.price * qty;
    units += qty;
  }
  const discountPct = units > 10 ? 10 : units > 5 ? 6 : units > 2 ? 3 : 0;
  const total = subtotal - Math.round(subtotal * discountPct / 100);
  const code = newCode('COT');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(
      `INSERT INTO quotes (code, name, email, subtotal, discount_pct, total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [code, name, email, subtotal, discountPct, total]
    );
    for (const [id, qty] of list) {
      const p = byId.get(id);
      await client.query(
        'INSERT INTO quote_items (quote_id, product_id, name, unit_price, qty) VALUES ($1,$2,$3,$4,$5)',
        [q.rows[0].id, id, p.name, p.price, qty]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  res.status(201).json({ code, subtotal, discountPct, total });
}));

const REASONS = ['Asesoría de compra', 'Cotización empresarial', 'Soporte y garantía', 'Otro'];
app.post('/api/contact', publicLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim(), phone = String(b.phone || '').trim();
  const email = String(b.email || '').trim(), message = String(b.message || '').trim();
  const reason = REASONS.includes(b.reason) ? b.reason : 'Otro';
  if (name.length < 3 || name.length > 100 || phone.replace(/\D/g, '').length < 7 || phone.length > 30 ||
      !emailOk(email) || message.length < 5 || message.length > 1000) {
    throw new HttpError(400, 'Revisa los datos del formulario.');
  }
  await pool.query(
    'INSERT INTO contacts (name, phone, email, reason, message) VALUES ($1,$2,$3,$4,$5)',
    [name, phone, email, reason, message]
  );
  res.status(201).json({ ok: true });
}));

/* ---------- API de administración (cabecera x-admin-token) ---------- */
function adminAuth(req, res, next) {
  const given = Buffer.from(req.get('x-admin-token') || '');
  const real = Buffer.from(process.env.ADMIN_TOKEN || '');
  if (!real.length || given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    return res.status(401).json({ error: 'Clave de administrador incorrecta.' });
  }
  next();
}
app.use('/api/admin', adminLimiter, adminAuth);

function parseProduct(b = {}) {
  const text = (v, min, max) => { v = String(v ?? '').trim(); return v.length >= min && v.length <= max ? v : null; };
  const int = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 2000000000 ? n : null; };
  const name = text(b.name, 2, 120), category = text(b.category, 2, 40);
  const price = int(b.price), stock = int(b.stock);
  const hasOld = b.old_price !== '' && b.old_price != null;
  const old_price = hasOld ? int(b.old_price) : null;
  const image = String(b.image_url || '').trim();
  const badImage = image && !/^(\/|img\/|https:\/\/)\S{1,290}$/.test(image);
  if (name === null || category === null || price === null || stock === null || (hasOld && old_price === null) || badImage) {
    throw new HttpError(400, 'Revisa los datos del producto (nombre, categoría, precio, stock e imagen).');
  }
  return { name, category, price, old_price, stock, image_url: image || null, active: b.active !== false };
}

app.get('/api/admin/products', wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM products ORDER BY id')).rows);
}));

app.post('/api/admin/products', wrap(async (req, res) => {
  const p = parseProduct(req.body);
  const { rows } = await pool.query(
    `INSERT INTO products (name, category, price, old_price, stock, image_url, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [p.name, p.category, p.price, p.old_price, p.stock, p.image_url, p.active]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/admin/products/:id', wrap(async (req, res) => {
  const p = parseProduct(req.body);
  const { rows } = await pool.query(
    `UPDATE products SET name=$1, category=$2, price=$3, old_price=$4, stock=$5, image_url=$6, active=$7, updated_at=now()
     WHERE id=$8 RETURNING *`,
    [p.name, p.category, p.price, p.old_price, p.stock, p.image_url, p.active, Number(req.params.id)]
  );
  if (!rows.length) throw new HttpError(404, 'Producto no encontrado.');
  res.json(rows[0]);
}));

// No se borra de verdad: se desactiva para conservar el historial de pedidos.
app.delete('/api/admin/products/:id', wrap(async (req, res) => {
  const r = await pool.query('UPDATE products SET active=false, updated_at=now() WHERE id=$1', [Number(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Producto no encontrado.');
  res.json({ ok: true });
}));

const listWithItems = (table, itemTable, fk) => `
  SELECT t.*, COALESCE(json_agg(json_build_object('name', i.name, 'qty', i.qty, 'unit_price', i.unit_price)
         ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
  FROM ${table} t LEFT JOIN ${itemTable} i ON i.${fk} = t.id
  GROUP BY t.id ORDER BY t.id DESC LIMIT 200`;

app.get('/api/admin/orders', wrap(async (req, res) => {
  res.json((await pool.query(listWithItems('orders', 'order_items', 'order_id'))).rows);
}));
app.get('/api/admin/quotes', wrap(async (req, res) => {
  res.json((await pool.query(listWithItems('quotes', 'quote_items', 'quote_id'))).rows);
}));

const statusRoute = (table, allowed) => wrap(async (req, res) => {
  const status = req.body && req.body.status;
  if (!allowed.includes(status)) throw new HttpError(400, 'Estado no válido.');
  const r = await pool.query(`UPDATE ${table} SET status=$1 WHERE id=$2`, [status, Number(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'No encontrado.');
  res.json({ ok: true });
});
app.get('/api/admin/contacts', wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM contacts ORDER BY id DESC LIMIT 200')).rows);
}));
app.patch('/api/admin/contacts/:id', statusRoute('contacts', ['nuevo', 'contactado', 'resuelto', 'descartado']));
app.patch('/api/admin/orders/:id', statusRoute('orders', ['pagado_simulado', 'enviado', 'entregado', 'cancelado']));
app.patch('/api/admin/quotes/:id', statusRoute('quotes', ['nueva', 'contactado', 'cerrada', 'descartada']));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

/* ---------- sitio estático ---------- */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => console.log(`NEXORA lista en http://localhost:${PORT}`));
