const sql = require("mssql");
require("dotenv").config();

// IMPORTANT: env names match what you're using
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

let poolPromise = null;

const getPool = async () => {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig);
  }
  return poolPromise;
};

// Connect only (no table creation)
const connectDB = async () => {
  try {
    await getPool();
    console.log("Database Connected ✅");
  } catch (err) {
    console.error("DB Error:", err);
    throw err;
  }
};

// Connect + create tables
const initDB = async () => {
  try {
    console.log("Initializing Database...");
    const pool = await getPool();
console.log("Database Connected ✅");

}
catch (err) {    console.error("DB Initialization Error:", err);
    throw err;
  };}

module.exports = { sql, dbConfig, getPool, connectDB, initDB };
