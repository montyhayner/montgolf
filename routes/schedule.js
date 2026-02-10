// routes/schedule.js

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");
const { requireLogin } = require("../middleware/auth");

// --- DB helpers (async/await wrappers) ---

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

// -----------------------------------------------------------------------------
// GET USER SCHEDULE FOR SPECIFIC MONTH
// -----------------------------------------------------------------------------

router.get("/:year/:month", requireLogin, async (req, res) => {
  logger.route("GET", "/schedule/:year/:month");

  try {
    const userId = req.session.user.id;
    const { year, month } = req.params;

    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;

    // 1. Check for saved schedule
    const saved = await dbAll(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ? AND date BETWEEN ? AND ?`,
      [userId, start, end]
    );

    if (saved.length > 0) {
      const schedule = {};
      saved.forEach(r => {
        schedule[r.date] = r.is_playing === 1;
      });

      return res.json({ schedule, status: "saved" });
    }

    // 2. Check in-town status
    const monthRow = await dbGet(
      `SELECT in_town FROM user_play_months WHERE user_id = ? AND month = ?`,
      [userId, month]
    );

    if (!monthRow || monthRow.in_town === 0) {
      return res.json({ schedule: {}, status: "out_of_town" });
    }

    // 3. Get weekly play days
    const playDays = await dbAll(
      `SELECT day_of_week
       FROM user_play_days
       WHERE user_id = ? AND is_play_day = 1`,
      [userId]
    );

    const allowedDays = playDays.map(r => r.day_of_week);

    // 4. Generate default schedule
    const schedule = {};
    for (let d = 1; d <= endDate; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = allowedDays.includes(dow);
    }

    res.json({ schedule, status: "default" });

  } catch (err) {
    logger.error(err, "GET /schedule/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GENERATE DEFAULT SCHEDULE (AND SAVE IT)
// -----------------------------------------------------------------------------

router.post("/default/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/schedule/default/:year/:month");

  try {
    const userId = req.session.user.id;
    const { year, month } = req.params;

    const endDate = new Date(year, month, 0).getDate();

    // Check in-town status
    const monthRow = await dbGet(
      `SELECT in_town FROM user_play_months WHERE user_id = ? AND month = ?`,
      [userId, month]
    );

    if (!monthRow || monthRow.in_town === 0) {
      return res.json({ schedule: {}, status: "out_of_town" });
    }

    // Weekly play days
    const playDays = await dbAll(
      `SELECT day_of_week
       FROM user_play_days
       WHERE user_id = ? AND is_play_day = 1`,
      [userId]
    );

    const allowedDays = playDays.map(r => r.day_of_week);

    // Build schedule
    const schedule = {};
    for (let d = 1; d <= endDate; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = allowedDays.includes(dow);
    }

    // Save to DB
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

    logger.db("UPSERT schedule (default)", { userId });
    res.json({ schedule, status: "default" });

  } catch (err) {
    logger.error(err, "POST /schedule/default/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GENERATE SCHEDULE BASED ON AVAILABILITY (NO SAVE)
// -----------------------------------------------------------------------------

router.post("/generate/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/schedule/generate/:year/:month");

  try {
    const userId = req.session.user.id;
    const { year, month } = req.params;
    //const schedule = req.body.schedule;
    const endDate = new Date(year, month, 0).getDate();

    // Check in-town status
    const monthRow = await dbGet(
      `SELECT in_town FROM user_play_months WHERE user_id = ? AND month = ?`,
      [userId, month]
    );

    if (!monthRow || monthRow.in_town === 0) {
      return res.json({ schedule: {}, status: "out_of_town" });
    }

    // Weekly play days
    const playDays = await dbAll(
      `SELECT day_of_week
       FROM user_play_days
       WHERE user_id = ? AND is_play_day = 1`,
      [userId]
    );

    const allowedDays = playDays.map(r => r.day_of_week);

    // Build schedule
    const schedule = {};
    for (let d = 1; d <= endDate; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = allowedDays.includes(dow);
    }

    res.json({ schedule, status: "generated" });

  } catch (err) {
    logger.error(err, "POST /schedule/generate/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// CLEAR SCHEDULE FOR MONTH
// -----------------------------------------------------------------------------

router.post("/clear/:year/:month", requireLogin, async (req, res) => {
  logger.route("POST", "/schedule/clear/:year/:month");

  try {
    const userId = req.session.user.id;
    const { year, month } = req.params;

    const endDate = new Date(year, month, 0).getDate();

    const dates = [];
    for (let d = 1; d <= endDate; d++) {
      dates.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }

    const stmt = db.prepare(`
      INSERT INTO schedule (user_id, date, is_playing)
      VALUES (?, ?, 0)
      ON CONFLICT(user_id, date)
      DO UPDATE SET is_playing = 0
    `);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        dates.forEach(date => stmt.run(userId, date));
        stmt.finalize(err => (err ? reject(err) : resolve()));
      });
    });

    logger.db("CLEAR schedule", { userId });
    res.json({ success: true, schedule: {} });

  } catch (err) {
    logger.error(err, "POST /schedule/clear/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// SAVE SCHEDULE (USER EDITS)
// -----------------------------------------------------------------------------
router.put("/:year/:month", requireLogin, async (req, res) => {
  console.log(">>> ENTERED PUT /user/schedule/:year/:month ROUTE");

  logger.route("PUT", "/schedule/:year/:month");

  try {
    const userId = req.session.user.id;
    const { year, month } = req.params;
    const { schedule } = req.body;

    console.log(">>> DEBUG: userId =", userId);
    console.log(">>> DEBUG: league_id =", req.session.user.league_id);
    console.log(">>> DEBUG: league_name =", req.session.user.league_name);
    console.log(">>> DEBUG: incoming schedule =", schedule);

    // -------------------------------------------------------------------------
    // VALIDATION BLOCK
    // -------------------------------------------------------------------------

    console.log(">>> DEBUG: ENTERING VALIDATION BLOCK");

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

    // end of temporary console displays

    if (!schedule || typeof schedule !== "object") {
      return res.status(400).json({ error: "Invalid schedule payload" });
    }

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

    logger.db("UPSERT schedule (user save)", { userId });
    res.json({ success: true });

  } catch (err) {
    logger.error(err, "PUT /schedule/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;