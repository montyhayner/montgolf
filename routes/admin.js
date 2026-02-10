// routes/admin.js

const express = require("express");
const path = require("path");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const logger = require("../utils/logger");

const router = express.Router();

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
// ADMIN HTML PAGES
// -----------------------------------------------------------------------------

// Dashboard
router.get("/", requireAdmin, (req, res) => {
  logger.route("GET", "/admin");
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

// Users page
router.get("/users", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/users");
  res.sendFile(path.join(__dirname, "../public/admin-users.html"));
});

// Leagues page
router.get("/leagues", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/leagues");
  res.sendFile(path.join(__dirname, "../public/admin-leagues.html"));
});

// Play months page
router.get("/play-months", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/play-months");
  res.sendFile(path.join(__dirname, "../public/admin-play-months.html"));
});

// Play days page
router.get("/play-days", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/play-days");
  res.sendFile(path.join(__dirname, "../public/admin-play-days.html"));
});

// Admin nav partial (served under /admin/partials/nav)
router.get("/partials/nav", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/partials/nav");
  res.sendFile(path.join(__dirname, "../public/partials/admin-nav.html"));
});

// -----------------------------------------------------------------------------
// ADMIN USERS API
// -----------------------------------------------------------------------------

// Simple list for dropdowns (already existed)
router.get("/users/list", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/users/list");
  try {
    const sql = `
      SELECT id, first_name, last_name, email
      FROM users
      ORDER BY last_name, first_name
    `;
    const rows = await dbAll(sql);
    res.json({ users: rows });
  } catch (err) {
    logger.error(err, "Admin GET /users/list");
    res.status(500).json({ error: err.message });
  }
});

// Full admin user list
router.get("/api/users", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/api/users");
  try {
    const sql = `
      SELECT id, first_name, last_name, email,
             password_hash, is_admin, league_id,
             subgroup, subgroup_number, is_member
      FROM users
      ORDER BY last_name, first_name
    `;
    const rows = await dbAll(sql);
    res.json({ users: rows });
  } catch (err) {
    logger.error(err, "Admin GET /api/users");
    res.status(500).json({ error: err.message });
  }
});

// Create user
router.post("/api/users", requireAdmin, async (req, res) => {
  logger.route("POST", "/admin/api/users");
  const {
    last_name,
    first_name,
    email,
    password_hash,
    is_admin,
    league_id,
    subgroup,
    subgroup_number,
    is_member
  } = req.body;

  try {
    const sql = `
      INSERT INTO users (
        last_name, first_name, email,
        password_hash, is_admin, league_id,
        subgroup, subgroup_number, is_member
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await dbRun(sql, [
      last_name,
      first_name,
      email,
      password_hash,
      is_admin,
      league_id,
      subgroup,
      subgroup_number,
      is_member
    ]);

    logger.db("INSERT users", { id: result.lastID });
    res.json({ success: true, id: result.lastID });
  } catch (err) {
    logger.error(err, "Admin POST /api/users");
    res.status(500).json({ error: "Insert failed" });
  }
});

// Update user
router.put("/api/users/:id", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/api/users/:id");
  const {
    last_name,
    first_name,
    email,
    password_hash,
    is_admin,
    league_id,
    subgroup,
    subgroup_number,
    is_member
  } = req.body;
  const { id } = req.params;

  try {
    const sql = `
      UPDATE users
      SET last_name = ?, first_name = ?, email = ?,
          password_hash = ?, is_admin = ?, league_id = ?,
          subgroup = ?, subgroup_number = ?, is_member = ?
      WHERE id = ?
    `;
    const result = await dbRun(sql, [
      last_name,
      first_name,
      email,
      password_hash,
      is_admin,
      league_id,
      subgroup,
      subgroup_number,
      is_member,
      id
    ]);

    logger.db("UPDATE users", { id, changes: result.changes });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    logger.error(err, "Admin PUT /api/users/:id");
    res.status(500).json({ error: "Update failed" });
  }
});

// Delete user
router.delete("/api/users/:id", requireAdmin, async (req, res) => {
  logger.route("DELETE", "/admin/api/users/:id");
  const { id } = req.params;

  try {
    const sql = `DELETE FROM users WHERE id = ?`;
    const result = await dbRun(sql, [id]);
    logger.db("DELETE users", { id, changes: result.changes });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    logger.error(err, "Admin DELETE /api/users/:id");
    res.status(500).json({ error: "Delete failed" });
  }
});

// Get legacy play_days blob for a user (if still used)
router.get("/api/users/:id/playdays", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/api/users/:id/playdays");
  const { id } = req.params;

  try {
    const sql = "SELECT play_days FROM user_play_days WHERE user_id = ?";
    const row = await dbGet(sql, [id]);
    res.json({ play_days: row ? row.play_days : "" });
  } catch (err) {
    logger.error(err, "Admin GET /api/users/:id/playdays");
    res.status(500).json({ error: err.message });
  }
});

// Update legacy play_days blob for a user
router.put("/api/users/:id/playdays", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/api/users/:id/playdays");
  const { id } = req.params;
  const { play_days } = req.body;

  try {
    const sql = `
      INSERT INTO user_play_days (user_id, play_days)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET play_days = excluded.play_days
    `;
    await dbRun(sql, [id, play_days]);
    logger.db("UPSERT user_play_days", { user_id: id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /api/users/:id/playdays");
    res.status(500).json({ error: err.message });
  }
});

// Add league membership for a user (multi-league support)
router.post("/api/user/add-league", requireAdmin, async (req, res) => {
  logger.route("POST", "/admin/api/user/add-league");
  const { email, league_id, password_hash } = req.body;

  try {
    const sql = `
      INSERT INTO users (email, league_id, password_hash)
      VALUES (?, ?, ?)
    `;
    await dbRun(sql, [email, league_id, password_hash]);
    logger.db("INSERT users (add-league)", { email, league_id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin POST /api/user/add-league");
    res.status(400).json({ error: err.message });
  }
});

// Remove league membership (delete user row)
router.post("/api/user/remove-league", requireAdmin, async (req, res) => {
  logger.route("POST", "/admin/api/user/remove-league");
  const { user_id } = req.body;

  try {
    const sql = `DELETE FROM users WHERE id = ?`;
    await dbRun(sql, [user_id]);
    logger.db("DELETE users (remove-league)", { user_id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin POST /api/user/remove-league");
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// ADMIN LEAGUES API
// -----------------------------------------------------------------------------

// Create league
router.post("/api/leagues", requireAdmin, async (req, res) => {
  logger.route("POST", "/admin/api/leagues");
  const { league_name, coordinator_last_name, coordinator_first_name } = req.body;

  try {
    const sql = `
      INSERT INTO leagues (league_name, coordinator_last_name, coordinator_first_name)
      VALUES (?, ?, ?)
    `;
    const result = await dbRun(sql, [
      league_name,
      coordinator_last_name,
      coordinator_first_name
    ]);

    logger.db("INSERT leagues", { id: result.lastID });
    res.json({
      id: result.lastID,
      league_name,
      coordinator_last_name,
      coordinator_first_name
    });
  } catch (err) {
    logger.error(err, "Admin POST /api/leagues");
    res.status(400).json({ error: "League name must be unique" });
  }
});

// Update league
router.put("/api/leagues/:id", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/api/leagues/:id");
  const { id } = req.params;
  const { league_name, coordinator_last_name, coordinator_first_name } = req.body;

  try {
    const sql = `
      UPDATE leagues
      SET league_name = ?, coordinator_last_name = ?, coordinator_first_name = ?
      WHERE id = ?
    `;
    const result = await dbRun(sql, [
      league_name,
      coordinator_last_name,
      coordinator_first_name,
      id
    ]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    logger.db("UPDATE leagues", { id, changes: result.changes });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /api/leagues/:id");
    res.status(400).json({ error: "League name must be unique" });
  }
});

// Delete league
router.delete("/api/leagues/:id", requireAdmin, async (req, res) => {
  logger.route("DELETE", "/admin/api/leagues/:id");
  const { id } = req.params;

  try {
    const sql = "DELETE FROM leagues WHERE id = ?";
    const result = await dbRun(sql, [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    logger.db("DELETE leagues", { id, changes: result.changes });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin DELETE /api/leagues/:id");
    res.status(500).json({ error: "Database error" });
  }
});

// Get league play days (by league_id)
router.get("/league/:leagueId/play-days", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/league/:leagueId/play-days");
  const { leagueId } = req.params;

  try {
    const sql = `
      SELECT id, league_id, day_of_week, is_play_day
      FROM league_play_days
      WHERE league_id = ?
      ORDER BY day_of_week
    `;
    const rows = await dbAll(sql, [leagueId]);
    res.json({ playDays: rows });
  } catch (err) {
    logger.error(err, "Admin GET /league/:leagueId/play-days");
    res.status(500).json({ error: err.message });
  }
});

// Update league play days
router.put("/api/league-play-days/:leagueId", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/api/league-play-days/:leagueId");
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
        days.forEach(d => {
          stmt.run([leagueId, d.day_of_week, d.is_play_day]);
        });
        stmt.finalize(err => (err ? reject(err) : resolve()));
      });
    });

    logger.db("UPSERT league_play_days", { leagueId });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /api/league-play-days/:leagueId");
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------------------------------------------------------
// ADMIN SCHEDULE API
// -----------------------------------------------------------------------------

// Get a user's schedule for a month (admin view)
router.get("/api/schedule/:userId/:year/:month", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/api/schedule/:userId/:year/:month");
  const userId = parseInt(req.params.userId, 10);
  const year = parseInt(req.params.year, 10);
  const month = parseInt(req.params.month, 10);

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-31`;

  try {
    const sql = `
      SELECT date, is_playing
      FROM schedule
      WHERE user_id = ? AND date BETWEEN ? AND ?
    `;
    const rows = await dbAll(sql, [userId, start, end]);

    const result = {};
    rows.forEach(r => {
      result[r.date] = r.is_playing;
    });

    res.json(result);
  } catch (err) {
    logger.error(err, "Admin GET /api/schedule/:userId/:year/:month");
    res.status(500).json({ error: err.message });
  }
});

// Update a user's schedule (admin edit)
router.put("/api/schedule", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/api/schedule");
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
        stmt.finalize(err => (err ? reject(err) : resolve()));
      });
    });

    logger.db("UPSERT schedule (admin)", { user_id });
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /api/schedule");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;