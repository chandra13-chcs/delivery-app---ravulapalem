"use strict";

const path = require("path");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const TARGET_DATABASE = "delivery_app_test";
const TARGET_SCHEMA = "public";
const ADMIN_EMPLOYEE_CODE = "DEV-CATEGORY-ADMIN";
const ADMIN_ROLE_CODE = "DEV_CATEGORY_ADMIN";
const ADMIN_ROLE_DESCRIPTION = "[DEV-ONLY] Category management administrator provisioned by the local development script.";
const CATEGORY_PERMISSION_CODE = "categories:write";
const CATEGORY_PERMISSION_DESCRIPTION = "Manage storefront categories through the Admin API.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArguments(args) {
  const options = { email: "", displayName: "", confirmedTarget: "", execute: false };
  for (const argument of args) {
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument.startsWith("--email=")) {
      options.email = argument.slice("--email=".length).trim().toLowerCase();
    } else if (argument.startsWith("--display-name=")) {
      options.displayName = argument.slice("--display-name=".length).trim();
    } else if (argument.startsWith("--confirm-target=")) {
      options.confirmedTarget = argument.slice("--confirm-target=".length);
    } else {
      throw new Error("Unknown argument. Passwords are accepted only through the hidden terminal prompt.");
    }
  }

  if (process.env.DB_NAME !== TARGET_DATABASE) {
    throw new Error(`Set DB_NAME=${TARGET_DATABASE} in this process; the script will refuse any other database.`);
  }
  if (!["test", "development"].includes(String(process.env.NODE_ENV || "").toLowerCase())) {
    throw new Error("Set NODE_ENV to test or development in this process; .env is not changed by this script.");
  }
  if (options.confirmedTarget !== TARGET_DATABASE) {
    throw new Error(`Pass --confirm-target=${TARGET_DATABASE} to confirm the fixed database target.`);
  }
  if (!options.execute) throw new Error("Pass --execute only when explicitly approved to provision the development admin.");
  if (!EMAIL_PATTERN.test(options.email) || options.email.length > 254) {
    throw new Error("Provide a valid --email address (not a password or secret).");
  }
  if (!options.displayName || options.displayName.length > 100) {
    throw new Error("Provide a --display-name between 1 and 100 characters.");
  }

  return options;
}

function readHiddenPassword(promptText) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Run this script from an interactive terminal so the password can be entered without echo."));
  }

  return new Promise((resolve, reject) => {
    let password = "";
    let finished = false;

    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      input.off("data", handleInput);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const handleInput = chunk => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Provisioning cancelled."));
        if (character === "\r" || character === "\n") return finish(null, password);
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
        } else if (character >= " " && character <= "~") {
          password += character;
        }
      }
    };

    process.stdout.write(promptText);
    input.setRawMode(true);
    input.resume();
    input.on("data", handleInput);
  });
}

async function collectPassword() {
  const password = await readHiddenPassword("New development admin password (12-128 printable ASCII characters): ");
  const confirmation = await readHiddenPassword("Confirm password: ");
  if (password.length < 12 || password.length > 128 || !/^[\x20-\x7E]+$/.test(password)) {
    throw new Error("Password must contain 12-128 printable ASCII characters.");
  }
  if (password !== confirmation) throw new Error("Password entries did not match.");
  return password;
}

async function findProvisionedAdmin(client, email) {
  const marked = await client.query(
    `SELECT u.id, u.email, u.status AS user_status, u.deleted_at,
            au.status AS admin_status,
            EXISTS (
              SELECT 1 FROM user_roles ur
              JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id AND r.code = $2
            ) AS has_role,
            EXISTS (
              SELECT 1 FROM user_roles ur
              JOIN roles r ON r.id = ur.role_id
              JOIN role_permissions rp ON rp.role_id = r.id
              JOIN permissions p ON p.id = rp.permission_id
              WHERE ur.user_id = u.id
                AND r.code = $2
                AND p.code = $3
            ) AS has_permission
     FROM admin_users au
     JOIN users u ON u.id = au.user_id
     WHERE au.employee_code = $1`,
    [ADMIN_EMPLOYEE_CODE, ADMIN_ROLE_CODE, CATEGORY_PERMISSION_CODE]
  );

  if (marked.rows.length > 1) throw new Error("The development admin marker is not unique; refusing to continue.");
  if (marked.rows[0]) {
    const existing = marked.rows[0];
    if (existing.email?.toLowerCase() !== email) {
      throw new Error("The development admin marker is already assigned to another email; refusing to modify it.");
    }
    if (existing.user_status !== "ACTIVE" || existing.deleted_at || existing.admin_status !== "ACTIVE") {
      throw new Error("The marked development admin is inactive; refusing to change existing rows.");
    }
    if (!existing.has_role || !existing.has_permission) {
      throw new Error("The marked development admin is incomplete; refusing to change existing mappings.");
    }
    return { state: "complete" };
  }

  const emailOwner = await client.query(
    "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
    [email]
  );
  if (emailOwner.rows.length) {
    throw new Error("That email already belongs to an unmarked user; refusing to modify or promote the account.");
  }

  return { state: "new" };
}

async function ensurePermission(client) {
  const inserted = await client.query(
    `INSERT INTO permissions (code, description)
     VALUES ($1, $2)
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [CATEGORY_PERMISSION_CODE, CATEGORY_PERMISSION_DESCRIPTION]
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };

  const existing = await client.query(
    "SELECT id FROM permissions WHERE code = $1",
    [CATEGORY_PERMISSION_CODE]
  );
  if (!existing.rows[0]) throw new Error("Could not safely resolve the category permission.");
  return { id: existing.rows[0].id, created: false };
}

async function ensureRole(client) {
  const inserted = await client.query(
    `INSERT INTO roles (code, display_name, description, is_system)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (code) DO NOTHING
     RETURNING id, description, is_system`,
    [ADMIN_ROLE_CODE, "Development Category Admin", ADMIN_ROLE_DESCRIPTION]
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };

  const existing = await client.query(
    "SELECT id, description, is_system FROM roles WHERE code = $1",
    [ADMIN_ROLE_CODE]
  );
  const role = existing.rows[0];
  if (!role || role.description !== ADMIN_ROLE_DESCRIPTION || role.is_system) {
    throw new Error("The development role code conflicts with an unmarked role; refusing to modify it.");
  }
  return { id: role.id, created: false };
}

async function provision(client, options, passwordHash) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", ["myshopzy-dev-admin", TARGET_DATABASE]);

  const state = await findProvisionedAdmin(client, options.email);
  if (state.state === "complete") return { alreadyProvisioned: true, inserted: {} };

  const userResult = await client.query(
    `INSERT INTO users (email, password_hash, display_name, status, email_verified_at)
     VALUES ($1, $2, $3, 'ACTIVE', now())
     RETURNING id`,
    [options.email, passwordHash, options.displayName]
  );
  const userId = userResult.rows[0].id;

  await client.query(
    `INSERT INTO admin_users (user_id, employee_code, status)
     VALUES ($1, $2, 'ACTIVE')`,
    [userId, ADMIN_EMPLOYEE_CODE]
  );

  const role = await ensureRole(client);
  const permission = await ensurePermission(client);

  const userRoleResult = await client.query(
    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING RETURNING user_id",
    [userId, role.id]
  );
  const rolePermissionResult = await client.query(
    "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING RETURNING role_id",
    [role.id, permission.id]
  );

  return {
    alreadyProvisioned: false,
    inserted: {
      users: 1,
      admin_users: 1,
      roles: role.created ? 1 : 0,
      permissions: permission.created ? 1 : 0,
      user_roles: userRoleResult.rowCount,
      role_permissions: rolePermissionResult.rowCount
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
    const database = await client.query("SELECT current_database() AS database, current_schema() AS schema");
    if (database.rows[0]?.database !== TARGET_DATABASE || database.rows[0]?.schema !== TARGET_SCHEMA) {
      throw new Error("Connected database/schema did not match the fixed development target.");
    }

    const preflight = await findProvisionedAdmin(client, options.email);
    if (preflight.state === "complete") {
      console.log(JSON.stringify({ database: TARGET_DATABASE, alreadyProvisioned: true, databaseWrites: 0 }));
      return;
    }

    let password = await collectPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    password = "";
    await client.query("BEGIN");
    try {
      const result = await provision(client, options, passwordHash);
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
  console.error(`Development admin provisioning stopped: ${error.message}`);
  process.exitCode = 1;
});
