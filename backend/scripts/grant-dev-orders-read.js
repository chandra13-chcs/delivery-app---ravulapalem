"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const TARGET_DATABASE = "delivery_app_test";
const TARGET_SCHEMA = "public";
const ROLE_CODE = "DEV-REPORTS-READER";
const ROLE_NAME = "Development Reports Reader";
const ROLE_DESCRIPTION = "[DEV-ONLY] Read admin order and sales reports.";
const PERMISSION_CODE = "orders:read";
const PERMISSION_DESCRIPTION = "Read admin orders and sales reports.";

function parseArguments(args) {
  const options = { employeeCode: "", confirmedTarget: "", execute: false };
  for (const argument of args) {
    if (argument === "--execute") options.execute = true;
    else if (argument.startsWith("--employee-code=")) options.employeeCode = argument.slice("--employee-code=".length).trim();
    else if (argument.startsWith("--confirm-target=")) options.confirmedTarget = argument.slice("--confirm-target=".length);
    else throw new Error("Unknown argument.");
  }
  if (process.env.DB_NAME !== TARGET_DATABASE) {
    throw new Error(`Set DB_NAME=${TARGET_DATABASE} in this process; the script refuses any other database.`);
  }
  if (!["test", "development"].includes(String(process.env.NODE_ENV || "").toLowerCase())) {
    throw new Error("Set NODE_ENV to test or development in this process; .env is not changed by this script.");
  }
  if (options.confirmedTarget !== TARGET_DATABASE) {
    throw new Error(`Pass --confirm-target=${TARGET_DATABASE} to confirm the fixed database target.`);
  }
  if (!/^[A-Z0-9-]{3,64}$/.test(options.employeeCode)) {
    throw new Error("Provide an exact --employee-code for the existing admin to receive the dedicated reports role.");
  }
  if (!options.execute) throw new Error("Pass --execute to grant the dedicated development reports role.");
  return options;
}

async function ensurePermission(client) {
  const inserted = await client.query(
    `INSERT INTO permissions (code, description)
     VALUES ($1, $2)
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [PERMISSION_CODE, PERMISSION_DESCRIPTION]
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };

  const existing = await client.query("SELECT id FROM permissions WHERE code = $1", [PERMISSION_CODE]);
  if (!existing.rows[0]) throw new Error("Could not safely resolve the orders permission.");
  return { id: existing.rows[0].id, created: false };
}

async function provision(client, employeeCode) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", ["myshopzy-dev-orders-read", TARGET_DATABASE]);

  const adminResult = await client.query(
    `SELECT u.id
     FROM admin_users au
     JOIN users u ON u.id = au.user_id
     WHERE au.employee_code = $1
       AND au.status = 'ACTIVE'
       AND u.status = 'ACTIVE'
       AND u.deleted_at IS NULL`,
    [employeeCode]
  );
  if (adminResult.rowCount !== 1) throw new Error("The exact employee code must identify one active development admin.");
  const userId = adminResult.rows[0].id;

  let permissionResult = await client.query("SELECT id FROM permissions WHERE code = $1", [PERMISSION_CODE]);
  const permission = await ensurePermission(client);
  if (permissionResult.rows[0] && permission.id !== permissionResult.rows[0].id) {
    throw new Error("The orders permission changed during provisioning; refusing to continue.");
  }

  const roleInsert = await client.query(
    `INSERT INTO roles (code, display_name, description, is_system)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [ROLE_CODE, ROLE_NAME, ROLE_DESCRIPTION]
  );
  const roleResult = await client.query("SELECT id, display_name, description, is_system FROM roles WHERE code = $1 FOR UPDATE", [ROLE_CODE]);
  const role = roleResult.rows[0];
  if (!role || role.display_name !== ROLE_NAME || role.description !== ROLE_DESCRIPTION || role.is_system) {
    throw new Error("The dedicated development role code conflicts with an unmarked role; refusing to modify it.");
  }

  const assignedElsewhere = await client.query(
    "SELECT user_id FROM user_roles WHERE role_id = $1 AND user_id <> $2 LIMIT 1",
    [role.id, userId]
  );
  if (assignedElsewhere.rowCount) throw new Error("The dedicated development role is assigned to another user; refusing changes.");

  const existingGrants = await client.query("SELECT permission_id FROM role_permissions WHERE role_id = $1", [role.id]);
  if (existingGrants.rows.some(row => row.permission_id !== permission.id)) {
    throw new Error("The dedicated reports role has unexpected permissions; refusing to change its grants.");
  }
  const rolePermission = await client.query(
    "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING RETURNING role_id",
    [role.id, permission.id]
  );
  const userRole = await client.query(
    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING RETURNING user_id",
    [userId, role.id]
  );

  return {
    database: TARGET_DATABASE,
    schema: TARGET_SCHEMA,
    employee_code: employeeCode,
    permission: PERMISSION_CODE,
    role: ROLE_CODE,
    changes: {
      permissions: permission.created ? 1 : 0,
      roles: roleInsert.rowCount,
      role_permissions: rolePermission.rowCount,
      user_roles: userRole.rowCount
    }
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
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
    const identity = await client.query("SELECT current_database() AS database, current_schema() AS schema");
    if (identity.rows[0]?.database !== TARGET_DATABASE || identity.rows[0]?.schema !== TARGET_SCHEMA) {
      throw new Error("Connected database/schema did not match the fixed test target.");
    }
    await client.query("BEGIN");
    const result = await provision(client, options.employeeCode);
    await client.query("COMMIT");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Development reports role provisioning failed:", error.message);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}

main();