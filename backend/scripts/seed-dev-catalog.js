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
    throw new Error(`Category slug '${category.slug}' already belongs to an unmarked record; refusing to modify it.`);
  }
  if (!row.is_active || row.deleted_at) {
    throw new Error(`Seed category '${category.slug}' is inactive or deleted; refusing to change it.`);
  }

  return row;
}

async function seedCatalog(client) {
  const inserted = { categories: [] };
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", ["myshopzy", "dev-catalog-seed"]);

  for (const category of categories) {
    await ensureCategory(client, category, inserted);
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
