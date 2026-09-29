"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const TARGET_DATABASE = "delivery_app_test";
const ROLE_CODE = "DEV-CONTENT-ADMIN";
const ROLE_NAME = "Development Content Admin";
const ROLE_DESCRIPTION = "[DEV-ONLY] Manage homepage banners and daily offers.";
const PERMISSIONS = [
  ["banners:manage", "Manage PostgreSQL homepage banners."],
  ["offers:manage", "Manage the PostgreSQL daily offer popup."]
];

function readOptions(args) {
  const options = { employeeCode: "", confirmedTarget: "", execute: false };
  for (const arg of args) {
    if (arg === "--execute") options.execute = true;
    else if (arg.startsWith("--employee-code=")) options.employeeCode = arg.slice(16).trim();
    else if (arg.startsWith("--confirm-target=")) options.confirmedTarget = arg.slice(17);
    else throw new Error("Unknown argument.");
  }
  if (process.env.DB_NAME !== TARGET_DATABASE) throw new Error(`Set DB_NAME=${TARGET_DATABASE}; other databases are refused.`);
  if (!["test", "development"].includes(String(process.env.NODE_ENV || "").toLowerCase())) {
    throw new Error("Set NODE_ENV to test or development; .env is not changed.");
  }
  if (options.confirmedTarget !== TARGET_DATABASE) throw new Error(`Pass --confirm-target=${TARGET_DATABASE}.`);
  if (!/^[A-Z0-9-]{3,64}$/.test(options.employeeCode)) throw new Error("Provide an exact active admin employee code.");
  if (!options.execute) throw new Error("Pass --execute to provision the isolated development permissions.");
  return options;
}

async function provision(client, employeeCode) {
  const identity = await client.query("SELECT current_database() AS database, current_schema() AS schema");
  if (identity.rows[0]?.database !== TARGET_DATABASE || identity.rows[0]?.schema !== "public") {
    throw new Error("Connected database/schema does not match the fixed test target.");
  }
  const admin = await client.query(
    `SELECT u.id FROM admin_users au JOIN users u ON u.id = au.user_id
     WHERE au.employee_code = $1 AND au.status = 'ACTIVE'
       AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`,
    [employeeCode]
  );
  if (admin.rowCount !== 1) throw new Error("Employee code must identify one active admin.");

  const roleInsert = await client.query(
    `INSERT INTO roles (code, display_name, description, is_system)
     VALUES ($1, $2, $3, false) ON CONFLICT (code) DO NOTHING RETURNING id`,
    [ROLE_CODE, ROLE_NAME, ROLE_DESCRIPTION]
  );
  const roleResult = await client.query("SELECT id, display_name, description, is_system FROM roles WHERE code = $1 FOR UPDATE", [ROLE_CODE]);
  const role = roleResult.rows[0];
  if (!role || role.display_name !== ROLE_NAME || role.description !== ROLE_DESCRIPTION || role.is_system) {
    throw new Error("Development content role conflicts with an unmarked role; refusing changes.");
  }
  const otherUsers = await client.query("SELECT user_id FROM user_roles WHERE role_id = $1 AND user_id <> $2 LIMIT 1", [role.id, admin.rows[0].id]);
  if (otherUsers.rowCount) throw new Error("Dedicated development content role is assigned to another user.");
  const currentGrants = await client.query("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1", [role.id]);
  if (currentGrants.rows.some(row => !PERMISSIONS.some(([code]) => code === row.code))) {
    throw new Error("Dedicated content role has unexpected permissions; refusing changes.");
  }

  const changes = { roles: roleInsert.rowCount, permissions: 0, role_permissions: 0, user_roles: 0 };
  for (const [code, description] of PERMISSIONS) {
    const permission = await client.query(
      `INSERT INTO permissions (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
      [code, description]
    );
    changes.permissions += permission.rowCount;
    const resolved = permission.rows[0] || (await client.query("SELECT id FROM permissions WHERE code = $1", [code])).rows[0];
    if (!resolved) throw new Error(`Unable to resolve ${code}.`);
    const grant = await client.query(
      "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING role_id",
      [role.id, resolved.id]
    );
    changes.role_permissions += grant.rowCount;
  }
  const assignment = await client.query(
    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id",
    [admin.rows[0].id, role.id]
  );
  changes.user_roles = assignment.rowCount;
  return { database: TARGET_DATABASE, employee_code: employeeCode, role: ROLE_CODE, permissions: PERMISSIONS.map(([code]) => code), changes };
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: TARGET_DATABASE,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT)
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await provision(client, options.employeeCode);
    await client.query("COMMIT");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Development content permission provisioning failed:", error.message);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}

main();