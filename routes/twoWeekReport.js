const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

// -----------------------------------------------------------------------------
// TWO-WEEK CLUB REPORT (players + guests)
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

module.exports = router;
