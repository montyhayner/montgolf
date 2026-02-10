// routes/admin/reports.js
const express = require("express");
const db = require("../../db");
const logger = require("../../utils/logger");
const { requireAdmin } = require("../../middleware/auth");

const router = express.Router();

// Example: league participation report
router.get("/participation/:leagueId", requireAdmin, async (req, res) => {
  logger.route("GET", "/admin/reports/participation/:leagueId");
  const { leagueId } = req.params;

  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT u.first_name, u.last_name, s.date, s.is_playing
        FROM users u
        JOIN schedule s ON u.id = s.user_id
        WHERE u.league_id