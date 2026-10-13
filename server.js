require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const maxStockAmount = 9999999999.99;

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

app.get('/api/products', async (req, res, next) => {
  try {
    const [products] = await pool.execute(
      `SELECT id, name, category, unit, quantity, min_stock,
              quantity <= min_stock AS is_low_stock, created_at, updated_at
       FROM products
       ORDER BY name ASC`
    );
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.post('/api/products', async (req, res, next) => {
  const { name, category, unit } = req.body || {};
  const quantity = parseNonNegativeNumber(req.body && req.body.quantity);
  const minStock = parseNonNegativeNumber(req.body && req.body.min_stock);

  if (!isNonEmptyString(name, 160) || !isNonEmptyString(category, 100) ||
      !isNonEmptyString(unit, 40) || quantity === null || minStock === null) {
    return res.status(400).json({
      error: 'Provide a name, category, unit, and non-negative quantity and minimum stock.'
    });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO products (name, category, unit, quantity, min_stock)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), category.trim(), unit.trim(), quantity, minStock]
    );
    const [rows] = await pool.execute(
      `SELECT id, name, category, unit, quantity, min_stock,
              quantity <= min_stock AS is_low_stock, created_at, updated_at
       FROM products WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
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
      quantity === null || quantity <= 0 ||
      !['stock_in', 'stock_out'].includes(type) ||
      (notes !== undefined && notes !== null &&
        (typeof notes !== 'string' || notes.length > 500))) {
    return res.status(400).json({
      error: 'Provide a valid product_id, positive quantity, transaction type, and notes up to 500 characters.'
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [products] = await connection.execute(
      'SELECT id, quantity FROM products WHERE id = ? FOR UPDATE',
      [productId]
    );

    if (products.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Product not found.' });
    }

    const currentCents = Math.round(Number(products[0].quantity) * 100);
    const movementCents = Math.round(quantity * 100);
    const nextCents = type === 'stock_in'
      ? currentCents + movementCents
      : currentCents - movementCents;
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

    const [result] = await connection.execute(
      `INSERT INTO inventory_transactions
         (product_id, type, quantity, quantity_after, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [productId, type, quantity, nextQuantity, notes ? notes.trim() : null]
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
      quantity,
      quantity_after: nextQuantity,
      notes: notes ? notes.trim() : null
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Unable to roll back inventory transaction:', rollbackError);
      }
    }
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/reports/low-stock', async (req, res, next) => {
  try {
    const [products] = await pool.execute(
      `SELECT id, name, category, unit, quantity, min_stock,
              quantity <= min_stock AS is_low_stock
       FROM products
       WHERE quantity <= min_stock
       ORDER BY quantity ASC, name ASC`
    );
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    app.listen(port, () => {
      console.log(`Cian's Waffle & Caffe inventory app is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Unable to connect to MySQL. Check your database and .env settings.', error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, pool };
