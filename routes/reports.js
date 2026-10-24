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

// Services
const buildTwoWeekReportData = require("../services/buildTwoWeekReportData");
const { sendEmail } = require("../services/mailer");
const { buildUserTwoWeekEmailHTML } = require("../services/twoWeekEmailBuilders");
const generateTwoWeekReportText = require("../services/generateTwoWeekReportText");
const generateTwoWeekReportHTML = require("../services/generateTwoWeekReportHTML");

// ============================================================================
// TWO-WEEK GOLFERS REPORT + ALLOCATED TEE TIMES (combined).
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
        JOIN users u 
          ON u.id = s.user_id
         AND u.league_id = s.league_id
       WHERE u.league_id = ?
         AND s.is_playing = 1
         AND s.date BETWEEN ? AND ?
       ORDER BY s.date, u.last_name, u.first_name
    `;

    const rows = db.prepare(sql).all(leagueId, start, end);

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
// LATEST TEE SHEET REPORT
// GET /api/reports/latest-tee-sheet
// ============================================================================
router.get("/latest-tee-sheet", requireLogin, async (req, res) => {
  try {
    const leagueId = req.session.user.league_id;

    const row = db.prepare(`
      SELECT MAX(tee_date) AS latest_date
        FROM tee_sheet
       WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.latest_date) {
      return res.json({
        ok: false,
        message: "No tee sheet available",
        teeSheet: [],
        longDate: null
      });
    }

    const teeDate = row.latest_date;

    const teeSheet = db.prepare(`
      SELECT *
        FROM tee_sheet
       WHERE league_id = ?
         AND tee_date = ?
       ORDER BY tee_time, starting_nine
    `).all(leagueId, teeDate);

    const [year, month, day] = teeDate.split("-");
    const localDate = new Date(year, month - 1, day);

    const longDate = localDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    const isSuperAdmin = !!req.session.user.is_super_admin;
    const isLeagueAdmin = !!req.session.user.is_admin;
    const isAdmin = isSuperAdmin || isLeagueAdmin;

    res.json({
      ok: true,
      teeDate,
      longDate,
      teeSheet,
      teeRows: teeSheet,
      league_id: leagueId,
      isAdmin
    });

  } catch (err) {
    console.error("Latest tee sheet error:", err);
    res.status(500).json({ ok: false, error: err.message });
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
        JOIN users u 
          ON u.id = s.user_id
         AND u.league_id = s.league_id
       WHERE u.league_id = ?
         AND s.date = ?
         AND s.is_playing = 1
       ORDER BY u.last_name, u.first_name
    `;

    const rows = db.prepare(sql).all(leagueId, date);

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
    const rows = db.prepare(
      `SELECT id, first_name, last_name, email
         FROM users
        WHERE league_id = ?
        ORDER BY last_name, first_name`
    ).all(req.user.league_id);

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
        JOIN users 
          ON users.id = schedule.user_id
         AND users.league_id = schedule.league_id
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
          JOIN users 
            ON users.id = schedule.user_id
           AND users.league_id = schedule.league_id
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
        JOIN users 
          ON users.id = guests.sponsor_user_id
         AND users.league_id = guests.league_id
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

    const rows = db.prepare(sql).all(leagueId, leagueId, leagueId);

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
    await sendEmail({
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

router.post("/send-email", async (req, res) => {
  try {
    const { to, subject, message } = req.body;

    const info = await mailgunTransport.sendMail({
      to,
      subject,
      html: message
    });

    res.json({ success: true, id: info.messageId });
  } catch (err) {
    console.error("Mailgun SMTP Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// TEST EMAIL
// GET /api/reports/test-email
// ============================================================================
router.get("/test-email", async (req, res) => {
  try {
    await sendEmail({
      to: "montyhayner@outlook.com",
      subject: "MontGolf SMTP Test",
      html: "<h1>Your Mailgun SMTP is working!</h1>"
    });
    res.send("Email sent!");
  } catch (err) {
    console.error(err);
    res.send("Error sending email.");
  }
});

// ============================================================================
// USER — Email Two-Week Golfers Report to Logged-In User
// POST /api/reports/user-two-week/email
// ============================================================================
router.post("/user-two-week/email", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;

    if (!user || !user.email) {
      return res.status(400).json({ error: "User email not available." });
    }

    const {
      dates,
      players,
      totals,
      allocatedTeeTimes
    } = await buildTwoWeekReportData(db, user.league_id);

    const html = buildUserTwoWeekEmailHTML(
      { dates, players, totals },
      allocatedTeeTimes
    );

    await sendEmail({
      to: user.email,
      subject: "Your Two-Week Golfers Report",
      html
    });

    res.json({ success: true });

  } catch (err) {
    console.error("Error sending user two-week report:", err);
    res.status(500).json({ error: "Failed to send report." });
  }
});

// ============================================================================
// POST /api/reports/admin-two-week/email
// ============================================================================
router.post("/admin-two-week/email", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    console.log("HIT ADMIN-TWO-WEEK/EMAIL POST ROUTE");
    console.log("USER SESSION:", req.session.user);

    const league = db.prepare(`
      SELECT league_name
        FROM leagues
       WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";

    const {
      dates,
      players,
      totals,
      allocatedTeeTimes
    } = await buildTwoWeekReportData(db, leagueId);

    if (!dates || dates.length === 0) {
      const emptyText = `Two-Week Golfers Report - ${leagueName}\n\nNo scheduled play in the next 14 days.\n`;

      await sendEmail({
        to: user.email,
        subject: `Two-Week Golfers Report - ${leagueName}`,
        text: emptyText,
        html: `<p>No scheduled play in the next 14 days.</p>`
      });

      return res.json({ ok: true });
    }

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

    const {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      playersInReport = [],
      guestsInReport = []
    } = req.body;

    const recipients = new Set();

    if (includeSelf && user.email) {
      recipients.add(user.email);
    }

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

    if (includePlayers && guestsInReport.length > 0) {
      const placeholders = guestsInReport.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT g.guest_email, u.email AS sponsor_email
          FROM guests g
          JOIN users u 
            ON u.id = g.sponsor_user_id
           AND u.league_id = g.league_id
         WHERE g.id IN (${placeholders})
           AND u.league_id = ?
      `).all(...guestsInReport, leagueId);

      rows.forEach(g => {
        if (!g.guest_email) return;
        if (g.guest_email === g.sponsor_email) return;
        recipients.add(g.guest_email);
      });
    }

    if (includeAdmins) {
      const rows = db.prepare(`
        SELECT email
         FROM users
        WHERE league_id = ?
          AND is_admin = 1
      `).all(leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

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

    const html = buildUserTwoWeekEmailHTML(
      { dates, players, totals },
      allocatedTeeTimes
    );

    for (const recipient of finalRecipients) {
      await sendEmail({
        to: recipient,
        subject: `Two-Week Golfers Report - ${leagueName}`,
        html
      });
    }

    console.log("post - /admin-two-week/email route");
    console.log("Two-week report email sent to:", finalRecipients);

    res.json({
      success: true,
      recipients: finalRecipients
    });

  } catch (err) {
    console.error("Error sending user two-week report:", err);
    res.status(500).json({ error: "Failed to send report." });
  }
});

// ============================================================================
// SEND LATEST TEE SHEET REPORT (email)
// POST /api/reports/latest-tee-sheet/email
// ============================================================================
router.post("/latest-tee-sheet/email", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    const league = db.prepare(`
      SELECT league_name
        FROM leagues
       WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";

    const row = db.prepare(`
      SELECT MAX(tee_date) AS latest_date
        FROM tee_sheet
       WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.latest_date) {
      return res.status(400).json({ error: "No tee sheet available" });
    }

    const teeDate = row.latest_date;

    const teeSheet = db.prepare(`
      SELECT *
        FROM tee_sheet
       WHERE league_id = ?
         AND tee_date = ?
       ORDER BY tee_time, starting_nine
    `).all(leagueId, teeDate);

    const buildHTML = rows => {
      const [year, month, day] = teeDate.split("-");
      const localDate = new Date(year, month - 1, day);

      const formattedDate = localDate.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });

      let html = `
        <div style="text-align:center; margin-bottom:10px;">
          <div style="font-size:24px; font-weight:bold; color:#333;">
            Latest Tee Sheet Report
          </div>
          <div style="font-size:16px; color:#555; margin-top:4px;">
            ${formattedDate}
          </div>
        </div>

        <div style="text-align:center;">
          <table style="border-collapse:collapse; margin:auto; border:1px solid #000;">
            <tr style="background:#e6ffe6;">
              <th style="padding:6px; border:1px solid #000;">Tee Time</th>
              <th style="padding:6px; border:1px solid #000;">Starting Nine</th>
              <th style="padding:6px; border:1px solid #000;">Players</th>
            </tr>
      `;

      rows.forEach(r => {
        const players = [
          r.first_name1 && `${r.first_name1} ${r.last_name1}`,
          r.first_name2 && `${r.first_name2} ${r.last_name2}`,
          r.first_name3 && `${r.first_name3} ${r.last_name3}`,
          r.first_name4 && `${r.first_name4} ${r.last_name4}`
        ].filter(Boolean).join(", ");

        html += `
            <tr>
              <td style="padding:6px; border:1px solid #000;">${r.tee_time}</td>
              <td style="padding:6px; border:1px solid #000;">${r.starting_nine}</td>
              <td style="padding:6px; border:1px solid #000;">${players}</td>
            </tr>
        `;
      });

      html += `
          </table>
        </div>
      `;

      return html;
    };

    const htmlReport = buildHTML(teeSheet);

    const {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      playersInReport = []
    } = req.body;

    const recipients = new Set();

    if (includeSelf && user.email) {
      recipients.add(user.email);
    }

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

    if (includeAdmins) {
      const rows = db.prepare(`
        SELECT email
          FROM users
         WHERE league_id = ?
           AND is_admin = 1
      `).all(leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

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

    console.log("EMAIL CONFIG:", {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE,
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS ? "LOADED" : "MISSING"
    });

    await sendEmail({
      to: finalRecipients.join(", "),
      subject: `Latest Tee Sheet - ${leagueName}`,
      html: htmlReport
    });

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error sending latest tee sheet:", err);
    res.status(500).json({ error: "Unable to send latest tee sheet email" });
  }
});

// ============================================================================
// ADMIN — SEND LATEST TEE SHEET REPORT (email)
// POST /api/reports/admin-latest-tee-sheet/email
// ============================================================================
router.post("/admin-latest-tee-sheet/email", requireAdmin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    console.log("HIT ADMIN-LATEST-TEE-SHEET/EMAIL POST ROUTE");
    console.log("USER SESSION:", req.session.user);
    console.log("REQ BODY:", req.body);

    const league = db.prepare(`
      SELECT league_name
        FROM leagues
       WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";
    console.log("League Name:", leagueName);

    const row = db.prepare(`
      SELECT MAX(tee_date) AS latest_date
        FROM tee_sheet
       WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.latest_date) {
      return res.status(400).json({ error: "No tee sheet available" });
    }

    const teeDate = row.latest_date;

    const teeSheet = db.prepare(`
      SELECT *
        FROM tee_sheet
       WHERE league_id = ?
         AND tee_date = ?
       ORDER BY tee_time, starting_nine
    `).all(leagueId, teeDate);

    const buildHTML = rows => {
      const [year, month, day] = teeDate.split("-");
      const localDate = new Date(year, month - 1, day);

      const formattedDate = localDate.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });

      let html = `
        <div style="text-align:center; margin-bottom:10px;">
          <div style="font-size:24px; font-weight:bold; color:#333;">
            Latest Tee Sheet Report
          </div>
          <div style="font-size:16px; color:#555; margin-top:4px;">
            ${formattedDate}
          </div>
        </div>

        <div style="text-align:center;">
          <table border="1" bordercolor="#000000" cellpadding="6" cellspacing="0"
            style="border-collapse:collapse; margin:auto; border:1px solid #000;">
            <tr style="background:#e6ffe6;">
              <th style="padding:6px; border:1px solid #000;">Tee Time</th>
              <th style="padding:6px; border:1px solid #000;">Starting Nine</th>
              <th style="padding:6px; border:1px solid #000;">Players</th>
            </tr>
      `;

      rows.forEach(r => {
        const players = [
          r.first_name1 && `${r.first_name1} ${r.last_name1}`,
          r.first_name2 && `${r.first_name2} ${r.last_name2}`,
          r.first_name3 && `${r.first_name3} ${r.last_name3}`,
          r.first_name4 && `${r.first_name4} ${r.last_name4}`
        ].filter(Boolean).join(", ");

        html += `
            <tr>
              <th style="padding:6px; border:1px solid #000;">${r.tee_time}</th>
              <th style="padding:6px; border:1px solid #000;">${r.starting_nine}</th>
              <th style="padding:6px; border:1px solid #000;">${players}</th>
            </tr>
        `;
      });

      html += `
          </table>
        </div>
      `;
      console.log("Generated HTML Report:");
      console.log(html);
      return html;
    };

    const htmlReport = buildHTML(teeSheet);

    const {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      selfOnly,
      playersInReport = []
    } = req.body;

    const recipients = new Set();
    console.log("Recipient selection options:", {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      selfOnly,
      playersInReport
    });

    if (includeSelf && user.email) {
      recipients.add(user.email);
      console.log("Added logged-in admin to recipients:", user.email);
    }

    if (!selfOnly && includePlayers && playersInReport.length > 0) {
      const placeholders = playersInReport.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT email
          FROM users
         WHERE id IN (${placeholders})
           AND league_id = ?
      `).all(...playersInReport, leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

    if (!selfOnly && includeAdmins) {
      const rows = db.prepare(`
        SELECT email
          FROM users
         WHERE league_id = ?
           AND is_admin = 1
      `).all(leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

    if (!selfOnly && includeStaff) {
      const rows = db.prepare(`
        SELECT email
          FROM club_staff
         WHERE league_id = ?
      `).all(leagueId);

      rows.forEach(r => r.email && recipients.add(r.email));
    }

    const finalRecipients = Array.from(recipients);
    console.log("Final Recipients:", finalRecipients);

    if (finalRecipients.length === 0) {
      return res.status(400).json({ error: "No recipients selected" });
    }

    for (const recipient of finalRecipients) {
      console.log(`Sending latest tee sheet email to: ${recipient}`);
      await sendEmail({
        to: recipient,
        subject: `Latest Tee Sheet - ${leagueName}`,
        html: htmlReport
      });
    }

    res.json({
      success: true,
      recipients: finalRecipients
    });

  } catch (err) {
    console.error("❌ Error sending admin latest tee sheet:", err);
    res.status(500).json({ error: "Unable to send latest tee sheet email" });
  }
});

module.exports = router;
