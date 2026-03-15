const { Pool } = require("pg");

const DATABASE_URL = String(
  process.env.DATABASE_URL || "postgresql://palettenuser:DEIN_STARKES_PASSWORT@localhost:5432/palettenmanagement"
).trim();

const ssl =
  process.env.PG_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl,
});

module.exports = { pool };
