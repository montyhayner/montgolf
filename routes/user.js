// routes/user.js

const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../db");
const logger = require("../utils/logger");
const { requireLogin } = require("../middleware/auth");
const { easternNow } = require("../utils/easternTime");

// Services
const {
  getTwoWeekReport,
  sendTwoWeekReportEmail,
  getLatestTeeSheet,
  sendLatestTeeSheetEmail
} = require("../services/reportHandlers");

// ============================================================================
// INIT ROUTE
// ============================================================================
router.get("/schedule/init", (req, res) => {
  try {
    const easternTS = easternNow();
    return res.json({ status: "ok", easternTS });
  } catch (err) {
    return res.status(500).json({ error: "Server error getting eastern timezone timestamp" });
  }
});

// ============================================================================
// SAVE USER SCHEDULE (with schedule_history logging)
// ============================================================================
async function saveScheduleHandler(req, res) {
  logger.route("PUT", "/user/schedule/:year/:month");
  console.log(">>> BACKEND SAVE incoming schedule:", req.body.schedule);
  console.log(">>> BACKEND SAVE incoming status:", req.body.status);

  try {

    const targetUserId = req.session.user.id;
    const targetUserEmail = req.session.user.email;
    const leagueId = req.session.user.league_id;

    const { year, month } = req.params;
    const { schedule, sessionStartTS } = req.body;

    const source = "user";
    const transactn = db.transaction(() => {
      // Validate allowed league play days
      const leagueDaysRows = db.prepare(`
        SELECT day_of_week
          FROM league_play_days
          WHERE league_id = ?
            AND is_play_day = 1
      `).all(leagueId);

      const allowedDays = leagueDaysRows.map(r => r.day_of_week);
      const invalidSelections = [];

      for (const [date, isPlaying] of Object.entries(schedule)) {
        if (!isPlaying) continue;
        const [y, m, d] = date.split("-");
        const dow = new Date(y, m - 1, d).getDay();
        if (!allowedDays.includes(dow)) invalidSelections.push(date);
      }

      if (invalidSelections.length > 0) {
        return res.status(400).json({
          error: "Invalid days selected",
          invalidDates: invalidSelections
        });
      }

      // Load existing schedule
      const pad = n => String(n).padStart(2, "0");
      const prefix = `${year}-${pad(month)}-`;

      const existingRows = db.prepare(`
        SELECT date, is_playing
          FROM schedule
        WHERE user_id = ?
          AND league_id = ?
          AND date LIKE ?
      `).all(targetUserId, leagueId, `${prefix}%`);

      const existingMap = {};
      for (const row of existingRows) {
        existingMap[row.date] = row.is_playing;
      }

      // Prepare statements
      // Prepare UPSERT statement for schedule_history
      const historyUpsertStmt = db.prepare(`
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
            old_is_playing = excluded.old_is_playing,
            new_is_playing = excluded.new_is_playing,
            before_state = excluded.before_state,
            after_state = excluded.after_state,
            changed_by = excluded.changed_by,
            source = excluded.source
      `);

      // Prepare UPSERT statement for schedule table
      const scheduleStmt = db.prepare(`
        INSERT INTO schedule (user_id, league_id, date, is_playing, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, league_id, date)
        DO UPDATE SET
            is_playing = excluded.is_playing,
            updated_at = excluded.updated_at
      `);

      // Apply changes — ONLY during Save
      for (const [date, newVal] of Object.entries(schedule)) {
        const oldVal = existingMap[date] ?? 0;
        const newInt = newVal ? 1 : 0;

        if (oldVal !== newInt) {
          historyUpsertStmt.run(
            targetUserId,
            leagueId,
            date,
            oldVal,
            newInt,
            targetUserEmail,
            sessionStartTS,   // SAME timestamp for entire session
            source,
            JSON.stringify({ is_playing: oldVal }),
            JSON.stringify({ is_playing: newInt })
          );

          scheduleStmt.run(
            targetUserId,
            leagueId,
            date,
            newInt,
            sessionStartTS
          );
        }
      }

      // Update user_play_months
      const insertStmt = db.prepare(`
        INSERT INTO user_play_months (user_id, league_id, month, in_town, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, league_id, month)
        DO UPDATE 
              SET in_town = 1
                , updated_at = excluded.updated_at
        `).run(targetUserId, leagueId, month, 1, sessionStartTS);
    })

    // Commit transaction    
    transactn();    

    const responseObj = {
      status: "saved",
      schedule,
      edited_by: targetUserEmail,
      edited_user: targetUserEmail
    };

    console.log(">>> BACKEND SAVE returning:", responseObj);

    return res.json(responseObj);

  } catch (err) {
    logger.error(err, "PUT /user/schedule/:year/:month");
    res.status(500).json({ error: err.message });
  }
}

router.put("/schedule/:year/:month", requireLogin, saveScheduleHandler);

// ============================================================================
// CLEAR SCHEDULE (Supports ADMIN OVERRIDE)
// ============================================================================
async function clearScheduleHandler(req, res) {
  logger.route("POST", "/user/schedule/clear/:year/:month");

  const isAdmin = req.session.user.is_admin === 1;
  let targetUserId = req.session.user.id;

  if (isAdmin && req.body?.target_user_id) {
    targetUserId = parseInt(req.body.target_user_id);
  }

  const adminEmail = req.session.user.email;
  const leagueId = req.session.user.league_id;
  const { year, month } = req.params;

  const pad = n => String(n).padStart(2, "0");
  const prefix = `${year}-${pad(month)}-`;

  try {
    const existingRows = db.prepare(`
      SELECT date
            , is_playing
         FROM schedule
        WHERE user_id = ?
          AND league_id = ?
          AND date LIKE ?
    `).all(targetUserId, leagueId, `${prefix}%`);

    const ts = easternNow();

    const deleteStmt = db.prepare(`
       DELETE FROM schedule
       WHERE user_id = ?
         AND league_id = ?
         AND date LIKE ?
       `).run(targetUserId, leagueId, `${prefix}%`);

    return res.json({
      status: "cleared",
      schedule: {},
      target_user_id: targetUserId
    });

  } catch (err) {
    logger.error(err, "POST /user/schedule/clear/:year/:month");
    res.status(500).json({ error: err.message });
  }
}

router.post("/schedule/clear/:year/:month", requireLogin, clearScheduleHandler);

// ============================================================================
// DEFAULT SCHEDULE (Supports ADMIN OVERRIDE)
// ============================================================================
async function defaultScheduleHandler(req, res) {
  logger.route("POST", "/user/schedule/default/:year/:month");

  const isAdmin = req.session.user.is_admin === 1;
  let targetUserId = req.session.user.id;

  if (isAdmin && req.body?.target_user_id) {
    targetUserId = parseInt(req.body.target_user_id);
  }
  const leagueId = req.session.user.league_id;
  const { year, month } = req.params;

  try {
    const monthRow = db.prepare(`
       SELECT in_town
         FROM user_play_months
        WHERE user_id = ? 
          AND league_id = ?
          AND month = ?
    `).get(targetUserId, leagueId, month);

    let isInTown = monthRow?.in_town === 1;

    if (!isInTown) {
      return res.json({ status: "out_of_town" });
    }

    const dayRows = db.prepare(`
       SELECT day_of_week
         FROM user_play_days
        WHERE user_id = ?
          AND league_id = ?
          AND is_play_day = 1
    `).all([targetUserId, leagueId]);

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

router.post("/schedule/default/:year/:month", requireLogin, defaultScheduleHandler);

// ============================================================================
// USER INFO
// ============================================================================
router.get("/info", requireLogin, (req, res) => {
  const user = req.session.user;
  res.json({
    user: {
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email
    }
  });
});

// ============================================================================
// USER REPORTS
// ============================================================================
router.get("/reports/two-week", requireLogin, getTwoWeekReport);
router.post("/reports/two-week/email", requireLogin, sendTwoWeekReportEmail);

router.get("/reports/latest-tee-sheet", requireLogin, getLatestTeeSheet);
router.post("/reports/latest-tee-sheet/email", requireLogin, sendLatestTeeSheetEmail);

// ============================================================================
// SELECTED LEAGUE
// ============================================================================
router.get("/selected-league", requireLogin, (req, res) => {
  const leagueId = req.session.user.league_id;

  const row = db.prepare(`
    SELECT id
         , league_name 
      FROM leagues 
     WHERE id = ?
  `).get([leagueId]);

  res.json({ league: row });
});

// ============================================================================
// PROFILE PAGES
// ============================================================================
const path = require("path");

router.get("/edit-profile", requireLogin, (req, res) => {
  res.sendFile(path.resolve("public/user-edit-profile.html"));
});

router.get("/change-password", requireLogin, (req, res) => {
  res.sendFile(path.resolve("public/user-change-password.html"));
});

// ============================================================================
// LAST VIEWED SCHEDULE MONTH
// ============================================================================
router.get("/schedule", requireLogin, (req, res) => {
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
  const leagueId = req.session.user.league_id;
  const { year, month } = req.params;

  const pad = n => String(n).padStart(2, "0");
  const prefix = `${year}-${pad(month)}-`;

  try {
    const monthRow = db.prepare(`
       SELECT in_town
         FROM user_play_months
        WHERE user_id = ? 
          AND league_id = ?
          AND month = ?
    `).get([userId, leagueId, month]);

    const inTown = monthRow?.in_town === 1;

    const leagueRows = db.prepare(`
       SELECT day_of_week
         FROM league_play_days
        WHERE league_id = ? 
          AND is_play_day = 1
       `).all(leagueId);

    const leaguePlayDays = leagueRows.map(r => r.day_of_week);

    const rows = db.prepare(
      `SELECT date
            , is_playing
         FROM schedule
        WHERE user_id = ?
          AND league_id = ?
          AND date LIKE ?
      `).all(userId, leagueId, `${prefix}%`);

    if (!inTown) {
      return res.json({
        schedule: {},
        status: "out_of_town",
        in_town: 0,
        leaguePlayDays
      });
    }

    if (rows.length === 0) {
      return res.json({
        schedule: {},
        status: "new",
        in_town: 1,
        leaguePlayDays
      });
    }

    const allZero = rows.every(r => r.is_playing === 0);

    if (allZero) {
      return res.json({
        schedule: {},
        status: "cleared",
        in_town: 1,
        leaguePlayDays
      });
    }

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

// ============================================================================
// SESSION INFO
// ============================================================================
router.get("/session-info", requireLogin, (req, res) => {
  const user = req.session.user;
  res.json({
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email
  });
});

// ============================================================================
// AVAILABILITY — GET
// ============================================================================
router.get("/availability", requireLogin, async (req, res) => {
  logger.route("GET", "/user/availability");

  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;

  try {
    const leagueDaysRows = db.prepare(`
      SELECT day_of_week
        FROM league_play_days
        WHERE league_id = ? 
          AND is_play_day = 1
    `).all(leagueId);

    const leaguePlayDays = leagueDaysRows.map(r => r.day_of_week);
    const leaguePlayMonths = Array.from({ length: 12 }, (_, i) => i + 1); 

    let playDaysRows = db.prepare(`
      SELECT day_of_week
            , is_play_day
        FROM user_play_days
        WHERE user_id = ?
          AND league_id = ?
      `).all(userId, leagueId);

    let playMonthsRows = db.prepare(`
      SELECT month, in_town
        FROM user_play_months
      WHERE user_id = ?
        AND league_id = ?
    `).all(userId, leagueId);

    if (playDaysRows.length === 0) {
      for (let dow = 0; dow < 7; dow++) {
        const isPlay = leaguePlayDays.includes(dow) ? 1 : 0;
        const insertStmt = db.prepare(
          `INSERT INTO user_play_days (
                      user_id
                    , league_id
                    , day_of_week
                    , is_play_day)
                VALUES (?, ?, ?, ?)
          `).run(userId, leagueId, dow, isPlay);
      }

      const playDaysRows = db.prepare(`
        SELECT day_of_week
              , is_play_day
          FROM user_play_days
          WHERE user_id = ?
            AND league_id = ?
      `).all(userId, leagueId);
    }

    let isInTown = 1;

    if (playMonthsRows.length < 12) {
      const existingMonths = new Set(playMonthsRows.map(r => r.month));

      for (let m = 1; m <= 12; m++) {
        if (!existingMonths.has(m)) {
          const insertStatement = db.prepare(`
            INSERT INTO user_play_months 
                        (user_id
                      , league_id
                      , month
                      , in_town)
            VALUES (?, ?, ?, ?)
            `).run(userId, leagueId, m, isInTown);
        }
      }

      const playMonthsRows = db.prepare(`
        SELECT month, in_town
          FROM user_play_months
        WHERE user_id = ?
          AND league_id = ?
      `).all(userId, leagueId);
    }  

    const playDays = Object.fromEntries(
      playDaysRows.map(r => [r.day_of_week, r.is_play_day === 1])
    );

    const playMonths = Object.fromEntries(
      playMonthsRows.map(r => [r.month, r.in_town === 1])
    );

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

// ============================================================================
// AVAILABILITY — PUT
// ============================================================================
router.put("/availability", requireLogin, async (req, res) => {
  logger.route("PUT", "/user/availability");

  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;
  const { playDays, playMonths } = req.body;

  try {
    const updateTransaction = db.transaction(() => {

      const rows = db.prepare(`
         SELECT day_of_week
           FROM league_play_days
          WHERE league_id = ? 
            AND is_play_day = 1
      `).all(leagueId);

      const allowedDays = rows.map(r => r.day_of_week);

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

      const stmtDays = db.prepare(`
        UPDATE user_play_days
          SET is_play_day = ?
        WHERE user_id = ? 
          AND league_id = ? 
          AND day_of_week = ?
      `);

      for (const [dow, val] of Object.entries(playDays)) {
        stmtDays.run(val ? 1 : 0, userId, leagueId, dow);
      }
          // 4. Update monthly in-town
      const stmtMonths = db.prepare(`
        UPDATE user_play_months
          SET in_town = ?
        WHERE user_id = ? 
          AND league_id = ? 
          AND month = ?
      `);

      for (const [month, val] of Object.entries(playMonths)) {
        stmtMonths.run(val ? 1 : 0, userId, leagueId, Number(month));
      }
    }); 

    // Commit transaction
    updateTransaction();

    // 5. Success
    res.json({ success: true });

  } catch (err) {
    logger.error(err, "PUT /user/availability");
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AVAILABILITY DEFAULT (reset to league defaults)
// ============================================================================
router.post("/availability/default", requireLogin, async (req, res) => {
  logger.route("POST", "/user/availability/default");

  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;

  try {
    // Reset weekly play days to league defaults

    db.prepare(`
      UPDATE user_play_days
        SET is_play_day = COALESCE((
                          SELECT is_play_day
                            FROM league_play_days
                            WHERE league_play_days.league_id = ?
                              AND league_play_days.day_of_week = user_play_days.day_of_week
                          ), 0)
      WHERE user_id = ?
        AND league_id = ?
    `).run(leagueId, userId, leagueId);

    // Reset all months to in-town
    db.prepare(`
      UPDATE user_play_months
        SET in_town = 1
      WHERE user_id = ?
        AND league_id = ?
    `).run(userId, leagueId);

    // Reload updated weekly play days
    const dayRows = db.prepare(
      `SELECT day_of_week, is_play_day
        FROM user_play_days
        WHERE user_id = ?
          AND league_id = ?`
    ).all(userId, leagueId);

    const playDays = {};
    dayRows.forEach(r => {
      playDays[r.day_of_week] = r.is_play_day === 1;
    });

    // Build updated monthly values
    const playMonths = {};
    for (let m = 1; m <= 12; m++) {
      playMonths[m] = true;
    }

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

router.put("/edit-profile", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const leagueId = req.session.user.league_id;
  const { first_name, last_name, email } = req.body;

  try {
    // Check if email already exists for another user in the same league
    const existing = await db.prepare(`
       SELECT id 
         FROM users 
        WHERE email = ? 
          AND league_id = ? 
          AND id != ?
       `).get(email, leagueId, userId);

    if (existing) {
      return res.status(400).json({
        error: "That email is already used by another golfer in this league."
      });
    }

    // Update profile
    const updateStmt = db.prepare(`
       UPDATE logins 
          SET first_name = ?
            , last_name = ?
            , email = ? 
        WHERE id = ?
    `).run(first_name, last_name, email, userId);

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

// ============================================================================
// SAVE LAST VIEWED MONTH
// ============================================================================
router.post("/set-last-month", requireLogin, (req, res) => {
  logger.route("POST", "/user/set-last-month");

  const { year, month } = req.body;

  req.session.lastScheduleYear = year;
  req.session.lastScheduleMonth = month;

  res.json({ success: true });
});

// ============================================================================
// MULTI-LEAGUE USER — SELECT LEAGUE
// ============================================================================
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
      is_admin: req.session.user.is_admin,
      is_super_admin: req.session.user.is_super_admin,
      user_mode: req.session.user.user_mode
    };

    delete req.session.pendingUser;

    res.json({ success: true });

  } catch (err) {
    logger.error(err, "POST /user/select-league");
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// EXPORT HANDLERS
// ============================================================================
module.exports = router;
module.exports.saveScheduleHandler = saveScheduleHandler;
module.exports.clearScheduleHandler = clearScheduleHandler;
module.exports.defaultScheduleHandler = defaultScheduleHandler;
