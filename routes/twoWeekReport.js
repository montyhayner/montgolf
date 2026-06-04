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

// ============================================================================
// TWO-WEEK GOLFERS REPORT + ALLOCATED TEE TIMES (combined)
// ============================================================================
router.get("/admin/reports/two-week/full", requireAdmin, async (req, res) => {
  try {
    const leagueId = req.session.user.league_id;

    // Use the unified service (dates, rows, totals, allocatedTeeTimes)
    const {
      dates,
      rows,
      totals,
      allocatedTeeTimes
    } = await buildTwoWeekReportData(db, leagueId);

    // Return empty structure if no dates
    if (!dates || dates.length === 0) {
      return res.json({
        dates: [],
        players: [],
        totals: {},
        allocatedTeeTimes: {}
      });
    }

    // The frontend expects "players" instead of "rows"
    res.json({
      dates,
      players: rows,
      totals,
      allocatedTeeTimes
    });

  } catch (err) {
    console.error("Two-week FULL report error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/admin/reports/two-week/email", requireAdmin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    const {
      includePlayers,
      includeAdmins,
      includeStaff,
      includeSelf,
      playersInReport = [],
      guestsInReport = []
    } = req.body;

    // -----------------------------
    // 0. Get league name
    // -----------------------------
    const league = db.prepare(`
      SELECT league_name
      FROM leagues
      WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";

    // -----------------------------
    // 1. Build unified report data
    // -----------------------------
    const {
      dates,
      rows,
      totals,
      allocatedTeeTimes
    } = await buildTwoWeekReportData(db, leagueId);

    // If no dates, send empty report
    if (!dates || dates.length === 0) {
      const emptyText = `Two-Week Golfers Report - ${leagueName}\n\nNo scheduled play in the next 14 days.\n`;

      await transporter.sendMail({
        from: rlhayner@verizon.net,
        to: user.email,
        subject: `Two-Week Golfers Report - ${leagueName}`,
        text: emptyText,
        html: `<p>No scheduled play in the next 14 days.</p>`
      });

      return res.json({ ok: true });
    }

    // -----------------------------
    // 2. Generate email content
    // -----------------------------
    const reportText = generateTwoWeekReportText(
      dates,
      rows,
      totals,
      allocatedTeeTimes,
      leagueName
    );

    const htmlReport = generateTwoWeekReportHTML(
      dates,
      rows,
      totals,
      allocatedTeeTimes,
      leagueName
    );

    // -----------------------------
    // 3. Build recipient list
    // -----------------------------
    const recipients = new Set();

    // Always include logged-in admin
    if (includeSelf && user.email) {
      recipients.add(user.email);
    }

    // Players in report
    if (includePlayers && playersInReport.length > 0) {
      const placeholders = playersInReport.map(() => "?").join(",");
      const players = db.prepare(`
        SELECT DISTINCT email
        FROM users
        WHERE id IN (${placeholders})
          AND league_id = ?
      `).all(...playersInReport, leagueId);

      players.forEach(p => p.email && recipients.add(p.email));
    }

    // Guests in report
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

    // Admins
    if (includeAdmins) {
      const admins = db.prepare(`
        SELECT email
        FROM users
        WHERE league_id = ?
          AND is_admin = 1
      `).all(leagueId);

      admins.forEach(a => a.email && recipients.add(a.email));
    }

    // Staff
    if (includeStaff) {
      const staff = db.prepare(`
        SELECT email
        FROM club_staff
        WHERE league_id = ?
      `).all(leagueId);

      staff.forEach(s => s.email && recipients.add(s.email));
    }

    const finalRecipients = Array.from(recipients);

    if (finalRecipients.length === 0) {
      return res.status(400).json({ error: "No recipients selected" });
    }

    // -----------------------------
    // 4. Send the email
    // -----------------------------
    await transporter.sendMail({
      from: rlhayner@verizon.net,
      to: finalRecipients.join(", "),
      subject: `Two-Week Golfers Report - ${leagueName}`,
      text: reportText,
      html: htmlReport
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error sending two-week report:", err);
    return res.status(500).json({ error: "Unable to send report email" });
  }
});

module.exports = router;
