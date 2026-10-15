CREATE DATABASE IF NOT EXISTS cians_waffle_inventory;
USE cians_waffle_inventory;

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'staff') NOT NULL DEFAULT 'staff',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(160) NOT NULL,
    category VARCHAR(100) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    min_stock DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_products_name (name),
    KEY idx_products_category (category),
    CONSTRAINT chk_products_quantity_nonnegative CHECK (quantity >= 0),
    CONSTRAINT chk_products_min_stock_nonnegative CHECK (min_stock >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NULL,
    type ENUM('stock_in', 'stock_out', 'adjustment') NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    quantity_before DECIMAL(12, 2) NULL,
    quantity_after DECIMAL(12, 2) NOT NULL,
    notes VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_transactions_product_created (product_id, created_at),
    KEY idx_transactions_created (created_at),
    CONSTRAINT chk_transactions_quantity_positive CHECK (quantity > 0),
    CONSTRAINT fk_transactions_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT fk_transactions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
