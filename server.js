require('dotenv').config();

const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const maxStockAmount = 9999999999.99;
const sessionCookie = 'inventory_session';
const sessionDurationSeconds = 60 * 60 * 12;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const scrypt = promisify(crypto.scrypt);
const dummyPasswordHash = `${'00'.repeat(16)}:${'00'.repeat(64)}`;

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set. Active sessions will expire when the server restarts.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cians_waffle_inventory',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function parseNonNegativeNumber(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '')) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxStockAmount) return null;
  const cents = Math.round(parsed * 100);
  return Math.abs(parsed * 100 - cents) < 0.0000001 ? cents / 100 : null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return scrypt(password, salt, 64).then((hash) => `${salt}:${hash.toString('hex')}`);
}

async function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash).split(':');
  if (!salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + sessionDurationSeconds
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSessionToken(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`));
  return cookie ? decodeURIComponent(cookie.slice(sessionCookie.length + 1)) : '';
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationSeconds}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
  }
  next();
}

async function authenticate(req, res, next) {
  try {
    const token = readSessionToken(req);
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }

    const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return res.status(401).json({ error: 'Your session is invalid. Please sign in again.' });
    }

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(session.userId) || session.expiresAt <= Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }

    const [users] = await pool.execute(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [session.userId]
    );
    if (users.length === 0) return res.status(401).json({ error: 'Your account is no longer available.' });
    req.user = users[0];
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access is required for this action.' });
  }
  next();
}

function productSelect() {
  return `SELECT id, name, category, unit, quantity, min_stock,
                 quantity <= min_stock AS is_low_stock, is_active, created_at, updated_at
          FROM products`;
}

app.post('/api/auth/login', requireSameOrigin, async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!isNonEmptyString(email, 190) || typeof password !== 'string' || password.length > 200) {
    return res.status(400).json({ error: 'Enter your email address and password.' });
  }

  try {
    const [users] = await pool.execute(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );
    const user = users[0];
    const passwordMatches = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, dummyPasswordHash);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: 'The email or password is incorrect.' });
    }
    setSessionCookie(res, createSessionToken(user.id));
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireSameOrigin, (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.use('/api', requireSameOrigin, authenticate);

app.get('/api/auth/me', (req, res) => {
  res.json(req.user);
});

app.get('/api/products', async (req, res, next) => {
  try {
    const showInactive = req.user.role === 'admin' && req.query.include_inactive === 'true';
    const where = showInactive ? '' : ' WHERE is_active = 1';
    const [products] = await pool.execute(`${productSelect()}${where} ORDER BY name ASC`);
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.post('/api/products', requireAdmin, async (req, res, next) => {
  const { name, category, unit } = req.body || {};
  const quantity = parseNonNegativeNumber(req.body && req.body.quantity);
  const minStock = parseNonNegativeNumber(req.body && req.body.min_stock);

  if (!isNonEmptyString(name, 160) || !isNonEmptyString(category, 100) ||
      !isNonEmptyString(unit, 40) || quantity === null || minStock === null) {
    return res.status(400).json({
      error: 'Provide a name, category, unit, and non-negative quantity and minimum stock.'
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO products (name, category, unit, quantity, min_stock)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), category.trim(), unit.trim(), quantity, minStock]
    );
    if (quantity > 0) {
      await connection.execute(
        `INSERT INTO inventory_transactions
           (product_id, user_id, type, quantity, quantity_before, quantity_after, notes)
         VALUES (?, ?, 'stock_in', ?, 0, ?, 'Initial stock')`,
        [result.insertId, req.user.id, quantity, quantity]
      );
    }
    const [rows] = await connection.execute(
      `${productSelect()} WHERE id = ?`,
      [result.insertId]
    );
    await connection.commit();
    res.status(201).json(rows[0]);
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (rollbackError) {
        console.error('Unable to roll back product creation:', rollbackError);
      }
    }
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.patch('/api/products/:id', requireAdmin, async (req, res, next) => {
  const productId = Number(req.params.id);
  const { name, category, unit } = req.body || {};
  const minStock = parseNonNegativeNumber(req.body && req.body.min_stock);
  const isActive = req.body && req.body.is_active;
  const edits = {};

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: 'Provide a valid product id.' });
  }
  if (Object.hasOwn(req.body || {}, 'name')) {
    if (!isNonEmptyString(name, 160)) return res.status(400).json({ error: 'Provide a valid item name.' });
    edits.name = name.trim();
  }
  if (Object.hasOwn(req.body || {}, 'category')) {
    if (!isNonEmptyString(category, 100)) return res.status(400).json({ error: 'Provide a valid category.' });
    edits.category = category.trim();
  }
  if (Object.hasOwn(req.body || {}, 'unit')) {
    if (!isNonEmptyString(unit, 40)) return res.status(400).json({ error: 'Provide a valid unit.' });
    edits.unit = unit.trim();
  }
  if (Object.hasOwn(req.body || {}, 'min_stock')) {
    if (minStock === null) return res.status(400).json({ error: 'Minimum stock must be a valid non-negative quantity.' });
    edits.min_stock = minStock;
  }
  if (Object.hasOwn(req.body || {}, 'is_active')) {
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false.' });
    edits.is_active = isActive ? 1 : 0;
  }
  if (!Object.keys(edits).length) return res.status(400).json({ error: 'Provide at least one field to update.' });

  try {
    const fields = Object.keys(edits);
    const [result] = await pool.execute(
      `UPDATE products SET ${fields.map((field) => `\`${field}\` = ?`).join(', ')} WHERE id = ?`,
      [...fields.map((field) => edits[field]), productId]
    );
    if (result.affectedRows === 0) {
      const [rows] = await pool.execute('SELECT id FROM products WHERE id = ?', [productId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    }
    const [rows] = await pool.execute(`${productSelect()} WHERE id = ?`, [productId]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/transactions', async (req, res, next) => {
  const rawProductId = req.body && req.body.product_id;
  const productId = Number(rawProductId);
  const quantity = parseNonNegativeNumber(req.body && req.body.quantity);
  const { type } = req.body || {};
  const notes = req.body && req.body.notes;

  if ((typeof rawProductId !== 'number' && typeof rawProductId !== 'string') ||
      (typeof rawProductId === 'string' && rawProductId.trim() === '') ||
      !Number.isSafeInteger(productId) || productId <= 0 ||
      !['stock_in', 'stock_out', 'adjustment'].includes(type) ||
      quantity === null || (type !== 'adjustment' && quantity <= 0) ||
      (notes !== undefined && notes !== null &&
        (typeof notes !== 'string' || notes.length > 500))) {
    return res.status(400).json({
      error: 'Provide a valid product_id, quantity, transaction type, and notes up to 500 characters. Stock-in and stock-out quantities must be positive.'
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [products] = await connection.execute(
      'SELECT id, quantity, is_active FROM products WHERE id = ? FOR UPDATE',
      [productId]
    );
    if (products.length === 0 || !products[0].is_active) {
      await connection.rollback();
      return res.status(404).json({ error: 'Active product not found.' });
    }

    const currentCents = Math.round(Number(products[0].quantity) * 100);
    const inputCents = Math.round(quantity * 100);
    const nextCents = type === 'adjustment'
      ? inputCents
      : type === 'stock_in' ? currentCents + inputCents : currentCents - inputCents;
    const currentQuantity = currentCents / 100;
    const nextQuantity = nextCents / 100;
    if (nextCents < 0) {
      await connection.rollback();
      return res.status(409).json({
        error: `Not enough stock. Only ${currentQuantity} ${currentQuantity === 1 ? 'unit is' : 'units are'} available.`
      });
    }
    if (nextQuantity > maxStockAmount) {
      await connection.rollback();
      return res.status(400).json({ error: 'The resulting stock exceeds the maximum supported quantity.' });
    }
    const movement = type === 'adjustment' ? Math.abs(nextCents - currentCents) / 100 : quantity;
    if (movement <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'The counted quantity matches the current stock; no adjustment is needed.' });
    }

    const [result] = await connection.execute(
      `INSERT INTO inventory_transactions
         (product_id, user_id, type, quantity, quantity_before, quantity_after, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, req.user.id, type, movement, currentQuantity, nextQuantity, notes ? notes.trim() : null]
    );
    await connection.execute(
      'UPDATE products SET quantity = ? WHERE id = ?',
      [nextQuantity, productId]
    );
    await connection.commit();
    res.status(201).json({
      id: result.insertId,
      product_id: productId,
      type,
      quantity: movement,
      quantity_after: nextQuantity,
      notes: notes ? notes.trim() : null
    });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (rollbackError) {
        console.error('Unable to roll back inventory transaction:', rollbackError);
      }
    }
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/history', async (req, res, next) => {
  const requestedLimit = Number(req.query.limit || 200);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200;
  const requestedOffset = Number(req.query.offset || 0);
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  try {
    const [transactions] = await pool.execute(
      `SELECT t.id, t.product_id, p.name AS product_name, p.unit, t.user_id,
              u.name AS user_name, t.type, t.quantity, t.quantity_before,
              t.quantity_after, t.notes, t.created_at
       FROM inventory_transactions t
       JOIN products p ON p.id = t.product_id
       LEFT JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

app.get('/api/reports/low-stock', requireAdmin, async (req, res, next) => {
  try {
    const [products] = await pool.execute(
      `SELECT id, name, category, unit, quantity, min_stock,
              quantity <= min_stock AS is_low_stock
       FROM products
       WHERE is_active = 1 AND quantity <= min_stock
       ORDER BY quantity ASC, name ASC`
    );
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.get('/api/reports/summary', requireAdmin, async (req, res, next) => {
  try {
    const [[summary]] = await pool.execute(
      `SELECT COUNT(*) AS total_products,
              SUM(is_active = 1 AND quantity <= min_stock) AS low_stock_products,
              SUM(is_active = 1) AS active_products,
              SUM(is_active = 0) AS inactive_products
       FROM products`
    );
    const [[movements]] = await pool.execute(
      `SELECT COUNT(*) AS transaction_count,
              SUM(type = 'stock_in') AS stock_in_count,
              SUM(type = 'stock_out') AS stock_out_count,
              SUM(type = 'adjustment') AS adjustment_count
       FROM inventory_transactions`
    );
    res.json({ ...summary, ...movements });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users', requireAdmin, async (req, res, next) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, name, email, role, created_at FROM users ORDER BY name ASC'
    );
    res.json(users);
  } catch (error) {
    next(error);
  }
});

app.post('/api/users', requireAdmin, async (req, res, next) => {
  const { name, email, password, role } = req.body || {};
  if (!isNonEmptyString(name, 120) || !isNonEmptyString(email, 190) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 12 || password.length > 200 ||
      !['admin', 'staff'].includes(role)) {
    return res.status(400).json({
      error: 'Provide a name, valid email, password of at least 12 characters, and administrator or staff role.'
    });
  }
  try {
    const passwordHash = await hashPassword(password);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), passwordHash, role]
    );
    const [users] = await pool.execute(
      'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(users[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with that email already exists.' });
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function ensureSchemaCompatibility() {
  const [productColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'is_active'`
  );
  if (productColumns.length === 0) {
    await pool.query('ALTER TABLE products ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER min_stock');
  }

  const [transactionColumns] = await pool.execute(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_transactions' AND COLUMN_NAME = 'type'`
  );
  if (transactionColumns.length && !transactionColumns[0].COLUMN_TYPE.includes('adjustment')) {
    await pool.query(
      `ALTER TABLE inventory_transactions
       MODIFY type ENUM('stock_in', 'stock_out', 'adjustment') NOT NULL`
    );
  }

  const [quantityBeforeColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_transactions'
       AND COLUMN_NAME = 'quantity_before'`
  );
  if (quantityBeforeColumns.length === 0) {
    await pool.query(
      'ALTER TABLE inventory_transactions ADD COLUMN quantity_before DECIMAL(12, 2) NULL AFTER quantity'
    );
  }
}

async function seedInitialAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!isNonEmptyString(email, 190) || typeof password !== 'string' || password.length < 12) {
    throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD; the password must be at least 12 characters.');
  }

  const [admins] = await pool.execute('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin']);
  if (admins.length) return;
  const passwordHash = await hashPassword(password);
  await pool.execute(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    ['Owner', email.trim().toLowerCase(), passwordHash, 'admin']
  );
  console.log(`Created the initial administrator account for ${email.trim().toLowerCase()}.`);
}

async function start() {
  try {
    await pool.query('SELECT 1');
    await ensureSchemaCompatibility();
    await seedInitialAdmin();
    app.listen(port, () => {
      console.log(`Cian's Waffle & Caffe inventory app is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Unable to initialize the inventory app. Check your database and .env settings.', error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, pool, start };
