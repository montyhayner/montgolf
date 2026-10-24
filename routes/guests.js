const express = require("express");
const router = express.Router();
const db = require("../db");
const { easternNow } = require("../utils/easternTime");

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function isValidRange(dt) {
  const d = new Date(dt);
  d.setHours(0,0,0,0);

  const today = new Date();
  today.setHours(0,0,0,0);

  const oneYear = new Date();
  oneYear.setFullYear(oneYear.getFullYear() + 1);
  oneYear.setHours(0,0,0,0);

  return d >= today && d <= oneYear;
}

// ------------------------------------------------------------
// Synchronous schedule_history writer
// ------------------------------------------------------------
function insertHistory({
  user_id,
  league_id,
  play_date,
  old_is_playing,
  new_is_playing,
  old_email,
  new_email,
  before_state,
  after_state,
  changed_by,
  source = "guest"
}) {
  const ts = easternNow();

  try {
    db.prepare(`
      INSERT INTO schedule_history (
        user_id, league_id, play_date,
        old_is_playing, new_is_playing,
        old_guest_email, new_guest_email,
        changed_by, changed_at, source,
        before_state, after_state
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user_id,
      league_id,
      play_date,
      old_is_playing,
      new_is_playing,
      old_email,
      new_email,
      changed_by,
      ts,
      source,
      JSON.stringify(before_state),
      JSON.stringify(after_state)
    );

  } catch (err) {
    console.error("insertHistory() error:", err);
  }
}

// ------------------------------------------------------------
// GET guest for logged-in user
// ------------------------------------------------------------
router.get("/:id", (req, res) => {
  try {
    const id = req.params.id;

    const row = db.prepare(`
      SELECT *
      FROM guests
      WHERE id = ? 
        AND sponsor_user_id = ?
        AND league_id = ?
    `).get(id, req.session.user.id, req.session.user.league_id);

    if (!row) {
      return res.status(404).json({ error: "Guest not found" });
    }

    res.json(row);

  } catch (err) {
    console.error("GET /api/guests/:id error:", err);
    res.status(500).json({ error: "Server error loading guest" });
  }
});

// ------------------------------------------------------------
// GET all guests for logged-in user
// ------------------------------------------------------------
router.get("/", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT *
      FROM guests
      WHERE sponsor_user_id = ? 
        AND league_id = ?
      ORDER BY guest_last_name, guest_first_name
    `).all(req.session.user.id, req.session.user.league_id);

    res.json(rows);

  } catch (err) {
    console.error("❌ GET /api/guests error:", err);
    res.status(500).json({ error: "Server error loading guests" });
  }
});

// ------------------------------------------------------------
// POST create guest
// ------------------------------------------------------------
router.post("/", (req, res) => {
  try {
    const {
      guest_first_name,
      guest_last_name,
      guest_email,
      date1, date2, date3, date4, date5
    } = req.body;

    const sponsorId = req.session.user.id;
    const leagueId = req.session.user.league_id;
    const ts = easternNow();

    const dates = [date1, date2, date3, date4, date5]
      .filter(Boolean)
      .sort();

    for (const dt of dates) {
      if (!isValidRange(dt)) {
        return res.status(400).json({ error: "Invalid date range." });
      }
    }

    const insertTransaction = db.transaction(() => {

      const stmt = db.prepare(`
        INSERT INTO guests (
          sponsor_user_id, league_id, guest_last_name, guest_first_name, guest_email,
          date1, date2, date3, date4, date5, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = stmt.run(
        sponsorId,
        leagueId,
        guest_last_name.trim(),
        guest_first_name.trim(),
        guest_email?.trim() || null,
        dates[0] || null,
        dates[1] || null,
        dates[2] || null,
        dates[3] || null,
        dates[4] || null,
        ts
      );

      const guestId = info.lastInsertRowid;

      // Write schedule_history rows
      for (const dt of dates) {
        insertHistory({
          user_id: guestId,
          league_id: leagueId,
          play_date: dt,
          old_is_playing: 0,
          new_is_playing: 1,
          old_email: null,
          new_email: guest_email,
          before_state: {},
          after_state: {
            guest_first_name,
            guest_last_name,
            guest_email,
            play_date: dt
          },
          changed_by: sponsorId
        });
      }
    });

    // Execute the transaction
    insertTransaction();

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /api/guests error:", err);
    res.status(500).json({ error: "Server error creating guest" });
  }
});

// ------------------------------------------------------------
// PUT update guest (with left-shift logic + schedule_history)
// ------------------------------------------------------------
router.put("/:id", (req, res) => {
  try {
    const id = req.params.id;
    const sponsorId = req.session.user.id;
    const leagueId = req.session.user.league_id;
    const ts = easternNow();

    const {
      guest_first_name,
      guest_last_name,
      guest_email,
      date1, date2, date3, date4, date5
    } = req.body;

    const updateTransaction = db.transaction(() => {

      const old = db.prepare(`
        SELECT *
          FROM guests
        WHERE id = ? 
          AND sponsor_user_id = ? 
          AND league_id = ?
      `).get(id, sponsorId, leagueId);

      if (!old) {
        return res.status(404).json({ error: "Guest not found" });
      }

      const oldDates = [old.date1, old.date2, old.date3, old.date4, old.date5]
        .filter(Boolean)
        .sort();

      const newDates = [date1, date2, date3, date4, date5]
        .filter(Boolean)
        .sort();

      for (const dt of newDates) {
        if (!isValidRange(dt)) {
          return res.status(400).json({ error: "Invalid date range." });
        }
      }

      db.prepare(`
        UPDATE guests
          SET guest_last_name = ?
            , guest_first_name = ?
            , guest_email = ?
            , date1 = ?
            , date2 = ?
            , date3 = ?
            , date4 = ?
            , date5 = ?
            , updated_at = ?
        WHERE id = ? 
          AND sponsor_user_id = ?
          AND league_id = ?
      `).run(
        guest_last_name.trim(),
        guest_first_name.trim(),
        guest_email?.trim() || null,
        newDates[0] || null,
        newDates[1] || null,
        newDates[2] || null,
        newDates[3] || null,
        newDates[4] || null,
        ts,
        id,
        sponsorId,
        leagueId
      );

      // Detect adds
      for (const dt of newDates) {
        if (!oldDates.includes(dt)) {
          insertHistory({
            user_id: id,
            league_id: leagueId,
            play_date: dt,
            old_is_playing: 0,
            new_is_playing: 1,
            old_email: old.guest_email,
            new_email: guest_email,
            before_state: old,
            after_state: {
              guest_first_name,
              guest_last_name,
              guest_email,
              play_date: dt
            },
            changed_by: sponsorId
          });
        }
      }

      // Detect drops
      for (const dt of oldDates) {
        if (!newDates.includes(dt)) {
          insertHistory({
            user_id: id,
            league_id: leagueId,
            play_date: dt,
            old_is_playing: 1,
            new_is_playing: 0,
            old_email: old.guest_email,
            new_email: guest_email,
            before_state: old,
            after_state: {
              guest_first_name,
              guest_last_name,
              guest_email,
              play_date: dt
            },
            changed_by: sponsorId
          });
        }
      }
    });

    // Execute the transaction
    updateTransaction();

    res.json({ success: true });

  } catch (err) {
    console.error("❌ PUT /api/guests error:", err);
    res.status(500).json({ error: "Server error updating guest" });
  }
});

// ------------------------------------------------------------
// DELETE guest (write drops to schedule_history)
// ------------------------------------------------------------
router.delete("/:id", (req, res) => {
  try {
    const id = req.params.id;
    const sponsorId = req.session.user.id;
    const leagueId = req.session.user.league_id;

    const deleteTransaction = db.transaction(() => {

      const old = db.prepare(`
        SELECT *
          FROM guests
        WHERE id = ? 
          AND sponsor_user_id = ? 
          AND league_id = ?
      `).get(id, sponsorId, leagueId);

      if (!old) {
        return res.status(404).json({ error: "Guest not found" });
      }

      const oldDates = [old.date1, old.date2, old.date3, old.date4, old.date5]
        .filter(Boolean);

      for (const dt of oldDates) {
        insertHistory({
          user_id: id,
          league_id: leagueId,
          play_date: dt,
          old_is_playing: 1,
          new_is_playing: 0,
          old_email: old.guest_email,
          new_email: null,
          before_state: old,
          after_state: {},
          changed_by: sponsorId
        });
      }

      db.prepare(`
        DELETE 
          FROM guests
        WHERE id = ? 
          AND sponsor_user_id = ?
          AND league_id = ?
      `).run(id, sponsorId, leagueId);

    });

    // Execute the transaction
    deleteTransaction();

    res.json({ success: true });

  } catch (err) {
    console.error("❌ DELETE /api/guests error:", err);
    res.status(500).json({ error: "Server error deleting guest" });
  }
});

module.exports = router;
