// routes/admin/leagues.js
const express = require("express");
const db = require("../../db");
const logger = require("../../utils/logger");
const { requireAdmin } = require("../../middleware/auth");

const router = express.Router();

// DB helpers
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

// -----------------------------------------------------------------------------
// CREATE LEAGUE
// -----------------------------------------------------------------------------
router.post("/api", requireAdmin, async (req, res) => {
  logger.route("POST", "/admin/leagues/api");
  const { league_name, coordinator_last_name, coordinator_first_name } = req.body;

  try {
    const result = await dbRun(`
      INSERT INTO leagues (league_name, coordinator_last_name, coordinator_first_name)
      VALUES (?, ?, ?)
    `, [league_name, coordinator_last_name, coordinator_first_name]);

    logger.db("INSERT leagues", { id: result.lastID });
    res.json({
      id: result.lastID,
      league_name,
      coordinator_last_name,
      coordinator_first_name
    });
  } catch (err) {
    logger.error(err, "Admin POST /leagues/api");
    res.status(400).json({ error: "League name must be unique" });
  }
});

// -----------------------------------------------------------------------------
// UPDATE LEAGUE
// -----------------------------------------------------------------------------
router.put("/api/:id", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/leagues/api/:id");
  const { id } = req.params;
  const { league_name, coordinator_last_name, coordinator_first_name } = req.body;

  try {
    const result = await dbRun(`
      UPDATE leagues
      SET league_name = ?, coordinator_last_name = ?, coordinator_first_name = ?
      WHERE id = ?
    `, [league_name, coordinator_last_name, coordinator_first_name, id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    logger.db("UPDATE leagues", { id, changes: result.changes });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /leagues/api/:id");
    res.status(400).json({ error: "League name must be unique" });
  }
});

// -----------------------------------------------------------------------------
// DELETE LEAGUE
// -----------------------------------------------------------------------------
router.delete("/api/:id", requireAdmin, async (req, res) => {
  logger.route("DELETE", "/admin/leagues/api/:id");
  const { id } = req.params;

  try {
    const result = await dbRun("DELETE FROM leagues WHERE id = ?", [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    logger.db("DELETE leagues", { id, changes: result.changes });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin DELETE /leagues/api/:id");
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------------------------------------------------------
// GET LEAGUE PLAY DAYS
// -----------------------------------------------------------------------------
router.get("/:leagueId/play-days", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/leagues/:leagueId/play-days");
  const { leagueId } = req.params;

  try {
    const rows = await dbAll(`
      SELECT id, league_id, day_of_week, is_play_day
      FROM league_play_days
      WHERE league_id = ?
      ORDER BY day_of_week
    `, [leagueId]);

    res.json({ playDays: rows });
  } catch (err) {
    logger.error(err, "Admin GET /leagues/:leagueId/play-days");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// UPDATE LEAGUE PLAY DAYS
// -----------------------------------------------------------------------------
router.put("/api/play-days/:leagueId", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/leagues/api/play-days/:leagueId");
  const { leagueId } = req.params;
  const { days } = req.body;

  if (!Array.isArray(days) || days.length !== 7) {
    return res.status(400).json({ error: "Must provide 7 day objects" });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO league_play_days (league_id, day_of_week, is_play_day)
      VALUES (?, ?, ?)
      ON CONFLICT(league_id, day_of_week)
      DO UPDATE SET is_play_day = excluded.is_play_day
    `);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        days.forEach(d => stmt.run([leagueId, d.day_of_week, d.is_play_day]));
        stmt.finalize(err => err ? reject(err) : resolve());
      });
    });

    logger.db("UPSERT league_play_days", { leagueId });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /leagues/api/play-days/:leagueId");
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;