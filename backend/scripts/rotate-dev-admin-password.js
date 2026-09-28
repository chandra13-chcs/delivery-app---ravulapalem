"use strict";

const path = require("path");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const TARGET_DATABASE = "delivery_app_test";
const TARGET_SCHEMA = "public";
const TARGET_EMAIL = "dev-admin@myshopzy.test";
const TARGET_EMPLOYEE_CODE = "DEV-CATEGORY-ADMIN";

function validateArguments(args) {
  const expectedConfirmation = `--confirm-target=${TARGET_DATABASE}`;
  const unknown = args.filter(argument => argument !== expectedConfirmation && argument !== "--execute");
  if (unknown.length) throw new Error("Unknown arguments are not accepted; password input is prompt-only.");
  if (process.env.DB_NAME !== TARGET_DATABASE) {
    throw new Error(`Set DB_NAME=${TARGET_DATABASE} in this process; refusing every other database.`);
  }
  if (!["test", "development"].includes(String(process.env.NODE_ENV || "").toLowerCase())) {
    throw new Error("Set NODE_ENV to test or development in this process; .env is not changed by this script.");
  }
  if (!args.includes(expectedConfirmation)) {
    throw new Error(`Pass ${expectedConfirmation} to confirm the fixed target.`);
  }
  if (!args.includes("--execute")) {
    throw new Error("Pass --execute only after approving the displayed target and account.");
  }
}

function readHiddenPassword(promptText) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Run from an interactive terminal so password input can remain hidden."));
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
        if (character === "\u0003") return finish(new Error("Password rotation cancelled."));
        if (character === "\r" || character === "\n") return finish(null, password);
        if (character === "\u007f" || character === "\b") password = Array.from(password).slice(0, -1).join("");
        else if (character >= " " && character <= "~") password += character;
      }
    };

    process.stdout.write(promptText);
    input.setRawMode(true);
    input.resume();
    input.on("data", handleInput);
  });
}

async function collectPassword() {
  let password = await readHiddenPassword("New password (12-128 printable ASCII characters): ");
  let confirmation = await readHiddenPassword("Confirm new password: ");
  if (password.length < 12 || password.length > 128 || !/^[\x20-\x7E]+$/.test(password)) {
    password = "";
    confirmation = "";
    throw new Error("Password must contain 12-128 printable ASCII characters.");
  }
  if (password !== confirmation) {
    password = "";
    confirmation = "";
    throw new Error("Password entries did not match.");
  }
  confirmation = "";
  return password;
}

async function main() {
  validateArguments(process.argv.slice(2));
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: TARGET_DATABASE,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT)
  });
  let client;
  let transactionOpen = false;
  let password = "";

  try {
    client = await pool.connect();
    const database = await client.query("SELECT current_database() AS database, current_schema() AS schema");
    if (database.rows[0]?.database !== TARGET_DATABASE || database.rows[0]?.schema !== TARGET_SCHEMA) {
      throw new Error("Connected database/schema did not match the fixed test target.");
    }

    const accountResult = await client.query(
      `SELECT u.id, u.email, u.status AS user_status,
              (u.deleted_at IS NOT NULL) AS user_deleted,
              au.employee_code, au.status AS admin_status
       FROM users u
       JOIN admin_users au ON au.user_id = u.id
       WHERE lower(u.email) = lower($1)
         AND au.employee_code = $2`,
      [TARGET_EMAIL, TARGET_EMPLOYEE_CODE]
    );
    if (accountResult.rowCount !== 1) throw new Error("The fixed development admin account was not found uniquely.");
    const account = accountResult.rows[0];
    if (account.user_status !== "ACTIVE" || account.user_deleted || account.admin_status !== "ACTIVE") {
      throw new Error("The fixed development admin account is not active; refusing to rotate it.");
    }

    console.log(JSON.stringify({
      targetDatabase: TARGET_DATABASE,
      targetSchema: TARGET_SCHEMA,
      account: {
        email: account.email,
        userId: account.id,
        employeeCode: account.employee_code
      },
      update: "users.password_hash only"
    }, null, 2));

    password = await collectPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    password = "";

    await client.query("BEGIN");
    transactionOpen = true;
    const lockedAccount = await client.query(
      `SELECT u.id
       FROM users u
       JOIN admin_users au ON au.user_id = u.id
       WHERE u.id = $1
         AND lower(u.email) = lower($2)
         AND u.status = 'ACTIVE'
         AND u.deleted_at IS NULL
         AND au.employee_code = $3
         AND au.status = 'ACTIVE'
       FOR UPDATE OF u, au`,
      [account.id, TARGET_EMAIL, TARGET_EMPLOYEE_CODE]
    );
    if (lockedAccount.rowCount !== 1) throw new Error("The target admin changed state; refusing to update.");

    const updateResult = await client.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2
         AND lower(email) = lower($3)
         AND status = 'ACTIVE'
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM admin_users au
           WHERE au.user_id = users.id
             AND au.employee_code = $4
             AND au.status = 'ACTIVE'
         )`,
      [passwordHash, account.id, TARGET_EMAIL, TARGET_EMPLOYEE_CODE]
    );
    if (updateResult.rowCount !== 1) throw new Error("Expected exactly one development admin password row to update.");

    await client.query("COMMIT");
    transactionOpen = false;

    const verification = await pool.query(
      "SELECT password_hash IS NOT NULL AS password_hash_exists FROM users WHERE id = $1 AND lower(email) = lower($2)",
      [account.id, TARGET_EMAIL]
    );
    if (verification.rowCount !== 1 || verification.rows[0].password_hash_exists !== true) {
      throw new Error("Post-rotation password-hash existence check failed.");
    }

    console.log(JSON.stringify({
      targetDatabase: TARGET_DATABASE,
      account: TARGET_EMAIL,
      updatedColumn: "users.password_hash",
      updatedRows: updateResult.rowCount,
      passwordHashExists: true
    }, null, 2));
  } catch (error) {
    if (client && transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    password = "";
    client?.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(`Development admin password rotation stopped: ${error.message}`);
  process.exitCode = 1;
});
