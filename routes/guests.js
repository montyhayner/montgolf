const express = require("express");
const router = express.Router();
const db = require("../db");

// --- DB helpers (async/await wrappers) ---
function dbGet(sql, params = []) {
  return db.getAsync(sql, params);
}

function dbAll(sql, params = []) {
  return db.allAsync(sql, params);
}

function dbRun(sql, params = []) {
  return db.runAsync(sql, params);
}


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

// ----------------------------------------------------------------------------------------------
// Produce the CURRENT TIMESTAMP in yyyy-mm-dd hh:mn:ss 
// format and return to calling code.
// ----------------------------------------------------------------------------------------------
function formatSqliteTimestamp(d) {
  const pad = n => n.toString().padStart(2, "0");
  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":" +
    pad(d.getSeconds())
  );
}

async function insertHistory({
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
console.log("WRITE schedule_history in guests.js:",
  "user:", user_id,
  "old:", old_is_playing,
  "new:", new_is_playing,
  "changed_at:", formatSqliteTimestamp(new Date())
);
  try {
  await db.runAsync(
    `INSERT INTO schedule_history (
        user_id, league_id, play_date,
        old_is_playing, new_is_playing,
        old_guest_email, new_guest_email,
        changed_by, changed_at, source,
        before_state, after_state
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
    [
      user_id,
      league_id,
      play_date,
      old_is_playing,
      new_is_playing,
      old_email,
      new_email,
      changed_by,
      source,
      JSON.stringify(before_state),
      JSON.stringify(after_state)
    ]
  );
  } catch (err) {
    console.error("insertHistory() function error:", err);
    res.status(500).json({ error: "Server error in guests.js - INSERTing schedule_history" });
  }
}

// ------------------------------------------------------------
// GET guest for logged-in user
// ------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const row = await db.getAsync(
      "SELECT * FROM guests WHERE id = ? AND sponsor_user_id = ?",
      [id, req.session.user.id]
    );

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
router.get("/", async (req, res) => {
  try {
    const rows = await db.allAsync(
      `SELECT *
       FROM guests
       WHERE sponsor_user_id = ?
       ORDER BY guest_last_name, guest_first_name`,
      [req.session.user.id]
    );

    res.json(rows);

  } catch (err) {
    console.error("❌ GET /api/guests error:", err);
    res.status(500).json({ error: "Server error loading guests" });
  }
});

// ------------------------------------------------------------
// POST create guest
// ------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const {
      guest_first_name,
      guest_last_name,
      guest_email,
      date1, date2, date3, date4, date5
    } = req.body;

    const sponsorId = req.session.user.id;
    const leagueId = req.session.user.league_id;

    // Collect + clean + sort dates
    const dates = [date1, date2, date3, date4, date5]
      .filter(d => d)
      .sort();

    for (const dt of dates) {
      if (!isValidRange(dt)) {
        return res.status(400).json({ error: `Invalid date range.` });
      }
    }

    // Insert guest
    const result = await db.runAsync(
      `INSERT INTO guests (
        sponsor_user_id, guest_last_name, guest_first_name, guest_email,
        date1, date2, date3, date4, date5
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sponsorId,
        guest_last_name.trim(),
        guest_first_name.trim(),
        guest_email?.trim() || null,
        dates[0] || null,
        dates[1] || null,
        dates[2] || null,
        dates[3] || null,
        dates[4] || null
      ]
    );

    const guestId = result.lastID;

    // Write schedule_history rows for each date
    for (const dt of dates) {
      await insertHistory({
        user_id: guestId,
        league_id: leagueId,
        play_date: dt,
        old_is_playing: 0,
        new_is_playing: 1,
        old_email: null,
        new_email: guest_email,
        before_state: {},
        after_state: { guest_first_name, guest_last_name, guest_email, play_date: dt },
        changed_by: sponsorId
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /api/guests error:", err);
    res.status(500).json({ error: "Server error creating guest" });
  }
});

// ------------------------------------------------------------
// PUT update guest (with left-shift logic + schedule_history)
// ------------------------------------------------------------
router.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const sponsorId = req.session.user.id;
    const leagueId = req.session.user.league_id;

    const {
      guest_first_name,
      guest_last_name,
      guest_email,
      date1, date2, date3, date4, date5
    } = req.body;

    // Load old guest
    const old = await db.getAsync(
      `SELECT * FROM guests WHERE id = ? AND sponsor_user_id = ?`,
      [id, sponsorId]
    );

    if (!old) {
      return res.status(404).json({ error: "Guest not found" });
    }

    const oldDates = [old.date1, old.date2, old.date3, old.date4, old.date5]
      .filter(d => d)
      .sort();

    // Left-shift new dates
    const newDates = [date1, date2, date3, date4, date5]
      .filter(d => d)
      .sort();

    for (const dt of newDates) {
      if (!isValidRange(dt)) {
        return res.status(400).json({ error: `Invalid date range.` });
      }
    }

    // Update guest
    await db.runAsync(
      `UPDATE guests
       SET guest_last_name = ?, guest_first_name = ?, guest_email = ?,
           date1 = ?, date2 = ?, date3 = ?, date4 = ?, date5 = ?
       WHERE id = ? AND sponsor_user_id = ?`,
      [
        guest_last_name.trim(),
        guest_first_name.trim(),
        guest_email?.trim() || null,
        newDates[0] || null,
        newDates[1] || null,
        newDates[2] || null,
        newDates[3] || null,
        newDates[4] || null,
        id,
        sponsorId
      ]
    );

    // Detect adds
    for (const dt of newDates) {
      if (!oldDates.includes(dt)) {
        await insertHistory({
          user_id: id,
          league_id: leagueId,
          play_date: dt,
          old_is_playing: 0,
          new_is_playing: 1,
          old_email: old.guest_email,
          new_email: guest_email,
          before_state: old,
          after_state: { guest_first_name, guest_last_name, guest_email, play_date: dt },
          changed_by: sponsorId
        });
      }
    }

    // Detect drops
    for (const dt of oldDates) {
      if (!newDates.includes(dt)) {
        await insertHistory({
          user_id: id,
          league_id: leagueId,
          play_date: dt,
          old_is_playing: 1,
          new_is_playing: 0,
          old_email: old.guest_email,
          new_email: guest_email,
          before_state: old,
          after_state: { guest_first_name, guest_last_name, guest_email, play_date: dt },
          changed_by: sponsorId
        });
      }
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ PUT /api/guests error:", err);
    res.status(500).json({ error: "Server error updating guest" });
  }
});

// ------------------------------------------------------------
// DELETE guest (write drops to schedule_history)
// ------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const sponsorId = req.session.user.id;
    const leagueId = req.session.user.league_id;

    const old = await db.getAsync(
      `SELECT * FROM guests WHERE id = ? AND sponsor_user_id = ?`,
      [id, sponsorId]
    );

    if (!old) {
      return res.status(404).json({ error: "Guest not found" });
    }

    const oldDates = [old.date1, old.date2, old.date3, old.date4, old.date5]
      .filter(d => d);

    // Write drops to schedule_history
    for (const dt of oldDates) {
      await insertHistory({
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

    // Delete guest
    await db.runAsync(
      `DELETE FROM guests WHERE id = ? AND sponsor_user_id = ?`,
      [id, sponsorId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("❌ DELETE /api/guests error:", err);
    res.status(500).json({ error: "Server error deleting guest" });
  }
});

module.exports = router;
