// routes/admin/golfers.js
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
// LIST GOLFERS (simple list for dropdowns)
// -----------------------------------------------------------------------------
router.get("/list", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/golfers/list");
  try {
    const rows = await dbAll(`
      SELECT id, first_name, last_name, email
      FROM users
      ORDER BY last_name, first_name
    `);
    res.json({ golfers: rows });
  } catch (err) {
    logger.error(err, "Admin GET /golfers/list");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// FULL GOLFER LIST
// -----------------------------------------------------------------------------
router.get("/api", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/golfers/api");
  try {
    const rows = await dbAll(`
      SELECT id, first_name, last_name, email,
             password_hash, is_admin, league_id,
             subgroup, subgroup_number, is_member
      FROM users
      ORDER BY last_name, first_name
    `);
    res.json({ golfers: rows });
  } catch (err) {
    logger.error(err, "Admin GET /golfers/api");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// CREATE GOLFER
// -----------------------------------------------------------------------------
router.post("/api", requireAdmin, async (req, res) => {
  logger.route("POST", "/admin/golfers/api");
  const {
    last_name, first_name, email,
    password_hash, is_admin, league_id,
    subgroup, subgroup_number, is_member
  } = req.body;

  try {
    const result = await dbRun(`
      INSERT INTO users (
        last_name, first_name, email,
        password_hash, is_admin, league_id,
        subgroup, subgroup_number, is_member
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      last_name, first_name, email,
      password_hash, is_admin, league_id,
      subgroup, subgroup_number, is_member
    ]);

    logger.db("INSERT golfer", { id: result.lastID });
    res.json({ success: true, id: result.lastID });
  } catch (err) {
    logger.error(err, "Admin POST /golfers/api");
    res.status(500).json({ error: "Insert failed" });
  }
});

// -----------------------------------------------------------------------------
// UPDATE GOLFER
// -----------------------------------------------------------------------------
router.put("/api/:id", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/golfers/api/:id");
  const { id } = req.params;
  const {
    last_name, first_name, email,
    password_hash, is_admin, league_id,
    subgroup, subgroup_number, is_member
  } = req.body;

  try {
    const result = await dbRun(`
      UPDATE users
      SET last_name = ?, first_name = ?, email = ?,
          password_hash = ?, is_admin = ?, league_id = ?,
          subgroup = ?, subgroup_number = ?, is_member = ?
      WHERE id = ?
    `, [
      last_name, first_name, email,
      password_hash, is_admin, league_id,
      subgroup, subgroup_number, is_member,
      id
    ]);

    logger.db("UPDATE golfer", { id, changes: result.changes });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /golfers/api/:id");
    res.status(500).json({ error: "Update failed" });
  }
});

// -----------------------------------------------------------------------------
// DELETE GOLFER
// -----------------------------------------------------------------------------
router.delete("/api/:id", requireAdmin, async (req, res) => {
  logger.route("DELETE", "/admin/golfers/api/:id");
  const { id } = req.params;

  try {
    const result = await dbRun(`DELETE FROM users WHERE id = ?`, [id]);
    logger.db("DELETE golfer", { id, changes: result.changes });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin DELETE /golfers/api/:id");
    res.status(500).json({ error: "Delete failed" });
  }
});

// -----------------------------------------------------------------------------
// LEGACY PLAY DAYS (if still used)
// -----------------------------------------------------------------------------
router.get("/api/:id/playdays", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/golfers/api/:id/playdays");
  const { id } = req.params;

  try {
    const row = await dbGet(
      "SELECT play_days FROM user_play_days WHERE user_id = ?",
      [id]
    );
    res.json({ play_days: row ? row.play_days : "" });
  } catch (err) {
    logger.error(err, "Admin GET /golfers/api/:id/playdays");
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/:id/playdays", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/golfers/api/:id/playdays");
  const { id } = req.params;
  const { play_days } = req.body;

  try {
    await dbRun(`
      INSERT INTO user_play_days (user_id, play_days)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET play_days = excluded.play_days
    `, [id, play_days]);

    logger.db("UPSERT user_play_days", { user_id: id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /golfers/api/:id/playdays");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;