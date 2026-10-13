# Cian's Waffle & Caffe Inventory

A responsive inventory dashboard backed by an Express REST API and MySQL. Staff can view stock, add pantry items, record stock-in/stock-out activity, and see low-stock alerts.

## Requirements

- Node.js 18 or newer
- MySQL 8.0.16 or newer

## Set up MySQL

1. Open `database/schema.sql` in MySQL Workbench and run it. It creates the `cians_waffle_inventory` database and its `users`, `products`, and `inventory_transactions` tables.
2. Copy `.env.example` to `.env` and enter your MySQL connection details.
3. Install dependencies and start the app:

   ```sh
   npm install
   npm start
   ```

4. Visit [http://localhost:3000](http://localhost:3000).

For local development with automatic server restarts, use `npm run dev`.

## API

- `GET /api/products` — list inventory, including a low-stock flag.
- `POST /api/products` — create a product. Required JSON: `{ "name": "Milk", "category": "Dairy", "unit": "liters", "quantity": 10, "min_stock": 3 }`.
- `POST /api/transactions` — record stock movement. Required JSON: `{ "product_id": 1, "type": "stock_in", "quantity": 2, "notes": "Supplier delivery" }`. `type` is `stock_in` or `stock_out`; quantity must be positive. Stock updates are performed with a database transaction and row lock, and stock-out cannot take quantity below zero.
- `GET /api/reports/low-stock` — list products at or below their minimum-stock threshold.

Product and movement quantities support up to two decimal places, with a maximum value of `9999999999.99`.

## Notes

The `users` table is ready for admin/staff accounts, and transaction rows can optionally reference a user. Authentication and account management are not included in this starter, so the dashboard currently does not identify the staff member who records a transaction. Configure database credentials only in `.env`; do not commit that file.
