// routes/admin/schedule.js
const express = require("express");
const db = require("../../db");
const logger = require("../../utils/logger");
const { requireAdmin } = require("../../middleware/auth");

const router = express.Router();

// DB helpers
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
// GET A USER'S SCHEDULE FOR A MONTH
// -----------------------------------------------------------------------------
router.get("/api/:userId/:year/:month", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/schedule/api/:userId/:year/:month");

  const userId = parseInt(req.params.userId, 10);
  const year = parseInt(req.params.year, 10);
  const month = parseInt(req.params.month, 10);

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-31`;

  try {
    const rows = await dbAll(`
      SELECT date, is_playing
      FROM schedule
      WHERE user_id = ? AND date BETWEEN ? AND ?
    `, [userId, start, end]);

    const schedule = {};
    rows.forEach(r => schedule[r.date] = r.is_playing);

    res.json(schedule);
  } catch (err) {
    logger.error(err, "Admin GET /schedule/api/:userId/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// UPDATE A USER'S SCHEDULE (ADMIN EDIT)
// -----------------------------------------------------------------------------
router.put("/api", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/schedule/api");

  const { user_id, schedule } = req.body;

  if (!user_id || typeof schedule !== "object") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO schedule (user_id, date, is_playing)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, date)
      DO UPDATE SET is_playing = excluded.is_playing
    `);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        Object.entries(schedule).forEach(([date, isPlaying]) => {
          stmt.run(user_id, date, isPlaying ? 1 : 0);
        });
        stmt.finalize(err => err ? reject(err) : resolve());
      });
    });

    logger.db("UPSERT schedule (admin)", { user_id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /schedule/api");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;