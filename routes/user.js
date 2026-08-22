// routes/user.js

const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../db");
const logger = require("../utils/logger");
const { requireLogin } = require("../middleware/auth");
const { easternNow } = require("../utils/easternTime");
const {
  getTwoWeekReport,
  sendTwoWeekReportEmail,
  getLatestTeeSheet,
  sendLatestTeeSheetEmail
} = require("../services/reportHandlers");

// --- DB helpers (async/await wrappers) ---
function dbGet(sql, params = []) {
  return db.getAsync(sql, params);
}

function dbAll(sql, params = []) {
  return db.allAsync(sql, params);
}

function dbRun(sql, params = []) {
  return db.runAsync(sql, params);
}

router.get("/schedule/init", (req, res) => {
  console.log("🔥 USER INIT ROUTE HIT");

  try {
    const easternTS = easternNow();
    console.log("🔥 easternTS = ", easternTS);

    return res.json({
      status: "ok",
      easternTS: easternTS
    });

  } catch (err) {
    console.error("🔥 GET /user/schedule/init", err);
    return res.status(500).json({ error: "Server error getting eastern timezone timestamp" });
  }
});


// ============================================================================
// SAVE USER SCHEDULE (with schedule_history logging)
// ============================================================================

async function saveScheduleHandler(req, res) {
  logger.route("PUT", "/user/schedule/:year/:month");

  try {
    // ⭐ User can ONLY edit their own schedule
    const targetUserId = req.session.user.id;
    const targetUserEmail = req.session.user.email;
    const leagueId = req.session.user.league_id;

    // ⭐ Extract params + body
    const { year, month } = req.params;
    const { schedule, sessionStartTS } = req.body;

    const source = "user";

    // -------------------------------------------------------------------------
    // VALIDATION: Ensure user is only selecting days allowed by the league
    // -------------------------------------------------------------------------
    const leagueDaysRows = await dbAll(
      `SELECT day_of_week
         FROM league_play_days
        WHERE league_id = ?
          AND is_play_day = 1`,
      [leagueId]
    );

    const allowedDays = leagueDaysRows.map(r => r.day_of_week);
    const invalidSelections = [];

    for (const [date, isPlaying] of Object.entries(schedule)) {
      if (!isPlaying) continue;

      const [y, m, d] = date.split("-");
      const dow = new Date(y, m - 1, d).getDay();

      if (!allowedDays.includes(dow)) {
        invalidSelections.push(date);
      }
    }

    if (invalidSelections.length > 0) {
      return res.status(400).json({
        error: "Invalid days selected",
        invalidDates: invalidSelections
      });
    }

    // -------------------------------------------------------------------------
    // LOAD EXISTING SCHEDULE FOR THIS USER + MONTH
    // -------------------------------------------------------------------------
    const pad = n => String(n).padStart(2, "0");
    const prefix = `${year}-${pad(month)}-`;

    const existingRows = await dbAll(
      `SELECT date, is_playing
         FROM schedule
        WHERE user_id = ?
          AND date LIKE ?`,
      [targetUserId, `${prefix}%`]
    );

    const existingMap = {};
    for (const row of existingRows) {
      existingMap[row.date] = row.is_playing;
    }

    // -------------------------------------------------------------------------
    // DETECT CHANGES AND WRITE TO schedule_history
    // -------------------------------------------------------------------------
    const historyStmt = db.prepare(`
      INSERT INTO schedule_history (
          user_id,
          league_id,
          play_date,
          old_is_playing,
          new_is_playing,
          changed_by,
          changed_at,
          source,
          before_state,
          after_state
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, league_id, play_date, changed_at)
      DO UPDATE SET
          new_is_playing = excluded.new_is_playing,
          changed_by     = excluded.changed_by,
          source         = excluded.source,
          after_state    = excluded.after_state
    `);

    for (const [date, newVal] of Object.entries(schedule)) {
      const oldVal = existingMap[date] ?? 0;
      const newInt = newVal ? 1 : 0;

      if (oldVal !== newInt) {
        historyStmt.run(
          targetUserId,
          leagueId,
          date,
          oldVal,
          newInt,
          targetUserEmail,     // ⭐ user email, not admin email
          sessionStartTS,      // ⭐ from body
          source,
          JSON.stringify({ is_playing: oldVal }),
          JSON.stringify({ is_playing: newInt })
        );
      }
    }

    // -------------------------------------------------------------------------
    // CLEAN UP HISTORY ROWS WITH NO CHANGE
    // -------------------------------------------------------------------------
    db.prepare(
      `DELETE FROM schedule_history
        WHERE user_id = ?
          AND play_date LIKE ?
          AND new_is_playing = old_is_playing`
    ).run(targetUserId, `${prefix}%`);

    // -------------------------------------------------------------------------
    // SAVE LOGIC
    // -------------------------------------------------------------------------
    await db.runAsync(
      `DELETE FROM schedule
        WHERE user_id = ?
          AND date LIKE ?`,
      [targetUserId, `${prefix}%`]
    );

    const stmt = db.prepare(`
      INSERT INTO schedule (user_id, date, is_playing, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const [date, isPlaying] of Object.entries(schedule)) {
      stmt.run(targetUserId, date, isPlaying ? 1 : 0, sessionStartTS);
    }

    // -------------------------------------------------------------------------
    // UPDATE user_play_months.in_town
    // -------------------------------------------------------------------------
    await db.runAsync(
      `INSERT INTO user_play_months (user_id, month, in_town, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, month)
       DO UPDATE SET in_town = 1, updated_at = excluded.updated_at`,
      [targetUserId, month, sessionStartTS]
    );

    return res.json({
      status: "saved",
      schedule,
      edited_by: targetUserEmail,
      edited_user: targetUserEmail
    });

  } catch (err) {
    logger.error(err, "PUT /user/schedule/:year/:month");
    res.status(500).json({ error: err.message });
  }
}

// Attach to /user route
router.put("/schedule/:year/:month", requireLogin, saveScheduleHandler);


//---------------------------------------------------------
//  CLEAR SCHEDULE (Supports ADMIN OVERRIDE)
//---------------------------------------------------------

async function clearScheduleHandler(req, res) {
  logger.route("POST", "/user/schedule/clear/:year/:month");

  const isAdmin = req.session.user.is_admin === 1;

  let targetUserId = req.session.user.id;

  if (isAdmin && req.body && req.body.target_user_id) {
    targetUserId = parseInt(req.body.target_user_id);
  }

  const adminEmail = req.session.user.email;
  const leagueId = req.session.user.league_id;
  const { year, month } = req.params;

  const pad = n => String(n).padStart(2, "0");
  const prefix = `${year}-${pad(month)}-`;

  try {
    const existingRows = await dbAll(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND date LIKE ?`,
      [targetUserId, `${prefix}%`]
    );

    const ts = easternNow();

    const historyStmt = db.prepare(`
      INSERT INTO schedule_history (
        user_id, league_id, play_date,
        old_is_playing, new_is_playing,
        changed_by, changed_at, source,
        before_state, after_state
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of existingRows) {
      historyStmt.run(
        targetUserId,
        leagueId,
        row.date,
        row.is_playing,
        0,
        adminEmail,
        ts,
        isAdmin ? "admin" : "user",
        JSON.stringify({ is_playing: row.is_playing }),
        JSON.stringify({ is_playing: 0 })
      );
    }

    await db.runAsync(
      `DELETE FROM schedule
       WHERE user_id = ?
         AND date LIKE ?`,
      [targetUserId, `${prefix}%`]
    );

    return res.json({
      status: "cleared",
      schedule: {},
      target_user_id: targetUserId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Attach to /user route
router.post("/schedule/clear/:year/:month", requireLogin, clearScheduleHandler);

//---------------------------------------------------------
//  DEFAULT SCHEDULE (Supports ADMIN OVERRIDE)
//---------------------------------------------------------

async function defaultScheduleHandler(req, res) {
  logger.route("POST", "/user/schedule/default/:year/:month");

  const isAdmin = req.session.user.is_admin === 1;

  let targetUserId = req.session.user.id;

  if (isAdmin && req.body && req.body.target_user_id) {
    targetUserId = parseInt(req.body.target_user_id);
  }

  const { year, month } = req.params;

  try {
    const monthRow = await dbGet(
      `SELECT in_town
       FROM user_play_months
       WHERE user_id = ? AND month = ?`,
      [targetUserId, month]
    );

    let isInTown = monthRow?.in_town === 1;

    if (!isInTown) {
      return res.json({ status: "out_of_town" });
    }

    if (!isInTown) {
      await dbRun(
        `UPDATE user_play_months
            SET in_town = 1
          WHERE user_id = ? 
            AND month = ?`,
        [targetUserId, month]
      );
      isInTown = true;
    }

    const dayRows = await dbAll(
      `SELECT day_of_week
         FROM user_play_days
        WHERE user_id = ? 
          AND is_play_day = 1`,
      [targetUserId]
    );

    const allowedDays = dayRows.map(r => r.day_of_week);

    const endDate = new Date(year, month, 0).getDate();
    const schedule = {};

    for (let d = 1; d <= endDate; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = allowedDays.includes(dow);
    }

    return res.json({
      status: "default",
      schedule,
      target_user_id: targetUserId
    });

  } catch (err) {
    logger.error(err, "POST /user/schedule/default/:year/:month");
    res.status(500).json({ error: err.message });
  }
}

// Attach to /user route
router.post("/schedule/default/:year/:month", requireLogin, defaultScheduleHandler);


// -----------------------------------------------------------------------------
// USER INFO - get first_name, last_name  of logged-in user and pass back to frontend
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

// ------------------------------------------------------------
// USER REPORTS
// ------------------------------------------------------------

// Two‑Week Golfers Report (JSON for the page)
router.get("/reports/two-week", requireLogin, getTwoWeekReport);

// Two‑Week Golfers Report (send email)
router.post("two-week/email", requireLogin, sendTwoWeekReportEmail);

// Latest Tee Sheet Report (JSON for the page)
router.get("/reports/latest-tee-sheet", requireLogin, getLatestTeeSheet);

// Latest Tee Sheet Report (send email)
router.post("/reports/latest-tee-sheet/email", requireLogin, sendLatestTeeSheetEmail);

// -----------------------------------------------------------------------------
// SELECTED LEAGUE - get the league_name of the logged-in user's selected league
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

const path = require("path");

router.get("/edit-profile", requireLogin, (req, res) => {
  res.sendFile(path.resolve("public/user-edit-profile.html"));
});

router.get("/change-password", requireLogin, (req, res) => {
  res.sendFile(path.resolve("public/user-change-password.html"));
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

router.get("/schedule/:year/:month", requireLogin, async (req, res) => {
  logger.route("GET", "/user/schedule/:year/:month");

  const userId = req.session.user.id;
  const { year, month } = req.params;

  const pad = n => String(n).padStart(2, "0");
  const prefix = `${year}-${pad(month)}-`;

  const endDate = new Date(year, month, 0).getDate();

  try {
    // 1. Load in-town status
    const monthRow = await dbGet(
      `SELECT in_town
       FROM user_play_months
       WHERE user_id = ? AND month = ?`,
      [userId, month]
    );

    const inTown = monthRow?.in_town === 1;

    // 2. Load league play days
    const leagueRows = await dbAll(
      `SELECT day_of_week
       FROM league_play_days
       WHERE league_id = ? AND is_play_day = 1`,
      [req.session.user.league_id]
    );

    const leaguePlayDays = leagueRows.map(r => r.day_of_week);

    // 3. Load saved schedule rows
    const rows = await dbAll(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND date LIKE ?`,
      [userId, `${prefix}%`]
    );

    // ---------------------------------------------------------------------
    // CASE A: Out of town → always return empty schedule
    // ---------------------------------------------------------------------
    if (!inTown) {
      return res.json({
        schedule: {},
        status: "out_of_town",
        in_town: 0,
        leaguePlayDays
      });
    }

    // ---------------------------------------------------------------------
    // CASE B: No saved rows → new month (blank)
    // ---------------------------------------------------------------------
    if (rows.length === 0) {
      return res.json({
        schedule: {},
        status: "new",
        in_town: 1,
        leaguePlayDays
      });
    }

    // ---------------------------------------------------------------------
    // CASE C: Saved rows exist → determine cleared vs saved
    // ---------------------------------------------------------------------
    const allZero = rows.every(r => r.is_playing === 0);

    if (allZero) {
      return res.json({
        schedule: {},
        status: "cleared",
        in_town: 1,
        leaguePlayDays
      });
    }

    // ---------------------------------------------------------------------
    // CASE D: Saved schedule
    // ---------------------------------------------------------------------
    const schedule = {};
    rows.forEach(r => {
      schedule[r.date] = r.is_playing === 1;
    });

    return res.json({
      schedule,
      status: "saved",
      in_town: 1,
      leaguePlayDays
    });

  } catch (err) {
    logger.error(err, "GET /user/schedule/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

router.get("/session-info", requireLogin, async (req, res) => {
  const user = req.session.user;

  res.json({
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email
  });
});

router.get("/availability", requireLogin, async (req, res) => {
  logger.route("GET", "/user/availability");

  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;

  try {
    // 1. Load league play days
    const leagueDaysRows = await dbAll(
      `SELECT day_of_week
       FROM league_play_days
       WHERE league_id = ? AND is_play_day = 1`,
      [leagueId]
    );

    const leaguePlayDays = leagueDaysRows.map(r => r.day_of_week);

    // League plays all 12 months
    const leaguePlayMonths = Array.from({ length: 12 }, (_, i) => i + 1);

    // 2. Load user rows
    let playDaysRows = await dbAll(
      `SELECT day_of_week, is_play_day
       FROM user_play_days
       WHERE user_id = ?`,
      [userId]
    );

    let playMonthsRows = await dbAll(
      `SELECT month, in_town
       FROM user_play_months
       WHERE user_id = ?`,
      [userId]
    );

    // 3. Auto-create missing user rows
    if (playDaysRows.length === 0) {
      for (let dow = 0; dow < 7; dow++) {
        const isPlay = leaguePlayDays.includes(dow) ? 1 : 0;
        await dbRun(
          `INSERT INTO user_play_days (user_id, day_of_week, is_play_day)
           VALUES (?, ?, ?)`,
          [userId, dow, isPlay]
        );
      }
      playDaysRows = await dbAll(
        `SELECT day_of_week, is_play_day
         FROM user_play_days
         WHERE user_id = ?`,
        [userId]
      );
    }

    if (playMonthsRows.length < 12) {
        const existingMonths = new Set(playMonthsRows.map(r => r.month));

        for (let m = 1; m <= 12; m++) {
          if (!existingMonths.has(m)) {
            await dbRun(
              `INSERT INTO user_play_months (user_id, month, in_town)
               VALUES (?, ?, 1)`,
              [userId, m]
            );
          }
        }

      playMonthsRows = await dbAll(
        `SELECT month, in_town
         FROM user_play_months
         WHERE user_id = ?`,
        [userId]
      );
    }

    // 4. Convert to objects for frontend
    const playDays = Object.fromEntries(
      playDaysRows.map(r => [r.day_of_week, r.is_play_day === 1])
    );

    const playMonths = Object.fromEntries(
      playMonthsRows.map(r => [r.month, r.in_town === 1])
    );

    // 5. Return everything
    res.json({
      playDays,
      playMonths,
      leaguePlayDays,
      leaguePlayMonths
    });

  } catch (err) {
    logger.error(err, "GET /user/availability");
    res.status(500).json({ error: err.message });
  }
});

router.put("/availability", requireLogin, async (req, res) => {
  logger.route("PUT", "/user/availability");

  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;
  console.log("put /availability - req.body = ", req.body);
  const { playDays, playMonths } = req.body;

  try {
    // 1. Load allowed league play days
    const rows = await dbAll(
      `SELECT day_of_week
       FROM league_play_days
       WHERE league_id = ? AND is_play_day = 1`,
      [leagueId]
    );

    const allowedDays = rows.map(r => r.day_of_week);

    // 2. Validate user selections
    const invalid = [];
    for (const [dow, val] of Object.entries(playDays)) {
      if (val && !allowedDays.includes(Number(dow))) {
        invalid.push(Number(dow));
      }
    }

    if (invalid.length > 0) {
      return res.status(400).json({
        error: "Invalid play days selected",
        invalidDays: invalid
      });
    }

    // 3. Update weekly play days
    const stmtDays = db.prepare(`
      UPDATE user_play_days
      SET is_play_day = ?
      WHERE user_id = ? AND day_of_week = ?
    `);

    for (const [dow, val] of Object.entries(playDays)) {
      stmtDays.run(val ? 1 : 0, userId, dow);
    }

    // 4. Update monthly in-town
    const stmtMonths = db.prepare(`
      UPDATE user_play_months
      SET in_town = ?
      WHERE user_id = ? AND month = ?
    `);

    console.log("playMonths received:", playMonths);

    for (const [month, val] of Object.entries(playMonths)) {
     stmtMonths.run(val ? 1 : 0, userId, Number(month));
    }
    
    // 5. Success
    res.json({ success: true });

  } catch (err) {
    logger.error(err, "PUT /user/availability");
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /auth/admin-login  (ADMIN LOGIN)
// ============================================================================
router.post("/admin-login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Look up admin user
    const user = await db.getAsync(
      "SELECT * FROM users WHERE email = ? AND is_admin = 1",
      [email]
    );

    if (!user) {
      return res.redirect("/admin-login?error=1");
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.redirect("/admin-login?error=1");
    }

    // Save session
    req.session.user = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      league_id: user.league_id,
      is_admin: true,
      is_super_admin: user.is_super_admin === 1,
      user_mode: "admin"   // ⭐ REQUIRED
    };

    return res.redirect("/admin-dashboard");

  } catch (err) {
    console.error("🔥 ADMIN LOGIN ERROR:", err);
    return res.redirect("/admin-login?error=1");
  }
});

router.put("/edit-profile", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;
  const { first_name, last_name, email } = req.body;

  try {
    // Check if email already exists for another user in the same league
    const existing = await db.getAsync(
      `SELECT id FROM users WHERE email = ? AND league_id = ? AND id != ?`,
      [email, leagueId, userId]
    );

    if (existing) {
      return res.status(400).json({
        error: "That email is already used by another golfer in this league."
      });
    }

    // Update profile
    await db.runAsync(
      `UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE id = ?`,
      [first_name, last_name, email, userId]
    );

    // Update session
    req.session.user.first_name = first_name;
    req.session.user.last_name = last_name;
    req.session.user.email = email;
    req.session.user.user_mode = "user";
    res.json({ success: true });

  } catch (err) {
    console.error("🔥 PROFILE UPDATE ERROR:", err);
    res.status(500).json({ error: "Unable to update profile" });
  }
});


router.post("/availability/default", requireLogin, async (req, res) => {
  logger.route("POST", "/user/availability/default");

  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;

  try {
    // 1. Reset weekly play days to league defaults (SQLite-safe)
    await new Promise((resolve, reject) => {
      db.run(
        `
        UPDATE user_play_days
        SET is_play_day = COALESCE((
          SELECT is_play_day
          FROM league_play_days
          WHERE league_play_days.league_id = ?
            AND league_play_days.day_of_week = user_play_days.day_of_week
        ), 0)
        WHERE user_id = ?
        `,
        [leagueId, userId],
        err => err ? reject(err) : resolve()
      );
    });

    // 2. Reset all months to in-town
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE user_play_months SET in_town = 1 WHERE user_id = ?`,
        [userId],
        err => err ? reject(err) : resolve()
      );
    });

    // 3. Read updated weekly play days back from DB
    const dayRows = await dbAll(
      `SELECT day_of_week, is_play_day
       FROM user_play_days
       WHERE user_id = ?`,
      [userId]
    );

    const playDays = {};
    dayRows.forEach(r => {
      playDays[r.day_of_week] = r.is_play_day === 1;
    });

    // 4. Build updated monthly values
    const playMonths = {};
    for (let m = 1; m <= 12; m++) {
      playMonths[m] = true;
    }

    // 5. Return correct values to frontend
    res.json({
      playDays,
      playMonths,
      status: "default"
    });

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
      league_id: row.league_id,

      // ⭐ Preserve admin flags
      is_admin: req.session.user.is_admin,
      is_super_admin: req.session.user.is_super_admin,

      // ⭐ Preserve user/admin mode
      user_mode: req.session.user.user_mode
    };

    delete req.session.pendingUser;

    res.json({ success: true });
  } catch (err) {
    logger.error(err, "POST /user/select-league");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

module.exports.saveScheduleHandler = saveScheduleHandler;
module.exports.clearScheduleHandler = clearScheduleHandler;
module.exports.defaultScheduleHandler = defaultScheduleHandler;
