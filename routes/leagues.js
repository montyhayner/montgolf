// routes/leagues.js

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");

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

// -----------------------------------------------------------------------------
// GET ALL LEAGUES
// -----------------------------------------------------------------------------

router.get("/", async (req, res) => {
  logger.route("GET", "/leagues");

  try {
    const sql = `
      SELECT id, league_name, coordinator_last_name, coordinator_first_name
      FROM leagues
      ORDER BY league_name
    `;

    const rows = await dbAll(sql);
    res.json({ leagues: rows });

  } catch (err) {
    logger.error(err, "GET /leagues");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET SINGLE LEAGUE BY ID
// -----------------------------------------------------------------------------

router.get("/:id", async (req, res) => {
  logger.route("GET", "/leagues/:id");

  try {
    const { id } = req.params;

    const row = await dbGet(
      `SELECT id, league_name, coordinator_last_name, coordinator_first_name
       FROM leagues
       WHERE id = ?`,
      [id]
    );

    if (!row) {
      return res.status(404).json({ error: "League not found" });
    }

    res.json({ league: row });

  } catch (err) {
    logger.error(err, "GET /leagues/:id");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET LEAGUE PLAY DAYS (READ-ONLY)
// -----------------------------------------------------------------------------

router.get("/:id/play-days", async (req, res) => {
  logger.route("GET", "/leagues/:id/play-days");

  try {
    const { id } = req.params;

    const rows = await dbAll(
      `SELECT day_of_week, is_play_day
       FROM league_play_days
       WHERE league_id = ?
       ORDER BY day_of_week`,
      [id]
    );

    res.json({ playDays: rows });

  } catch (err) {
    logger.error(err, "GET /leagues/:id/play-days");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;