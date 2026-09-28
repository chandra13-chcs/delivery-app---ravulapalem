"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const seedMarker = "[DEV-SEED]";
const categories = [
  { slug: "groceries", name: "Fresh Groceries", sortOrder: 10 },
  { slug: "fruits-and-vegetables", name: "Fruits & Vegetables", sortOrder: 20 },
  { slug: "food-delivery", name: "Food Delivery", sortOrder: 30 },
  { slug: "meat-and-chicken", name: "Meat & Chicken", sortOrder: 40 },
  { slug: "parcel-delivery", name: "Parcel Delivery", sortOrder: 50 },
  { slug: "local-stores", name: "Local Stores", sortOrder: 60 }
];

const shops = {
  grocery: {
    legalName: `${seedMarker} MyShopzy Grocery Partner`,
    displayName: `${seedMarker} MyShopzy Grocery Partner`,
    businessType: "GROCERY",
    name: `${seedMarker} Fresh Grocery Store`
  },
  restaurant: {
    legalName: `${seedMarker} MyShopzy Restaurant Partner`,
    displayName: `${seedMarker} MyShopzy Restaurant Partner`,
    businessType: "RESTAURANT",
    name: `${seedMarker} Mandapeta Restaurant`
  },
  meat: {
    legalName: `${seedMarker} MyShopzy Meat Partner`,
    displayName: `${seedMarker} MyShopzy Meat Partner`,
    businessType: "MEAT",
    name: `${seedMarker} Meat & Chicken Store`
  },
  local: {
    legalName: `${seedMarker} MyShopzy Local Store Partner`,
    displayName: `${seedMarker} MyShopzy Local Store Partner`,
    businessType: "OTHER",
    name: `${seedMarker} General Store`
  }
};

const products = [
  { category: "groceries", shop: "grocery", name: "Milk", sku: "DEV-SEED-GROC-MILK-1L", unitLabel: "1 litre", unitQuantity: 1, price: 68 },
  { category: "groceries", shop: "grocery", name: "Bread", sku: "DEV-SEED-GROC-BREAD-400G", unitLabel: "400 g", unitQuantity: 400, price: 40 },
  { category: "groceries", shop: "grocery", name: "Eggs", sku: "DEV-SEED-GROC-EGGS-6", unitLabel: "6 pcs", unitQuantity: 6, price: 60 },
  { category: "groceries", shop: "grocery", name: "Rice", sku: "DEV-SEED-GROC-RICE-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 75 },
  { category: "groceries", shop: "grocery", name: "Cooking Oil", sku: "DEV-SEED-GROC-OIL-1L", unitLabel: "1 litre", unitQuantity: 1, price: 150 },

  { category: "fruits-and-vegetables", shop: "grocery", name: "Apples", sku: "DEV-SEED-FV-APPLES-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 180 },
  { category: "fruits-and-vegetables", shop: "grocery", name: "Bananas", sku: "DEV-SEED-FV-BANANAS-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 60 },
  { category: "fruits-and-vegetables", shop: "grocery", name: "Tomatoes", sku: "DEV-SEED-FV-TOMATOES-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 40 },
  { category: "fruits-and-vegetables", shop: "grocery", name: "Potatoes", sku: "DEV-SEED-FV-POTATOES-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 35 },
  { category: "fruits-and-vegetables", shop: "grocery", name: "Onions", sku: "DEV-SEED-FV-ONIONS-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 40 },

  { category: "food-delivery", shop: "restaurant", name: "Veg Biryani", sku: "DEV-SEED-FOOD-VEG-BIRYANI", unitLabel: "1 plate", unitQuantity: 1, price: 140 },
  { category: "food-delivery", shop: "restaurant", name: "Chicken Biryani", sku: "DEV-SEED-FOOD-CHICKEN-BIRYANI", unitLabel: "1 plate", unitQuantity: 1, price: 220 },
  { category: "food-delivery", shop: "restaurant", name: "Idly", sku: "DEV-SEED-FOOD-IDLY", unitLabel: "2 pcs", unitQuantity: 2, price: 40 },
  { category: "food-delivery", shop: "restaurant", name: "Dosa", sku: "DEV-SEED-FOOD-DOSA", unitLabel: "1 plate", unitQuantity: 1, price: 50 },
  { category: "food-delivery", shop: "restaurant", name: "Meals", sku: "DEV-SEED-FOOD-MEALS", unitLabel: "1 plate", unitQuantity: 1, price: 120 },

  { category: "meat-and-chicken", shop: "meat", name: "Chicken", sku: "DEV-SEED-MEAT-CHICKEN-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 240 },
  { category: "meat-and-chicken", shop: "meat", name: "Chicken Breast", sku: "DEV-SEED-MEAT-BREAST-500G", unitLabel: "500 g", unitQuantity: 500, price: 180 },
  { category: "meat-and-chicken", shop: "meat", name: "Mutton", sku: "DEV-SEED-MEAT-MUTTON-500G", unitLabel: "500 g", unitQuantity: 500, price: 450 },
  { category: "meat-and-chicken", shop: "meat", name: "Eggs", sku: "DEV-SEED-MEAT-EGGS-6", unitLabel: "6 pcs", unitQuantity: 6, price: 60 },

  { category: "local-stores", shop: "local", name: "Bath Soap", sku: "DEV-SEED-LOCAL-SOAP", unitLabel: "1 bar", unitQuantity: 1, price: 40 },
  { category: "local-stores", shop: "local", name: "Toothpaste", sku: "DEV-SEED-LOCAL-TOOTHPASTE-100G", unitLabel: "100 g", unitQuantity: 100, price: 75 },
  { category: "local-stores", shop: "local", name: "Laundry Detergent", sku: "DEV-SEED-LOCAL-DETERGENT-1KG", unitLabel: "1 kg", unitQuantity: 1, price: 120 },
  { category: "local-stores", shop: "local", name: "Biscuits", sku: "DEV-SEED-LOCAL-BISCUITS", unitLabel: "1 pack", unitQuantity: 1, price: 30 },
  { category: "local-stores", shop: "local", name: "Batteries", sku: "DEV-SEED-LOCAL-BATTERIES-2", unitLabel: "2 pcs", unitQuantity: 2, price: 45 }
];

function validateTarget(args) {
  const database = process.env.DB_NAME || "";
  const environment = (process.env.NODE_ENV || "").toLowerCase();
  const namedAsDevelopment = /(^|[_-])(dev|development|test)([_-]|$)/i.test(database);
  const explicitlyAllowsUnlabeledDatabase = args.includes(`--allow-unlabeled-dev-db=${database}`);

  if (!database) throw new Error("DB_NAME is required.");
  if (!["development", "test"].includes(environment)) {
    throw new Error("Refusing to seed: set NODE_ENV to development or test for the intended database.");
  }
  if (!namedAsDevelopment && !explicitlyAllowsUnlabeledDatabase) {
    throw new Error(`Refusing to seed database '${database}': its name is not marked dev/test. Use --allow-unlabeled-dev-db=${database} only after confirming it is a development/test database.`);
  }
  if (!args.includes(`--confirm-db=${database}`)) {
    throw new Error(`Refusing to seed: pass --confirm-db=${database} to confirm the target database.`);
  }
  if (!args.includes("--dry-run") && !args.includes("--execute")) {
    throw new Error("Choose --dry-run or --execute explicitly.");
  }
  if (args.includes("--dry-run") && args.includes("--execute")) {
    throw new Error("Choose either --dry-run or --execute, not both.");
  }

  return { database, dryRun: args.includes("--dry-run") };
}

async function ensureCategory(client, category, inserted) {
  const description = `${seedMarker} Development catalog category for flow testing.`;
  const result = await client.query(
    `INSERT INTO categories (name, slug, description, sort_order, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id, name, slug, description, is_active, deleted_at`,
    [category.name, category.slug, description, category.sortOrder]
  );
  let row = result.rows[0];

  if (!row) {
    const existing = await client.query(
      "SELECT id, name, slug, description, is_active, deleted_at FROM categories WHERE slug = $1",
      [category.slug]
    );
    row = existing.rows[0];
  } else {
    inserted.categories.push({ id: row.id, name: row.name, slug: row.slug });
  }

  if (!row || !row.description?.startsWith(seedMarker)) {
    throw new Error(`Category slug '${category.slug}' already belongs to an unmarked record; refusing to attach seed products.`);
  }
  if (!row.is_active || row.deleted_at) {
    throw new Error(`Seed category '${category.slug}' is inactive or deleted; refusing to change it.`);
  }

  return row;
}

async function ensurePartner(client, shop, inserted) {
  const existing = await client.query(
    `SELECT id, business_type, status, deleted_at
     FROM partners
     WHERE legal_name = $1 AND display_name = $2`,
    [shop.legalName, shop.displayName]
  );

  if (existing.rows.length > 1) throw new Error(`Multiple development partners match '${shop.displayName}'.`);
  if (existing.rows[0]) {
    const partner = existing.rows[0];
    if (partner.business_type !== shop.businessType || partner.status !== "ACTIVE" || partner.deleted_at) {
      throw new Error(`Existing development partner '${shop.displayName}' is not active or has a different type.`);
    }
    return partner.id;
  }

  const result = await client.query(
    `INSERT INTO partners (legal_name, display_name, business_type, status)
     VALUES ($1, $2, $3, 'ACTIVE')
     RETURNING id, display_name`,
    [shop.legalName, shop.displayName, shop.businessType]
  );
  inserted.partners.push(result.rows[0]);
  return result.rows[0].id;
}

async function ensureShop(client, partnerId, shop, inserted) {
  const existing = await client.query(
    `SELECT id, partner_id, status, deleted_at
     FROM shops
     WHERE name = $1`,
    [shop.name]
  );

  if (existing.rows.length > 1) throw new Error(`Multiple development shops match '${shop.name}'.`);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.partner_id !== partnerId || row.status !== "ACTIVE" || row.deleted_at) {
      throw new Error(`Existing development shop '${shop.name}' is not active or has a different partner.`);
    }
    return row.id;
  }

  const result = await client.query(
    `INSERT INTO shops (
       partner_id, name, description, address_line1, locality, city, state, postal_code, country_code, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'IN', 'ACTIVE')
     RETURNING id, name`,
    [partnerId, shop.name, `${seedMarker} Development shop for catalog testing.`, "Development Test Address", "Mandapeta", "Mandapeta", "Andhra Pradesh", "533308"]
  );
  inserted.shops.push(result.rows[0]);
  return result.rows[0].id;
}

async function ensureProduct(client, categoryId, shopId, product, inserted) {
  const description = `${seedMarker} Sample catalog item for category and cart flow testing.`;
  const existing = await client.query(
    `SELECT id, description, status, deleted_at
     FROM products
     WHERE category_id = $1 AND shop_id = $2 AND name = $3`,
    [categoryId, shopId, product.name]
  );

  if (existing.rows.length > 1) throw new Error(`Multiple products match '${product.name}' in the development shop.`);
  let productId;

  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (!row.description?.startsWith(seedMarker)) {
      throw new Error(`Product '${product.name}' already exists without the development marker; refusing to modify or duplicate it.`);
    }
    if (row.status !== "ACTIVE" || row.deleted_at) {
      throw new Error(`Seed product '${product.name}' is inactive or deleted; refusing to change it.`);
    }
    productId = row.id;
  } else {
    const result = await client.query(
      `INSERT INTO products (shop_id, category_id, name, description, brand, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
       RETURNING id, name`,
      [shopId, categoryId, product.name, description, `${seedMarker} MyShopzy`]
    );
    productId = result.rows[0].id;
    inserted.products.push({ id: productId, name: result.rows[0].name, category: product.category });
  }

  const variants = await client.query(
    `SELECT id, product_id, unit_label, unit_quantity, price, is_active, deleted_at
     FROM product_variants
     WHERE sku = $1`,
    [product.sku]
  );
  if (variants.rows.length > 1) throw new Error(`SKU '${product.sku}' is not unique.`);
  if (variants.rows[0]) {
    const variant = variants.rows[0];
    if (variant.product_id !== productId || variant.unit_label !== product.unitLabel || Number(variant.unit_quantity) !== product.unitQuantity || Number(variant.price) !== product.price || !variant.is_active || variant.deleted_at) {
      throw new Error(`SKU '${product.sku}' conflicts with a different or inactive variant; refusing to modify it.`);
    }
    return;
  }

  const result = await client.query(
    `INSERT INTO product_variants (
       product_id, sku, name, unit_label, unit_quantity, price, is_default, is_active
     )
     VALUES ($1, $2, 'Standard', $3, $4, $5, true, true)
     ON CONFLICT (sku) WHERE sku IS NOT NULL DO NOTHING
     RETURNING id, sku`,
    [productId, product.sku, product.unitLabel, product.unitQuantity, product.price]
  );
  if (result.rows[0]) {
    inserted.variants.push(result.rows[0]);
    return;
  }

  const conflict = await client.query(
    `SELECT id, product_id, unit_label, unit_quantity, price, is_active, deleted_at
     FROM product_variants
     WHERE sku = $1`,
    [product.sku]
  );
  const variant = conflict.rows[0];
  if (!variant || variant.product_id !== productId || variant.unit_label !== product.unitLabel || Number(variant.unit_quantity) !== product.unitQuantity || Number(variant.price) !== product.price || !variant.is_active || variant.deleted_at) {
    throw new Error(`SKU '${product.sku}' was claimed by a conflicting record; refusing to modify it.`);
  }
}

async function seedCatalog(client) {
  const inserted = { categories: [], partners: [], shops: [], products: [], variants: [] };
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", ["myshopzy", "dev-catalog-seed"]);

  const categoriesBySlug = new Map();
  for (const category of categories) {
    categoriesBySlug.set(category.slug, await ensureCategory(client, category, inserted));
  }

  const shopsByKey = {};
  for (const [key, shop] of Object.entries(shops)) {
    const partnerId = await ensurePartner(client, shop, inserted);
    shopsByKey[key] = await ensureShop(client, partnerId, shop, inserted);
  }

  for (const product of products) {
    const category = categoriesBySlug.get(product.category);
    const shopId = shopsByKey[product.shop];
    await ensureProduct(client, category.id, shopId, product, inserted);
  }

  return inserted;
}

async function main() {
  const { database, dryRun } = validateTarget(process.argv.slice(2));
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT)
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const inserted = await seedCatalog(client);
    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
    console.log(JSON.stringify({ database, dryRun, inserted }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(`Development catalog seed stopped: ${error.message}`);
  process.exitCode = 1;
});
