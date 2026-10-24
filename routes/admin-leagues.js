const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middleware/auth");
const logger = require("../utils/logger");

// -----------------------------------------------------------------------------
// GET ALL LEAGUES
// -----------------------------------------------------------------------------
router.get("/api", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/leagues/api");

  try {
    const rows = db.prepare(`
      SELECT id, league_name, coordinator_last_name, coordinator_first_name, description
      FROM leagues
      ORDER BY league_name ASC
    `);
    res.json({ leagues: rows });
  } catch (err) {
    logger.error(err, "Admin GET /leagues/api");
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------------------------------------------------------
// GET SINGLE LEAGUE
// -----------------------------------------------------------------------------
router.get("/api/:id", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/leagues/api/:id");
  const { id } = req.params;

  try {
    const row = db.prepare(`
      SELECT id, league_name, coordinator_last_name, coordinator_first_name, description
      FROM leagues
      WHERE id = ?
    `).get(id);

    if (!row) {
      return res.status(404).json({ error: "League not found" });
    }

    res.json({ league: row });
  } catch (err) {
    logger.error(err, "Admin GET /leagues/api/:id");
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------------------------------------------------------
// CREATE LEAGUE
// -----------------------------------------------------------------------------
router.post("/api", requireAdmin, async (req, res) => {
  logger.route("POST", "/admin/leagues/api");
  const { league_name, description } = req.body;

  try {
    const insertStmt = db.prepare(`
      INSERT INTO leagues (league_name, description)
      VALUES (?, ?)
    `).run(league_name, description || null);

    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin POST /leagues/api");
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------------------------------------------------------
// UPDATE LEAGUE
// -----------------------------------------------------------------------------
router.put("/api/:id", requireAdmin, async (req, res) => {
  logger.route("PUT", "/admin/leagues/api/:id");
  const { id } = req.params;
  const { league_name, description } = req.body;

  try {
    const updtStmt = db.prepare(`
      UPDATE leagues
      SET league_name = ?, description = ?
      WHERE id = ?
    `).run(league_name, description || null, id);

    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin PUT /leagues/api/:id");
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------------------------------------------------------
// DELETE LEAGUE
// -----------------------------------------------------------------------------
router.delete("/api/:id", requireAdmin, async (req, res) => {
  logger.route("DELETE", "/admin/leagues/api/:id");
  const { id } = req.params;

  try {
    const deleteStmt = db.prepare(`DELETE FROM leagues WHERE id = ?`).run(id);
    res.json({ success: true });
  } catch (err) {
    logger.error(err, "Admin DELETE /leagues/api/:id");
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;