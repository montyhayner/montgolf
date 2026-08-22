// routes/schedule.js
console.log("SCHEDULE.JS LOADED");
const express = require("express");
const router = express.Router();
const db = require("../db");
const dbGet = require("../utils/dbGet");
const logger = require("../utils/logger");
const { requireLogin } = require("../middleware/auth");

console.log("LOADED: OLD schedule.js (516 lines)");


// --- DB helpers (async/await wrappers) ---

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this); // allows access to changes, lastID if needed
    });
  });
}

// -----------------------------------------------------------------------------
// USER INFO
// -----------------------------------------------------------------------------

router.get("/info", requireLogin, async (req, res) => {
  logger.route("GET", "/user/info");

  try {
    const userId = req.session.user.id;

    const row = await dbGet(
      `SELECT first_name, last_name FROM users WHERE id = ?`,
      [userId]
    );

    res.json({ user: row });
  } catch (err) {
    logger.error(err, "GET /user/info");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// SELECTED LEAGUE
// -----------------------------------------------------------------------------

router.get("/selected-league", requireLogin, async (req, res) => {
  logger.route("GET", "/user/selected-league");

  try {
    const leagueId = req.session.user.league_id;

    const row = await dbGet(
      `SELECT id, league_name FROM leagues WHERE id = ?`,
      [leagueId]
    );

    res.json({ league: row });
  } catch (err) {
    logger.error(err, "GET /user/selected-league");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// USER LAST-VIEWED SCHEDULE MONTH
// -----------------------------------------------------------------------------
router.get("/schedule", requireLogin, (req, res) => {
  logger.route("GET", "/user/schedule");

  let { lastScheduleYear, lastScheduleMonth } = req.session;

  if (!lastScheduleYear || !lastScheduleMonth) {
    const now = new Date();
    lastScheduleYear = now.getFullYear();
    lastScheduleMonth = String(now.getMonth() + 1).padStart(2, "0");
  }

  res.json({
    year: lastScheduleYear,
    month: lastScheduleMonth
  });
});

// -----------------------------------------------------------------------------
// USER MONTHLY SCHEDULE (actual schedule data)
// -----------------------------------------------------------------------------

router.get("/schedule/:year/:month", requireLogin, async (req, res) => {
  logger.route("GET", "/user/schedule/:year/:month");

  const userId = req.session.user.id;
  const { year, month } = req.params;

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;

  try {
    // 1. Check for saved schedule
    const saved = await dbAll(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND date BETWEEN ? AND ?`,
      [userId, start, end]
    );

    if (saved.length > 0) {
      const schedule = {};
      saved.forEach(r => {
        schedule[r.date] = r.is_playing === 1;
      });
      return res.json({ schedule, status: "saved" });
    }

    // 2. No saved schedule → check if user is in town
    const monthRow = await dbGet(
      `SELECT in_town FROM user_play_months
       WHERE user_id = ? AND month = ?`,
      [userId, month]
    );

    if (!monthRow || monthRow.in_town === 0) {
      return res.json({ schedule: {}, status: "out_of_town" });
    }

    // 3. Build default schedule from play days
    const playDays = await dbAll(
      `SELECT day_of_week
       FROM user_play_days
       WHERE user_id = ? AND is_play_day = 1`,
      [userId]
    );

    const allowedDays = playDays.map(r => r.day_of_week);
    const schedule = {};

    for (let d = 1; d <= endDate; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = allowedDays.includes(dow);
    }

    res.json({ schedule, status: "default" });

  } catch (err) {
    logger.error(err, "GET /user/schedule/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// SAVE USER SCHEDULE
// -----------------------------------------------------------------------------
router.put("/schedule/:year/:month", requireLogin, async (req, res) => {
  console.log(">>> ENTERED CORRECT PUT /schedule/:year/:month ROUTE");

  logger.route("PUT", "/user/schedule/:year/:month");

  try {
    const userId = req.session.user.id;
    const { year, month } = req.params;
    const schedule = req.body.schedule;

    console.log(">>> DEBUG: incoming schedule =", schedule);

    // -------------------------------------------------------------------------
    // VALIDATION: Ensure user is only selecting days allowed by the league
    // -------------------------------------------------------------------------

    const leagueId = req.session.user.league_id;

    const leagueDaysRows = await dbAll(
      `SELECT day_of_week
       FROM league_play_days
       WHERE league_id = ? AND is_play_day = 1`,
      [leagueId]
    );

    console.log(">>> DEBUG: leagueDaysRows =", leagueDaysRows);

    const allowedDays = leagueDaysRows.map(r => r.day_of_week);
    console.log(">>> DEBUG: allowedDays =", allowedDays);
    const invalidSelections = [];

    for (const [date, isPlaying] of Object.entries(schedule)) {
      //const dow = new Date(date).getDay();
      const [y, m, d] = date.split("-");
      const dow = new Date(y, m - 1, d).getDay();

      console.log(`>>> DEBUG: checking ${date}: isPlaying=${isPlaying}, dow=${dow}`);

      if (isPlaying && !allowedDays.includes(dow)) {
        console.log(">>> DEBUG: INVALID DAY DETECTED:", date);
        invalidSelections.push({ date, dow });
      }
    }

    console.log(">>> DEBUG: invalidSelections =", invalidSelections);

    if (invalidSelections.length > 0) {
      console.log(">>> DEBUG: REJECTING SAVE — invalid days found");
      return res.status(400).json({
        error: "Invalid days selected",
        invalidDates: invalidSelections.map(x => x.date)
      });
    }

    console.log(">>> DEBUG: VALIDATION PASSED — continuing to save");

    // -------------------------------------------------------------------------
    // SAVE LOGIC
    // -------------------------------------------------------------------------

    const stmt = db.prepare(`
      INSERT INTO schedule (user_id, date, is_playing)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, date)
      DO UPDATE SET is_playing = excluded.is_playing
    `);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        Object.entries(schedule).forEach(([date, isPlaying]) => {
          stmt.run(userId, date, isPlaying ? 1 : 0);
        });
        stmt.finalize(err => (err ? reject(err) : resolve()));
      });
    });

    res.json({ success: true });

  } catch (err) {
    logger.error(err, "PUT /schedule/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

//---------------------------------------------------------
//  DEFAULT 
//---------------------------------------------------------
router.post("/schedule/default/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/user/schedule/default/:year/:month");

  const userId = req.session.user.id;
  const { year, month } = req.params;
  const forceInTown = req.query.forceInTown === "1";

  try {
    // 1. Check current in-town status
    const monthRow = await dbGet(
      `SELECT in_town
       FROM user_play_months
       WHERE user_id = ? AND month = ?`,
      [userId, month]
    );

    const isInTown = monthRow && monthRow.in_town === 1;

    // 2. If out of town and not forcing, return special status
    if (!isInTown && !forceInTown) {
      return res.json({ status: "out_of_town" });
    }

    // 3. If forcing, update user_play_months FIRST
    if (!isInTown && forceInTown) {
      await dbRun(
        `UPDATE user_play_months
         SET in_town = 1
         WHERE user_id = ? AND month = ?`,
        [userId, month]
      );
    }

    // 4. Load user's weekly play days
    const dayRows = await dbAll(
      `SELECT day_of_week
       FROM user_play_days
       WHERE user_id = ? AND is_play_day = 1`,
      [userId]
    );

    const allowedDays = dayRows.map(r => r.day_of_week);

    // 5. Build default schedule
    const endDate = new Date(year, month, 0).getDate();
    const schedule = {};

    for (let d = 1; d <= endDate; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = allowedDays.includes(dow);
    }

    res.json({
      schedule,
      status: forceInTown ? "default_after_marking_in_town" : "default"
    });

  } catch (err) {
    logger.error(err, "POST /user/schedule/default/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

//---------------------------------------------------------
//  CLEAR SCHEDULE
//---------------------------------------------------------
router.post("/schedule/clear/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/user/schedule/clear/:year/:month");

  const userId = req.session.user.id;
  const { year, month } = req.params;

  try {
    // 1. Delete existing schedule rows for this month
    await dbRun(
      `DELETE FROM schedule
       WHERE user_id = ?
         AND year = ?
         AND month = ?`,
      [userId, year, month]
    );

    // 2. Return an empty schedule object
    res.json({
      schedule: {},
      status: "cleared"
    });

  } catch (err) {
    logger.error(err, "POST /user/schedule/clear/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// REVERT SCHEDULE (reload saved schedule from DB)
// -----------------------------------------------------------------------------

router.post("/schedule/revert/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/user/schedule/revert/:year/:month");

  const userId = req.session.user.id;
  const { year, month } = req.params;

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;

  try {
    const saved = await dbAll(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND date BETWEEN ? AND ?`,
      [userId, start, end]
    );

    const schedule = {};
    saved.forEach(r => {
      schedule[r.date] = r.is_playing === 1;
    });

    res.json({ schedule, status: "saved" });

  } catch (err) {
    logger.error(err, "POST /user/schedule/revert/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// Save last viewed month
router.post("/set-last-month", requireLogin, (req, res) => {
  logger.route("POST", "/user/set-last-month");

  const { year, month } = req.body;

  req.session.lastScheduleYear = year;
  req.session.lastScheduleMonth = month;

  res.json({ success: true });
});

// -----------------------------------------------------------------------------
// LEAGUE SELECTION (for multi-league users)
// -----------------------------------------------------------------------------

router.post("/select-league", requireLogin, async (req, res) => {
  logger.route("POST", "/user/select-league");

  try {
    const { league_id } = req.body;

    if (!req.session.pendingUser) {
      return res.status(400).json({ error: "No pending user" });
    }

    const row = req.session.pendingUser.userRows.find(
      r => r.league_id == league_id
    );

    if (!row) {
      return res.status(400).json({ error: "Invalid league" });
    }

    req.session.user = {
      id: row.id,
      email: row.email,
      league_id: row.league_id
    };

    delete req.session.pendingUser;

    res.json({ success: true });
  } catch (err) {
    logger.error(err, "POST /user/select-league");
    res.status(500).json({ error: err.message });
  }
});

// ---- Load initial month (session-aware) ----

async function initSchedulePage() {
  const res = await fetch("/user/schedule");
  const data = await res.json();

  const year = data.year;
  const month = data.month;

  document.getElementById("monthPicker").value =
    `${year}-${String(month).padStart(2,"0")}`;

  await loadScheduleForCurrentMonth();
}

async function loadScheduleForCurrentMonth() {
  const { year, month } = getMonthParts();

  fetch("/user/set-last-month", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month })
  });
}

function configureMonthPickerLimits() {
  const monthPicker = document.getElementById("monthPicker");
  const now = new Date();

  // Current year-month
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1–12

  // Compute max allowed month = 13 months ahead
  const maxDate = new Date(now);
  maxDate.setMonth(maxDate.getMonth() + 13);

  const maxYear = maxDate.getFullYear();
  const maxMonth = maxDate.getMonth() + 1;

  // Format YYYY-MM
  const pad = n => String(n).padStart(2, "0");

  const minValue = `${currentYear}-${pad(currentMonth)}`;
  const maxValue = `${maxYear}-${pad(maxMonth)}`;

  // Apply limits to the picker
  monthPicker.min = minValue;
  monthPicker.max = maxValue;

  // If current value is outside range, snap it back
  if (monthPicker.value < minValue) {
    monthPicker.value = minValue;
  }
  if (monthPicker.value > maxValue) {
    monthPicker.value = maxValue;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Schedule JS running");

  const picker = document.getElementById("monthPicker");
  if (!picker) {
    console.error("monthPicker not found in DOM");
    return;
  }

  configureMonthPickerLimits();

  picker.addEventListener("change", () => {
    loadScheduleForCurrentMonth();
  });

  document.getElementById("defaultBtn").addEventListener("click", regenerateDefaultSchedule);
  document.getElementById("clearBtn").addEventListener("click", clearSchedule);
  document.getElementById("saveBtn").addEventListener("click", saveSchedule);
  document.getElementById("revertBtn").addEventListener("click", revertToSaved);

  // Load initial month (session-aware)
  initSchedulePage();
});

module.exports = router;
