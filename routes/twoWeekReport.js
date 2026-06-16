const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireLogin, requireAdmin } = require("../middleware/auth");
const transporter = require("../services/mailer");

const buildTwoWeekReportData = require("../services/buildTwoWeekReportData");
const generateTwoWeekReportText = require("../services/generateTwoWeekReportText");
const generateTwoWeekReportHTML = require("../services/generateTwoWeekReportHTML");

// ============================================================================
// GET TWO-WEEK REPORT (admin + user)
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
// USER-ONLY EMAIL ROUTE (Send to Myself Only)
// ============================================================================
router.post("/two-week/email-self", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

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

      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
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

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: `Two-Week Golfers Report - ${leagueName}`,
      text: reportText,
      html: htmlReport
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error sending self-only report:", err);
    return res.status(500).json({ error: "Unable to send report email" });
  }
});

// ============================================================================
// ADMIN EMAIL ROUTE (Full recipient logic)
// ============================================================================
router.post("/two-week/email", requireAdmin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

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

      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
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

    // -----------------------------
    // Build admin recipient list
    // -----------------------------
    const {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      playersInReport = [],
      guestsInReport = []
    } = req.body;

    const recipients = new Set();

    // Always include logged-in admin if requested
    if (includeSelf && user.email) {
      recipients.add(user.email);
    }

    // Players in report
    if (includePlayers && playersInReport.length > 0) {
      const placeholders = playersInReport.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT DISTINCT email
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

    // -----------------------------
    // Send email
    // -----------------------------
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: finalRecipients.join(", "),
      subject: `Two-Week Golfers Report - ${leagueName}`,
      text: reportText,
      html: htmlReport
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error sending admin report:", err);
    return res.status(500).json({ error: "Unable to send report email" });
  }
});

module.exports = router;
