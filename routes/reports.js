// routes/reports.js

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");
const { requireAdmin } = require("../middleware/auth");

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
// REPORT 1: AVAILABLE NEXT TWO WEEKS FOR A LEAGUE
// -----------------------------------------------------------------------------

router.get("/available-next-two-weeks/:leagueId", requireAdmin, async (req, res) => {
  logger.route("GET", "/reports/available-next-two-weeks/:leagueId");

  try {
    const { leagueId } = req.params;

    const today = new Date();
    const start = today.toISOString().slice(0, 10);

    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 14);
    const end = endDate.toISOString().slice(0, 10);

    const sql = `
      SELECT u.id, u.first_name, u.last_name, s.date
      FROM schedule s
      JOIN users u ON u.id = s.user_id
      WHERE u.league_id = ?
        AND s.is_playing = 1
        AND s.date BETWEEN ? AND ?
      ORDER BY s.date, u.last_name, u.first_name
    `;

    const rows = await dbAll(sql, [leagueId, start, end]);

    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.date]) grouped[r.date] = [];
      grouped[r.date].push({
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name
      });
    });

    res.json({ start, end, availability: grouped });

  } catch (err) {
    logger.error(err, "GET /reports/available-next-two-weeks/:leagueId");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// REPORT 2: AVAILABLE ON A SPECIFIC DATE
// -----------------------------------------------------------------------------

router.get("/available-date/:leagueId/:date", requireAdmin, async (req, res) => {
  logger.route("GET", "/reports/available-date/:leagueId/:date");

  try {
    const { leagueId, date } = req.params;

    const sql = `
      SELECT u.id, u.first_name, u.last_name
      FROM schedule s
      JOIN users u ON u.id = s.user_id
      WHERE u.league_id = ?
        AND s.date = ?
        AND s.is_playing = 1
      ORDER BY u.last_name, u.first_name
    `;

    const rows = await dbAll(sql, [leagueId, date]);

    res.json({
      date,
      available: rows
    });

  } catch (err) {
    logger.error(err, "GET /reports/available-date/:leagueId/:date");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;