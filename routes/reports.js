// ============================================================================
// routes/reports.js
// Centralized Reports Router
// Mounted at: /api/reports
// ============================================================================

console.log("Reports router loaded");

const express = require("express");
const router = express.Router();
const path = require("path");
const db = require("../db");
const logger = require("../utils/logger");
const { requireLogin, requireAdmin } = require("../middleware/auth");
const transporter = require("../services/mailer");

// Services
const buildTwoWeekReportData = require("../services/buildTwoWeekReportData");

// DB async helpers
function dbGet(sql, params = []) { return db.getAsync(sql, params); }
function dbAll(sql, params = []) { return db.allAsync(sql, params); }
function dbRun(sql, params = []) { return db.runAsync(sql, params); }

// ============================================================================
// TWO-WEEK GOLFERS REPORT + ALLOCATED TEE TIMES (combined)
// GET /api/reports/two-week/full
// ============================================================================
router.get("/two-week/full", requireLogin, async (req, res) => {
  try {
    const leagueId = req.session.user.league_id;

    const {
      dates,
      players,
      totals,
      allocatedTeeTimes
    } = await buildTwoWeekReportData(db, leagueId);

    if (!dates || dates.length === 0) {
      return res.json({
        dates: [],
        players: [],
        totals: {},
        allocatedTeeTimes: {}
      });
    }
    console.log("=== TWO-WEEK REPORT DEBUG ===");
    console.log("dates:", dates);
    console.log("players:", players);
    console.log("totals:", totals);
    console.log("allocatedTeeTimes:", allocatedTeeTimes);
    console.log("================================");

    res.json({
      dates,
      players,
      totals,
      allocatedTeeTimes
    });

  } catch (err) {
    console.error("Two-week FULL report error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AVAILABLE NEXT TWO WEEKS FOR A LEAGUE
// GET /api/reports/available-next-two-weeks/:leagueId
// ============================================================================
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

// ============================================================================
// AVAILABLE ON A SPECIFIC DATE
// GET /api/reports/available-date/:leagueId/:date
// ============================================================================
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

    res.json({ date, available: rows });

  } catch (err) {
    logger.error(err, "GET /available-date/:leagueId/:date");
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// USER LIST (for admin email recipient selection)
// GET /api/reports/usrs/list
// ============================================================================
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
    console.error("Error loading user list:", err);
    res.status(500).json({ error: "Unable to load users" });
  }
});

// ============================================================================
// NEXT PLAY DAY ALPHABETICAL LIST (including guests)
// GET /api/reports/next-play-day/:leagueId
// ============================================================================
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

    res.json({ next_play_date: nextPlayDate, report: text });

  } catch (err) {
    logger.error(err, "GET /next-play-day/:leagueId");
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// DOWNLOAD DATABASE (admin only)
// GET /api/reports/download-db
// ============================================================================
router.get("/download-db", (req, res) => {
  const file = path.join(__dirname, "..", "golf.db");
  res.download(file, "golf.db");
});

// ============================================================================
// GENERIC EMAIL SENDER (Next Play Day Report)
// POST /api/reports/email
// ============================================================================
router.post("/email", requireLogin, async (req, res) => {
  const { reportText, extraRecipients = "" } = req.body;

  console.log("📥 Incoming email request:", req.body);
  console.log("👤 Logged-in user:", req.user);

  let recipients = [req.user.email];

  // Email validation helpers
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

  // Admins may add extra recipients
  if (req.user.is_admin === 1) {
    const validation = validateRecipientList(extraRecipients);
    if (!validation.ok) {
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

// ============================================================================
// TEST EMAIL
// GET /api/reports/test-email
// ============================================================================
router.get("/test-email", async (req, res) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: "Golf Scheduler Test Email",
      text: "This is a test email from your golf scheduler backend."
    });

    res.json({ ok: true, message: "Test email sent" });

  } catch (err) {
    console.error("Test email error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// SEND TWO-WEEK GOLFERS REPORT (email)
// POST /api/reports/two-week/email
// ============================================================================
const generateTwoWeekReportText = require("../services/generateTwoWeekReportText");
const generateTwoWeekReportHTML = require("../services/generateTwoWeekReportHTML");

router.post("/two-week/email", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    // Get league name
    const league = db.prepare(`
      SELECT league_name
      FROM leagues
      WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";

    // Build report data
    const {
      dates,
      players,
      totals,
      allocatedTeeTimes
    } = await buildTwoWeekReportData(db, leagueId);

    // Handle empty report
    if (!dates || dates.length === 0) {
      const emptyText = `Two-Week Golfers Report - ${leagueName}\n\nNo scheduled play in the next 14 days.\n`;

      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: user.email,
        subject: `Two-Week Golfers Report - ${leagueName}`,
        text: emptyText,
        html: `<p>No scheduled play in the next 14 days.</p>`
      });

      return res.json({ ok: true });
    }

    // Generate email content
    const reportText = generateTwoWeekReportText(
      dates,
      players,
      totals,
      allocatedTeeTimes,
      leagueName
    );

    const htmlReport = generateTwoWeekReportHTML(
      dates,
      players,
      totals,
      allocatedTeeTimes,
      leagueName
    );

    // Recipient logic
    const {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      playersInReport = [],
      guestsInReport = []
    } = req.body;

    const recipients = new Set();

    // Always include logged-in user if requested
    if (includeSelf && user.email) {
      recipients.add(user.email);
    }

    // Players in report
    if (includePlayers && playersInReport.length > 0) {
      const placeholders = playersInReport.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT email
        FROM users
        WHERE id IN (${placeholders})
          AND league_id = ?
      `).all(...playersInReport, leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

    // Guests in report
    if (includePlayers && guestsInReport.length > 0) {
      const placeholders = guestsInReport.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT g.guest_email, u.email AS sponsor_email
        FROM guests g
        JOIN users u ON u.id = g.sponsor_user_id
        WHERE g.id IN (${placeholders})
          AND u.league_id = ?
      `).all(...guestsInReport, leagueId);

      rows.forEach(g => {
        if (!g.guest_email) return;
        if (g.guest_email === g.sponsor_email) return;
        recipients.add(g.guest_email);
      });
    }

    // Admins
    if (includeAdmins) {
      const rows = db.prepare(`
        SELECT email
        FROM users
        WHERE league_id = ?
          AND is_admin = 1
      `).all(leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

    // Staff
    if (includeStaff) {
      const rows = db.prepare(`
        SELECT email
        FROM club_staff
        WHERE league_id = ?
      `).all(leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

    const finalRecipients = Array.from(recipients);

    if (finalRecipients.length === 0) {
      return res.status(400).json({ error: "No recipients selected" });
    }

    // Send email
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: finalRecipients.join(", "),
      subject: `Two-Week Golfers Report - ${leagueName}`,
      text: reportText,
      html: htmlReport
    });

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error sending two-week report:", err);
    res.status(500).json({ error: "Unable to send report email" });
  }
});

module.exports = router;
