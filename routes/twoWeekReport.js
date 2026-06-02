const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");
const transporter = require("../services/mailer");
const buildTwoWeekReportData = require("../services/buildTwoWeekReportData");
const generateTwoWeekReportText = require("../services/generateTwoWeekReportText");
const generateTwoWeekReportHTML = require("../services/generateTwoWeekReportHTML");

// -----------------------------------------------------------------------------
// TWO-WEEK GOLFERS REPORT (players + guests)
// -----------------------------------------------------------------------------
router.get("/admin/reports/two-week", requireAdmin, (req, res) => {
  try {
    const leagueId = req.session.user.league_id;
    console.log("SESSION USER:", req.session.user);


    // -------------------------------------------------------------------------
    // 1. Get distinct play dates for next 14 days
    // -------------------------------------------------------------------------
    const dateRows = db.prepare(`
      SELECT DISTINCT schedule.date AS play_date
      FROM schedule
      JOIN users ON users.id = schedule.user_id
      WHERE schedule.is_playing = 1
        AND users.league_id = ?
        AND schedule.date >= datetime(CURRENT_TIMESTAMP, '-4 hours')
        AND schedule.date <= datetime(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
      ORDER BY play_date
    `).all(leagueId);

    const playDates = dateRows.map(r => r.play_date);

    if (playDates.length === 0) {
      return res.json({
        dates: [],
        players: [],
        totals: {}
      });
    }

    // -------------------------------------------------------------------------
    // 2. Get the vertical list of all players who play at least once
    // -------------------------------------------------------------------------
    const playerRows = db.prepare(`
      SELECT DISTINCT users.id,
             users.first_name,
             users.last_name,
             users.is_member
      FROM schedule
      JOIN users ON users.id = schedule.user_id
      WHERE schedule.is_playing = 1
        AND users.league_id = ?
        AND schedule.date >= datetime(CURRENT_TIMESTAMP, '-4 hours')
        AND schedule.date <= datetime(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
      ORDER BY users.last_name, users.first_name
    `).all(leagueId);

    // -------------------------------------------------------------------------
    // 3. Add guests who appear in the next 14 days
    // -------------------------------------------------------------------------
    const guestRows = db.prepare(`
      SELECT guests.id AS guest_id,
             guests.guest_first_name AS first_name,
             guests.guest_last_name AS last_name,
             0 AS is_member,
             guests.date1, guests.date2, guests.date3, guests.date4, guests.date5
      FROM guests
      JOIN users ON users.id = guests.sponsor_user_id
      WHERE users.league_id = ?
        AND (
             guests.date1 BETWEEN date(CURRENT_TIMESTAMP, '-4 hours') AND date(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
          OR guests.date2 BETWEEN date(CURRENT_TIMESTAMP, '-4 hours') AND date(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
          OR guests.date3 BETWEEN date(CURRENT_TIMESTAMP, '-4 hours') AND date(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
          OR guests.date4 BETWEEN date(CURRENT_TIMESTAMP, '-4 hours') AND date(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
          OR guests.date5 BETWEEN date(CURRENT_TIMESTAMP, '-4 hours') AND date(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
        )
      ORDER BY last_name, first_name
    `).all(leagueId);

    // Merge players + guests into one list
    const allPeople = [
      ...playerRows.map(p => ({
        type: "player",
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        is_member: p.is_member,
        guest_dates: []
      })),
      ...guestRows.map(g => ({
        type: "guest",
        id: g.guest_id,
        first_name: g.first_name,
        last_name: g.last_name,
        is_member: 0,
        guest_dates: [g.date1, g.date2, g.date3, g.date4, g.date5]
      }))
    ];

    // -------------------------------------------------------------------------
    // 4. Build the spreadsheet matrix
    // -------------------------------------------------------------------------
    const totals = {};
    playDates.forEach(d => totals[d] = 0);

    const players = allPeople.map(person => {
      const row = {
        id: person.id,                         // ⭐ ADD THIS
        is_guest: person.type === "guest" ? 1 : 0,   // ⭐ ADD THIS
        name: `${person.first_name} ${person.last_name}${person.is_member ? "" : "*"}`,
        is_member: person.is_member,
        plays: {}
      };

      for (const d of playDates) {
        let plays = " ";

        if (person.type === "player") {
          const r = db.prepare(`
            SELECT is_playing
            FROM schedule
            WHERE user_id = ? AND date = ?
          `).get(person.id, d);

          if (r && r.is_playing === 1) {
            plays = "Y";
            totals[d]++;
          }
        }

        if (person.type === "guest") {
          if (person.guest_dates.includes(d)) {
            plays = "Y";
            totals[d]++;
          }
        }

        row.plays[d] = plays;
      }

      return row;
    });

    // -------------------------------------------------------------------------
    // 5. Return JSON
    // -------------------------------------------------------------------------
    res.json({
      dates: playDates,
      players,
      totals
    });

  } catch (err) {
    console.error("Two-week report error:", err);
    res.status(500).json({ error: err.message });
  }
});

// routes/admin-reports.js (or wherever your report routes live)

router.post("/admin/reports/two-week/email", requireAdmin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    const {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      playersInReport = [],   // array of user_ids
      guestsInReport = []     // array of guest_ids
    } = req.body;

    // -----------------------------
    // 1. Build unified report data
    // -----------------------------
    const { dates, rows, totals } = await buildTwoWeekReportData(db, leagueId);

    // Format both versions from the same data
    const reportText = generateTwoWeekReportText(dates, rows, totals);
    const htmlReport  = generateTwoWeekReportHTML(dates, rows, totals);

    // -----------------------------
    // 2. Build recipient list
    // -----------------------------
    const recipients = new Set();

    // A. Always include logged-in admin
    if (includeSelf && user.email) {
      recipients.add(user.email);
    }

    // B. Players in the report (users table)
    if (includePlayers && playersInReport.length > 0) {
      const placeholders = playersInReport.map(() => "?").join(",");
      const players = db.prepare(`
        SELECT DISTINCT email
        FROM users
        WHERE id IN (${placeholders})
          AND league_id = ?
      `).all(...playersInReport, leagueId);

      players.forEach(p => {
        if (p.email) recipients.add(p.email);
      });
    }

    // C. Guests in the report (guests table)
    if (includePlayers && guestsInReport.length > 0) {
      const placeholders = guestsInReport.map(() => "?").join(",");
      const guests = db.prepare(`
        SELECT g.guest_email, u.email AS sponsor_email
        FROM guests g
        JOIN users u ON u.id = g.sponsor_user_id
        WHERE g.id IN (${placeholders})
          AND u.league_id = ?
      `).all(...guestsInReport, leagueId);

      guests.forEach(g => {
        if (!g.guest_email) return;
        if (g.guest_email === g.sponsor_email) return;
        recipients.add(g.guest_email);
      });
    }

    // D. League admins
    if (includeAdmins) {
      const admins = db.prepare(`
        SELECT email
        FROM users
        WHERE league_id = ?
          AND is_admin = 1
      `).all(leagueId);

      admins.forEach(a => {
        if (a.email) recipients.add(a.email);
      });
    }

    // E. Club staff
    if (includeStaff) {
      const staff = db.prepare(`
        SELECT email
        FROM club_staff
        WHERE league_id = ?
      `).all(leagueId);

      staff.forEach(s => {
        if (s.email) recipients.add(s.email);
      });
    }

    const finalRecipients = Array.from(recipients);

    if (finalRecipients.length === 0) {
      return res.status(400).json({ error: "No recipients selected" });
    }

    console.log("📧 Sending Two-Week Report to:", finalRecipients);

    // -----------------------------
    // 3. Send the email
    // -----------------------------
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: finalRecipients.join(", "),
      subject: "Two-Week Report",
      text: reportText,   // plain text fallback
      html: htmlReport    // beautiful HTML version
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error sending two-week report:", err);
    return res.status(500).json({ error: "Unable to send report email" });
  }
});

module.exports = router;
