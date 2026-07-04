// jobs/runDefaultPlaydatesJob.js

const setDefaultPlaydatesNextMonth = require("../services/setDefaultPlaydatesNextMonth");
const et = require("../utils/easternTime");

async function runDefaultPlaydatesJob() {
  console.log("⏰ Running default playdates job...");

const rawET = et.easternNow();   // "YYYY-MM-DD HH:mm:ss"

// Extract only the date portion
const datePart = rawET.split(" ")[0];   // "2026-06-28"

// Parse into numbers
const [year, month, day] = datePart.split("-").map(Number);

// Build a real Date object
const nowDate = new Date(year, month - 1, day);

// First day of next month
const nextMonthDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1);

// First day of month after next
const monthAfterNextDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + 2, 1);

// Format YYYY-MM-01
const nextMonthStart =
  `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

const monthAfterNextStart =
  `${monthAfterNextDate.getFullYear()}-${String(monthAfterNextDate.getMonth() + 1).padStart(2, '0')}-01`;

const nextMonthNumber = nextMonthDate.getMonth() + 1;

  console.log("📅 Parameters:", {
    nextMonthStart,
    monthAfterNextStart,
    nextMonthNumber
  });

  try {
    const rows = await setDefaultPlaydatesNextMonth(
      nextMonthStart,
      monthAfterNextStart,
      nextMonthNumber
    );

    console.log(`✅ Default playdates job complete. Rows affected: ${rows}`);
    return rows;

  } catch (err) {
    console.error("❌ Default playdates job failed:", err);
    throw err;
  }
}

module.exports = { runDefaultPlaydatesJob };
