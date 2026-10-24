// db/maintenance.js
const db = require("../db.js");

// ---------------------------------------------------------
// ANALYZE + PRAGMA optimize (synchronous better-sqlite3)
// ---------------------------------------------------------
function optimizeDatabase() {
  try {
    console.log("🔧 Running SQLite startup optimization...");

    db.prepare("ANALYZE").run();
    db.prepare("PRAGMA optimize").run();

    console.log("✅ SQLite optimization complete.");
  } catch (err) {
    console.error("⚠️ SQLite optimization error:", err);
  }
}

// ---------------------------------------------------------
// VACUUM (synchronous better-sqlite3)
// ---------------------------------------------------------
function vacuumDatabase() {
  try {
    console.log("🧹 Running monthly VACUUM...");
    db.prepare("VACUUM").run();
    console.log("✨ VACUUM complete.");
  } catch (err) {
    console.error("⚠️ VACUUM error:", err);
  }
}

module.exports = {
  optimizeDatabase,
  vacuumDatabase
};
