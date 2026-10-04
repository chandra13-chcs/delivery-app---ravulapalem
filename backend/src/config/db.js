const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const databaseUrl = process.env.DATABASE_URL;
const databaseHost = databaseUrl ? new URL(databaseUrl).hostname.replace(/^\[|\]$/g, "") : "";
const poolConfig = {
  connectionString: databaseUrl,
  max: 3,
};

if (databaseUrl && !["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.connect()
  .then((client) => {
    console.log("✅ PostgreSQL connected successfully");
    client.release();
  })
  .catch((err) => {
    console.error("❌ PostgreSQL connection failed:", err.message);
  });

module.exports = pool;