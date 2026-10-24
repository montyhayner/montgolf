// routes/availability.js

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");
const { requireLogin, requireAdminOrSelf } = require("../middleware/auth");

// -----------------------------------------------------------------------------
// GET USER AVAILABILITY (play days + play months)
// -----------------------------------------------------------------------------

router.get("/", requireLogin, async (req, res) => {
  logger.route("GET", "/availability");

  try {
    const userId = req.session.user.id;

    const playDaysRows = db.prepare(
      `SELECT day_of_week, is_play_day FROM user_play_days WHERE user_id = ?`
    ).all(userId);

    const playMonthsRows = db.prepare(
      `SELECT month, in_town FROM user_play_months WHERE user_id = ?`
    ).all(userId);

    const playDays = {};
    playDaysRows.forEach(r => {
      playDays[r.day_of_week] = r.is_play_day === 1;
    });

    const playMonths = {};
    playMonthsRows.forEach(r => {
      playMonths[r.month] = r.in_town === 1;
    });

    res.json({ playDays, playMonths });

  } catch (err) {
    logger.error(err, "GET /availability");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// UPDATE USER PLAY DAYS (admin or self)
// -----------------------------------------------------------------------------

router.put("/play-days/:userId", requireLogin, requireAdminOrSelf, async (req, res) => {
  logger.route("PUT", "/availability/play-days/:userId");

  const { userId } = req.params;
  const { days } = req.body;

  if (!Array.isArray(days) || days.length !== 7) {
    return res.status(400).json({ error: "Must provide 7 day objects" });
  }

  try {
    // Step 1: Get user's league
    const userRow = db.prepare(`
      SELECT league_id
      FROM users
      WHERE id = ?
    `).get(userId);

    if (!userRow) {
      return res.status(404).json({ error: "User not found" });
    }

    const leagueId = userRow.league_id;

    // Step 2: Get league play days
    const leagueRows = db.prepare(`
      SELECT day_of_week
      FROM league_play_days
      WHERE league_id = ?
        AND is_play_day = 1
    `).all(leagueId);

    const allowedDays = leagueRows.map(r => r.day_of_week);

    // Step 3: Validate user-submitted days
    for (const d of days) {
      if (d.is_play_day === 1 && !allowedDays.includes(d.day_of_week)) {
        return res.status(400).json({
          error: `Day ${d.day_of_week} is not a valid play day for this league`
        });
      }
    }

    // Step 4: Upsert rows
    const stmt = db.prepare(`
      INSERT INTO user_play_days (
        user_id,
        day_of_week,
        is_play_day
      )
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, day_of_week)
      DO UPDATE SET
        is_play_day = excluded.is_play_day
    `);

    const upsertDays = db.transaction(days => {
      for (const d of days) {
        stmt.run(
          userId,
          d.day_of_week,
          d.is_play_day
        );
      }
    });

    upsertDays(days);

    logger.db("UPSERT user_play_days", { userId });

    res.json({ success: true });

  } catch (err) {
    logger.error("Error updating user_play_days", err);

    res.status(500).json({
      error: "Failed to update play days"
    });
  }
});

// -----------------------------------------------------------------------------
// UPDATE USER PLAY MONTHS (admin or self)
// -----------------------------------------------------------------------------

router.put("/play-months/:userId", requireLogin, requireAdminOrSelf, async (req, res) => {
  logger.route("PUT", "/availability/play-months/:userId");

  const { userId } = req.params;
  const { months } = req.body; // [{ month: 1, in_town: 1 }, ...]

  if (!Array.isArray(months)) {
    return res.status(400).json({ error: "Must provide an array of month objects" });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO user_play_months (user_id, month, in_town)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, month)
      DO UPDATE SET in_town = excluded.in_town
    `);

    months.forEach(m => {
      stmt.run(userId, m.month, m.in_town);
    });

    logger.db("UPSERT user_play_months", { userId });
    res.json({ success: true });

  } catch (err) {
    logger.error(err, "PUT /availability/play-months/:userId");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// DEFAULT AVAILABILITY (optional endpoint)
// -----------------------------------------------------------------------------

router.post("/default", requireLogin, async (req, res) => {
  logger.route("POST", "/availability/default");

  try {
    const userId = req.session.user.id;

    // Default: all league play days ON, all months in-town
    const leagueId = req.session.user.league_id;

    const leagueDays = db.prepare(
      `SELECT day_of_week FROM league_play_days WHERE league_id = ? AND is_play_day = 1`
    ).all(leagueId);

    const stmtMonths = db.prepare(`
      INSERT INTO user_play_months (user_id, month, in_town)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id, month)
      DO UPDATE SET in_town = 1
    `);

    const stmtDays = db.prepare(`
      INSERT INTO user_play_days (user_id, day_of_week)
      VALUES (?, ?)
      ON CONFLICT(user_id, day_of_week)
      DO NOTHING
    `);

    const transaction = db.transaction(() => {
      leagueDays.forEach(d => {
        stmtDays.run(userId, d.day_of_week);
      });

      for (let m = 1; m <= 12; m++) {
        stmtMonths.run(userId, m);
      }
    });

    transaction();

    logger.db("DEFAULT availability set", { userId });
    res.json({ success: true });

  } catch (err) {
    logger.error(err, "POST /availability/default");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
