"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const TARGET_DATABASE = "delivery_app_test";
const TARGET_SCHEMA = "public";
const DEV_ADMIN_EMPLOYEE_CODE = "DEV-CATEGORY-ADMIN";
const DELIVERY_ROLE_CODE = "DEV-DELIVERY-ADMIN";
const DELIVERY_ROLE_NAME = "Development Delivery Admin";
const DELIVERY_ROLE_DESCRIPTION = "[DEV-ONLY] Delivery management role provisioned by the guarded local development script.";
const DELIVERY_PERMISSION_CODE = "deliveries:manage";
const DELIVERY_PERMISSION_DESCRIPTION = "Manage rider delivery assignments and delivery tracking in development.";

function parseArguments(args) {
  const options = { confirmedTarget: "", execute: false, revoke: false };
  for (const argument of args) {
    if (argument === "--execute") options.execute = true;
    else if (argument === "--revoke") options.revoke = true;
    else if (argument.startsWith("--confirm-target=")) options.confirmedTarget = argument.slice("--confirm-target=".length);
    else throw new Error("Unknown argument.");
  }
  if (process.env.DB_NAME !== TARGET_DATABASE) throw new Error(`DB_NAME must be ${TARGET_DATABASE}; other databases are refused.`);
  if (!["test", "development"].includes(String(process.env.NODE_ENV || "").toLowerCase())) {
    throw new Error("NODE_ENV must be test or development; other environments are refused.");
  }
  if (options.confirmedTarget !== TARGET_DATABASE) throw new Error(`Pass --confirm-target=${TARGET_DATABASE}.`);
  if (!options.execute) throw new Error("Pass --execute to confirm this test-only RBAC operation.");
  return options;
}

async function getMarkedDevAdmin(client, lock = false) {
  const result = await client.query(
    `SELECT u.id, u.status AS user_status, u.deleted_at, au.status AS admin_status
     FROM admin_users au
     JOIN users u ON u.id = au.user_id
     WHERE au.employee_code = $1
     ${lock ? "FOR UPDATE OF au, u" : ""}`,
    [DEV_ADMIN_EMPLOYEE_CODE]
  );
  if (result.rows.length !== 1) throw new Error("Expected exactly one marked development admin; refusing to change RBAC.");
  const admin = result.rows[0];
  if (admin.user_status !== "ACTIVE" || admin.deleted_at || admin.admin_status !== "ACTIVE") {
    throw new Error("The marked development admin is not active; refusing to change RBAC.");
  }
  return admin;
}

async function ensurePermission(client) {
  const inserted = await client.query(
    `INSERT INTO permissions (code, description)
     VALUES ($1, $2)
     ON CONFLICT (code) DO NOTHING
    RETURNING id, description`,
    [DELIVERY_PERMISSION_CODE, DELIVERY_PERMISSION_DESCRIPTION]
  );
  const result = inserted.rows[0]
    ? inserted
    : await client.query("SELECT id, description FROM permissions WHERE code = $1", [DELIVERY_PERMISSION_CODE]);
  const permission = result.rows[0];
  if (!permission || permission.description !== DELIVERY_PERMISSION_DESCRIPTION) {
    throw new Error("The delivery permission code exists with an unexpected description; refusing to reuse it.");
  }
  return { ...permission, created: inserted.rowCount === 1 };
}

async function ensureRole(client) {
  const inserted = await client.query(
    `INSERT INTO roles (code, display_name, description, is_system)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (code) DO NOTHING
     RETURNING id, display_name, description, is_system`,
    [DELIVERY_ROLE_CODE, DELIVERY_ROLE_NAME, DELIVERY_ROLE_DESCRIPTION]
  );
  const result = inserted.rows[0]
    ? inserted
    : await client.query(
      "SELECT id, display_name, description, is_system FROM roles WHERE code = $1",
      [DELIVERY_ROLE_CODE]
    );
  const role = result.rows[0];
  if (!role || role.display_name !== DELIVERY_ROLE_NAME
      || role.description !== DELIVERY_ROLE_DESCRIPTION || role.is_system) {
    throw new Error("The delivery role code exists with unexpected metadata; refusing to reuse it.");
  }
  return { ...role, created: inserted.rowCount === 1 };
}

async function provision(client) {
  const admin = await getMarkedDevAdmin(client, true);
  const permission = await ensurePermission(client);
  const role = await ensureRole(client);
  const otherRoleUsers = await client.query(
    `SELECT user_id FROM user_roles
     WHERE role_id = $1 AND user_id <> $2
     LIMIT 1`,
    [role.id, admin.id]
  );
  if (otherRoleUsers.rows.length) {
    throw new Error("The development delivery role is assigned to another user; refusing to grant delivery access.");
  }
  const otherRolePermissions = await client.query(
    `SELECT p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1 AND rp.permission_id <> $2
     LIMIT 1`,
    [role.id, permission.id]
  );
  if (otherRolePermissions.rows.length) {
    throw new Error("The development delivery role has unexpected permissions; refusing to change its grants.");
  }
  const userRole = await client.query(
    `INSERT INTO user_roles (user_id, role_id, granted_by_user_id)
     VALUES ($1, $2, $1)
     ON CONFLICT (user_id, role_id) DO NOTHING
     RETURNING user_id`,
    [admin.id, role.id]
  );
  const rolePermission = await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     VALUES ($1, $2)
     ON CONFLICT (role_id, permission_id) DO NOTHING
     RETURNING role_id`,
    [role.id, permission.id]
  );
  return {
    action: "provisioned",
    role: DELIVERY_ROLE_CODE,
    permission: DELIVERY_PERMISSION_CODE,
    inserted: {
      role: role.created ? 1 : 0,
      permission: permission.created ? 1 : 0,
      user_role: userRole.rowCount,
      role_permission: rolePermission.rowCount
    }
  };
}

async function revoke(client) {
  const admin = await getMarkedDevAdmin(client, true);
  const roleResult = await client.query("SELECT id, display_name, description, is_system FROM roles WHERE code = $1 FOR UPDATE", [DELIVERY_ROLE_CODE]);
  const role = roleResult.rows[0];
  if (!role) return { action: "already-revoked", role: DELIVERY_ROLE_CODE, permission: DELIVERY_PERMISSION_CODE };
  if (role.display_name !== DELIVERY_ROLE_NAME || role.description !== DELIVERY_ROLE_DESCRIPTION || role.is_system) {
    throw new Error("The delivery role metadata does not match the development marker; refusing cleanup.");
  }
  const permissionResult = await client.query("SELECT id, description FROM permissions WHERE code = $1 FOR UPDATE", [DELIVERY_PERMISSION_CODE]);
  const permission = permissionResult.rows[0];
  if (!permission || permission.description !== DELIVERY_PERMISSION_DESCRIPTION) {
    throw new Error("The delivery permission metadata does not match the development marker; refusing cleanup.");
  }
  const otherUsers = await client.query("SELECT user_id FROM user_roles WHERE role_id = $1 AND user_id <> $2 LIMIT 1", [role.id, admin.id]);
  const otherPermissions = await client.query("SELECT permission_id FROM role_permissions WHERE role_id = $1 AND permission_id <> $2 LIMIT 1", [role.id, permission.id]);
  if (otherUsers.rows.length || otherPermissions.rows.length) {
    throw new Error("The development role has additional assignments or permissions; refusing cleanup.");
  }
  await client.query("DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2", [admin.id, role.id]);
  await client.query("DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2", [role.id, permission.id]);
  await client.query("DELETE FROM roles WHERE id = $1", [role.id]);
  const permissionUse = await client.query("SELECT role_id FROM role_permissions WHERE permission_id = $1 LIMIT 1", [permission.id]);
  if (!permissionUse.rows.length) await client.query("DELETE FROM permissions WHERE id = $1", [permission.id]);
  return { action: "revoked", role: DELIVERY_ROLE_CODE, permission: DELIVERY_PERMISSION_CODE };
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
    const target = await client.query("SELECT current_database() AS database, current_schema() AS schema");
    if (target.rows[0]?.database !== TARGET_DATABASE || target.rows[0]?.schema !== TARGET_SCHEMA) {
      throw new Error("Connected database/schema did not match the fixed development target.");
    }
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", ["myshopzy-dev-delivery-rbac", TARGET_DATABASE]);
      const result = options.revoke ? await revoke(client) : await provision(client);
      await client.query("COMMIT");
      console.log(JSON.stringify({ database: TARGET_DATABASE, ...result }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(`Development delivery RBAC provisioning stopped: ${error.message}`);
  process.exitCode = 1;
});