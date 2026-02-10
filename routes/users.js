// routes/user.js

const express = require("express");
const router = express.Router();
const db = require("../db");
const dbGet = require("../utils/dbGet");
const logger = require("../utils/logger");
const { requireLogin } = require("../middleware/auth");

// --- DB helpers (async/await wrappers) ---

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
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

router.post("/schedule/default/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/user/schedule/default/:year/:month");

  try {
    const userId = req.session.user.id;
    const { year, month } = req.params;

    // Load league play days
    const leagueId = req.session.user.league_id;
    const leagueDays = await dbAll(
      `SELECT day_of_week
       FROM league_play_days
       WHERE league_id = ? AND is_play_day = 1`,
      [leagueId]
    );

    const allowedDays = leagueDays.map(r => r.day_of_week);

    // Build default schedule for the month
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);

    const stmt = db.prepare(`
      INSERT INTO schedule (user_id, date, is_playing)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, date)
      DO UPDATE SET is_playing = excluded.is_playing
    `);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split("T")[0];
          const dow = d.getDay();
          const isPlaying = allowedDays.includes(dow) ? 1 : 0;
          stmt.run(userId, dateStr, isPlaying);
        }
        stmt.finalize(err => (err ? reject(err) : resolve()));
      });
    });

    res.json({ success: true });

  } catch (err) {
    logger.error(err, "POST /schedule/default/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

router.post("/schedule/clear/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/user/schedule/clear/:year/:month");

  const userId = req.session.user.id;
  const { year, month } = req.params;

  try {
    // Delete existing schedule
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM schedule
         WHERE user_id = ?
           AND date LIKE ?`,
        [userId, `${year}-${String(month).padStart(2, "0")}-%`],
        err => (err ? reject(err) : resolve())
      );
    });

    const endDate = new Date(year, month, 0).getDate();
    const schedule = {};

    const insertStmt = db.prepare(
      `INSERT INTO schedule (user_id, date, is_playing)
       VALUES (?, ?, 0)`
    );

    for (let d = 1; d <= endDate; d++) {
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = false;
      insertStmt.run(userId, fullDate);
    }

    insertStmt.finalize();

    res.json({ schedule, status: "cleared" });

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

router.get("/availability", requireLogin, async (req, res) => {
  logger.route("GET", "/user/availability");

  const userId = req.session.user.id;

  try {
    const playDaysRows = await dbAll(
      `SELECT day_of_week, is_play_day
       FROM user_play_days
       WHERE user_id = ?`,
      [userId]
    );

    const playMonthsRows = await dbAll(
      `SELECT month, in_town
       FROM user_play_months
       WHERE user_id = ?`,
      [userId]
    );

    const playDays = {};
    playDaysRows.forEach(r => playDays[r.day_of_week] = r.is_play_day === 1);

    const playMonths = {};
    playMonthsRows.forEach(r => playMonths[r.month] = r.in_town === 1);

    res.json({ playDays, playMonths });

  } catch (err) {
    logger.error(err, "GET /user/availability");
    res.status(500).json({ error: err.message });
  }
});

router.put("/availability", requireLogin, async (req, res) => {
  logger.route("PUT", "/user/availability");

  const userId = req.session.user.id;
  const { playDays, playMonths } = req.body;

  try {
    // Update play days
    const stmtDays = db.prepare(
      `UPDATE user_play_days
       SET is_play_day = ?
       WHERE user_id = ? AND day_of_week = ?`
    );

    for (const [dow, val] of Object.entries(playDays)) {
      stmtDays.run(val ? 1 : 0, userId, dow);
    }
    stmtDays.finalize();

    // Update play months
    const stmtMonths = db.prepare(
      `UPDATE user_play_months
       SET in_town = ?
       WHERE user_id = ? AND month = ?`
    );

    for (const [month, val] of Object.entries(playMonths)) {
      stmtMonths.run(val ? 1 : 0, userId, month);
    }
    stmtMonths.finalize();

    res.json({ success: true });

  } catch (err) {
    logger.error(err, "PUT /user/availability");
    res.status(500).json({ error: err.message });
  }
});

router.post("/availability/default", requireLogin, async (req, res) => {
  logger.route("POST", "/user/availability/default");

  const userId = req.session.user.id;

  try {
    // Default play days = all false
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE user_play_days
         SET is_play_day = 0
         WHERE user_id = ?`,
        [userId],
        err => err ? reject(err) : resolve()
      );
    });

    // Default play months = all in town
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE user_play_months
         SET in_town = 1
         WHERE user_id = ?`,
        [userId],
        err => err ? reject(err) : resolve()
      );
    });

    // Return new defaults
    const playDays = { 0:false,1:false,2:false,3:false,4:false,5:false,6:false };
    const playMonths = {};
    for (let m = 1; m <= 12; m++) playMonths[m] = true;

    res.json({ playDays, playMonths });

  } catch (err) {
    logger.error(err, "POST /user/availability/default");
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

module.exports = router;