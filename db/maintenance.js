// db/maintenance.js
const db = require("../db.js"); // your existing db.js wrapper

async function optimizeDatabase() {
  try {
    console.log("🔧 Running SQLite startup optimization...");

    await db.runAsync("ANALYZE;");
    await db.runAsync("PRAGMA optimize;");

    console.log("✅ SQLite optimization complete.");
  } catch (err) {
    console.error("⚠️ SQLite optimization error:", err);
  }
}

async function vacuumDatabase() {
  try {
    console.log("🧹 Running monthly VACUUM...");
    await db.runAsync("VACUUM;");
    console.log("✨ VACUUM complete.");
  } catch (err) {
    console.error("⚠️ VACUUM error:", err);
  }
}

module.exports = { optimizeDatabase };


