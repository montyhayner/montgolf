// routes/schedule.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { easternNow } = require("../utils/easternTime");

// =====================================================
// 1. ADMIN INIT — Load current month for target user
// =====================================================
router.get("/admin/init/:targetUserId", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const targetUserId = req.params.targetUserId;

    // --- Verify admin privileges ---
    const adminRow = db.prepare(
      "SELECT is_admin FROM users WHERE id = ?"
    ).get(adminUserId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Verify target user exists ---
    const userRow = db.prepare(
      `SELECT users.id, first_name, last_name, in_town
       FROM  users
          ,  user_play_months 
       WHERE users.id = ? 
         AND user_play_months.user_id = users.id`
    ).get(targetUserId);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    // --- Determine current year/month ---
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // --- Load schedule for current month ---
    const rows = db.prepare(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND strftime('%Y', date) = ?
         AND strftime('%m', date) = ?
       ORDER BY date`
    ).all(targetUserId, String(year), String(month).padStart(2, "0"));

    const scheduleObj = {};
    rows.forEach(r => {
      scheduleObj[r.play_date] = r.is_playing === 1;
    });

    // --- Load override status ---
    const overrideRow = db.prepare(
      `SELECT override_timestamp
       FROM schedule_overrides
       WHERE user_id = ?
         AND year = ?
         AND month = ?`
    ).get(targetUserId, year, month);

    const overrideStatus = overrideRow ? "override_exists" : "none";

    return res.json({
      status: "ok",
      user: userRow,
      year,
      month,
      schedule: scheduleObj,
      override_status: overrideStatus
    });

  } catch (err) {
    console.error("Admin INIT error:", err);
    return res.status(500).json({ error: "Server error loading initial schedule." });
  }
});

// =====================================================
// 2. ADMIN LOAD — Load any month for target user
// =====================================================
router.get("/admin/:targetUserId/:year/:month", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const { targetUserId, year, month } = req.params;

    // --- Verify admin privileges ---
    const adminRow = db.prepare(
      "SELECT is_admin FROM users WHERE id = ?"
    ).get(adminUserId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Verify target user exists ---
    const userRow = db.prepare(
      `SELECT users.id, first_name, last_name, in_town
       FROM  users
          ,  user_play_months 
       WHERE users.id = ? 
         AND user_play_months.user_id = users.id`
    ).get(targetUserId);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    // --- Load schedule ---
    const rows = db.prepare(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND strftime('%Y', date) = ?
         AND strftime('%m', date) = ?
       ORDER BY date`
    ).all(targetUserId, String(year), String(month).padStart(2, "0"));

    const scheduleObj = {};
    rows.forEach(r => {
      scheduleObj[r.play_date] = r.is_playing === 1;
    });

    // --- Load override status ---
    const overrideRow = db.prepare(
      `SELECT override_timestamp
       FROM schedule_overrides
       WHERE user_id = ?
         AND year = ?
         AND month = ?`
    ).get(targetUserId, year, month);

    const overrideStatus = overrideRow ? "override_exists" : "none";

    return res.json({
      status: "ok",
      user: userRow,
      schedule: scheduleObj,
      override_status: overrideStatus
    });

  } catch (err) {
    console.error("Admin LOAD error:", err);
    return res.status(500).json({ error: "Server error loading schedule." });
  }
});

// =====================================================
// 3. ADMIN SAVE — Save schedule + log override
// =====================================================
router.post("/admin/save", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const { targetUserId, year, month, schedule } = req.body;

    // --- Verify admin privileges ---
    const adminRow = db.prepare(
      "SELECT is_admin FROM users WHERE id = ?"
    ).get(adminUserId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Save schedule entries ---
    const stmt = db.prepare(
      `INSERT INTO schedule (user_id, date, is_playing)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, date)
       DO UPDATE SET is_playing = excluded.is_playing`
    );

    Object.entries(schedule).forEach(([date, playing]) => {
      stmt.run(targetUserId, date, playing ? 1 : 0);
    });

    // --- Log override with Eastern timestamp ---
    const overrideTS = easternNow();

    db.prepare(
      `INSERT INTO schedule_overrides (user_id, admin_id, year, month, override_timestamp)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, year, month)
       DO UPDATE SET admin_id = excluded.admin_id,
                     override_timestamp = excluded.override_timestamp`
    ).run(targetUserId, adminUserId, year, month, overrideTS);

    return res.json({ status: "ok" });

  } catch (err) {
    console.error("Admin SAVE error:", err);
    return res.status(500).json({ error: "Server error saving schedule." });
  }
});

module.exports = router;
