// routes/admin/golfers.js

const express = require("express");
const db = require("../../db");
const logger = require("../../utils/logger");
const { requireAdmin } = require("../../middleware/auth");

const path = require("path");

const router = express.Router();

// -----------------------------------------------------------------------------
// ADMIN GOLFERS PAGE
// -----------------------------------------------------------------------------
router.get("/", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/admin-golfers.html"));
});

// -----------------------------------------------------------------------------
// LIST GOLFERS (simple list for dropdowns)
// -----------------------------------------------------------------------------
router.get("/list", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/golfers/list");
  try {
    const rows = db.prepare(`
      SELECT id
           , first_name
           , last_name
           , email
        FROM users
       ORDER BY last_name
              , first_name
    `).all();
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
    const rows = db.prepare(`
      SELECT id
           , first_name
           , last_name
           , email
           , password_hash
           , is_admin
           , league_id
           , subgroup
           , subgroup_number
           , is_member
        FROM users
       ORDER BY last_name
              , first_name
    `).all();
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
      last_name
    , first_name
    , email
    , password_hash
    , is_admin
    , league_id
    , subgroup
    , subgroup_number
    , is_member
  } = req.body;

  try {
    const result = db.prepare(`
      INSERT INTO logins (
             last_name
           , first_name
           , email
           , password_hash
       )
       VALUES (?, ?, ?, ?)
    `).run(  last_name
           , first_name
           , email
           , password_hash
     );

     const result2 = db.prepare(`
       INSERT INTO league_users (
                is_admin
              , league_id
              , subgroup
              , subgroup_number
              , is_member
       )
        VALUES (?, ?, ?, ?, ?)
        `).run(  is_admin
               , league_id
               , subgroup
               , subgroup_number
               , is_member
         );

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
    const result = db.prepare(`
      UPDATE users
      SET last_name = ?, first_name = ?, email = ?,
          password_hash = ?, is_admin = ?, league_id = ?,
          subgroup = ?, subgroup_number = ?, is_member = ?
      WHERE id = ?
    `).run(
      last_name, first_name, email,
      password_hash, is_admin, league_id,
      subgroup, subgroup_number, is_member,
      id
    );

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
    const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
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
    const row = db.prepare(
      `SELECT play_days FROM user_play_days WHERE user_id = ?`
    ).get(id);
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
    insertStmt = db.prepare(`
      INSERT INTO user_play_days (user_id, league_id, day_of_week, is_play_day)
      VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, league_id, day_of_week) 
          DO UPDATE 
                SET is_play_day = excluded.is_play_day
    `).run(id, req.body.league_id, req.body.day_of_week, req.body.is_play_day);

    logger.db("UPSERT user_play_days", { user_id: id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /golfers/api/:id/playdays");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;