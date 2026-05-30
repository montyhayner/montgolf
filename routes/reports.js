// routes/reports.js
console.log("Reports router loaded");

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");
const { requireLogin, requireAdmin } = require("../middleware/auth");
const transporter = require("../services/mailer");

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
  logger.route("GET", "/available-next-two-weeks/:leagueId");

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
    logger.error(err, "GET /available-next-two-weeks/:leagueId");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// REPORT 2: AVAILABLE ON A SPECIFIC DATE
// -----------------------------------------------------------------------------

router.get("/available-date/:leagueId/:date", requireAdmin, async (req, res) => {
  logger.route("GET", "/available-date/:leagueId/:date");

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
    logger.error(err, "GET /available-date/:leagueId/:date");
    res.status(500).json({ error: err.message });
  }
});

router.get("/usrs/list", requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, first_name, last_name, email
       FROM users
       WHERE league_id = ?
       ORDER BY last_name, first_name`,
      [req.user.league_id]
    );

    res.json(rows);

  } catch (err) {
    console.error("Error loading user list (as possible email recipients):", err);
    res.status(500).json({ error: "Unable to load users (as possible email recipients)" });
  }
});

// -------------------------------------------------------------------------------------------------------------------
// NEXT PLAY DAY ALPHABETICAL LIST OF PLAYERS - INCLUDING GUESTS
// -------------------------------------------------------------------------------------------------------------------
router.get("/next-play-day/:leagueId", async (req, res) => {

  logger.route("GET", "/next-play-day/:leagueId");

  try {
    const leagueId = req.params.leagueId;

    const sql = `
      WITH next_play_date AS (
        SELECT MIN(schedule.date) AS play_date
        FROM schedule
        JOIN users ON users.id = schedule.user_id
        WHERE users.league_id = ?
          AND schedule.is_playing = 1
          AND schedule.date BETWEEN date(datetime('now', '+8 hours'))
          AND date(datetime('now', '+152 hours'))
      ),

      member_players AS (
        SELECT 
          (users.first_name || ' ' || users.last_name) ||
          CASE WHEN users.is_member = 0 THEN ' *' ELSE '' END AS player,
          (users.last_name || ' ' || users.first_name) AS last_name_first,
          np.play_date
        FROM schedule
        JOIN users ON users.id = schedule.user_id
        JOIN next_play_date np ON schedule.date = np.play_date
        WHERE users.league_id = ?
          AND schedule.is_playing = 1
      ),

      guest_players AS (
        SELECT
          (guest_first_name || ' ' || guest_last_name) || ' **' AS player,
          (guest_last_name || ' ' || guest_first_name) AS last_name_first,
          np.play_date
        FROM guests
        JOIN users ON users.id = guests.sponsor_user_id
        JOIN next_play_date np
        WHERE users.league_id = ?
          AND (
               guests.date1 = np.play_date OR
               guests.date2 = np.play_date OR
               guests.date3 = np.play_date OR
               guests.date4 = np.play_date OR
               guests.date5 = np.play_date
              )
      )

      SELECT player, last_name_first, play_date
      FROM member_players
      UNION ALL
      SELECT player, last_name_first, play_date
      FROM guest_players
      ORDER BY last_name_first
    `;

    const rows = await dbAll(sql, [leagueId, leagueId, leagueId]);

    const nextPlayDate = rows.length > 0 ? rows[0].play_date : null;
    const text = rows.map(r => r.player).join("\n");

    res.json({
      next_play_date: nextPlayDate,
      report: text
    });

  } catch (err) {
    logger.error(err, "GET /next-play-day/:leagueId");
    res.status(500).json({ error: err.message });
  }
});

// POST - /EMAIL
router.post("/email", requireLogin, async (req, res) => {
  const { reportText, extraRecipients = "" } = req.body;

  console.log("📥 Incoming email request body:", req.body);
  console.log("👤 Logged-in user:", req.user);

  // Always include the logged-in user's email
  const baseRecipient = req.user.email;

  let recipients = [baseRecipient];

  console.log("📧 req.user.is_admin=", req.user.is_admin);

  // -----------------------------
  // EMAIL VALIDATION HELPERS
  // -----------------------------
  function backendValidateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email.includes("..")) return false;
    return re.test(email);
  }

  function validateRecipientList(list) {
    if (!list.trim()) return { ok: true };

    const emails = list.split(",").map(e => e.trim());

    for (const email of emails) {
      if (!backendValidateEmail(email)) {
        return { ok: false, badEmail: email };
      }
    }

    return { ok: true };
  }

  // -----------------------------
  // VALIDATE ADMIN EXTRA RECIPIENTS
  // -----------------------------
  if (req.user.is_admin === 1) {
    const validation = validateRecipientList(extraRecipients);

    if (!validation.ok) {
      console.log("❌ Invalid email detected:", validation.badEmail);
      return res.status(400).json({
        error: `Invalid email address: ${validation.badEmail}`
      });
    }

    const extraList = extraRecipients
      .split(",")
      .map(e => e.trim())
      .filter(e => e.length > 0);

    recipients = [...recipients, ...extraList];
  }

  console.log("📧 Final recipients list:", recipients);

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: recipients.join(", "),
      subject: "Next Play Day Report",
      text: reportText
    });

    res.json({ ok: true });

  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: "Unable to send email." });
  }
});

router.get("/test-email", async (req, res) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,   // send to yourself
      subject: "Golf Scheduler Test Email",
      text: "This is a test email from your golf scheduler backend."
    });

    res.json({ ok: true, message: "Test email sent" });

  } catch (err) {
    console.error("Test email error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;