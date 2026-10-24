const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.resolve("./golf.db");

console.log("Using DB:", dbPath);

const db = new Database(dbPath);

module.exports = db;
