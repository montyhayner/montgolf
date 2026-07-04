// services/setDefaultPlaydatesNextMonth.js

const db = require("../db.js");   // correct better-sqlite3 wrapper

/**
 * Auto-populate next month's schedule for golfers who:
 *  1) are in town next month
 *  2) have weekly play days
 *  3) have ZERO schedule rows for next month
 *
 * @param {string} nextMonthStart - "YYYY-MM-01"
 * @param {string} monthAfterNextStart - "YYYY-MM-01"
 * @param {number} nextMonthNumber - 1–12
 */
async function setDefaultPlaydatesNextMonth(nextMonthStart, monthAfterNextStart, nextMonthNumber) {
  console.log("🏌️‍♂️ Running setDefaultPlaydatesNextMonth with:", {
    nextMonthStart,
    monthAfterNextStart,
    nextMonthNumber
  });

  const sql = `
    INSERT INTO schedule (user_id, date, is_playing, updated_at)
    SELECT 
        u.user_id,
        d.date,
        1,
        datetime(CURRENT_TIMESTAMP, '-4 HOURS')
    FROM user_play_months u
    JOIN user_play_days p
      ON p.user_id = u.user_id
    JOIN calendar_dates d
      ON strftime('%w', d.date) = p.day_of_week
    WHERE u.month = ?
      AND u.in_town = 1
      AND p.is_play_day = 1
      AND d.date >= ?
      AND d.date < ?
      AND NOT EXISTS (
            SELECT 1
            FROM schedule s
            WHERE s.user_id = u.user_id
              AND s.date >= ?
              AND s.date < ?
              AND s.is_playing = 1
      )
    ON CONFLICT(user_id, date)
    DO UPDATE SET 
        is_playing = 1,
        updated_at = datetime(CURRENT_TIMESTAMP, '-4 HOURS');
  `;

  try {
    const stmt = db.prepare(sql);

    const info = stmt.run(
      nextMonthNumber,        // u.month = ?
      nextMonthStart,         // d.date >= ?
      monthAfterNextStart,    // d.date < ?
      nextMonthStart,         // NOT EXISTS range start
      monthAfterNextStart     // NOT EXISTS range end
    );

    console.log(`✅ Default playdates UPSERT complete. Rows affected: ${info.changes}`);
    return info.changes;

  } catch (err) {
    console.error("❌ Error in setDefaultPlaydatesNextMonth:", err);
    throw err;
  }
}

module.exports = setDefaultPlaydatesNextMonth;
