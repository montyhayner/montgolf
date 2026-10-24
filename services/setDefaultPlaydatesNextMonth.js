// services/setDefaultPlaydatesNextMonth.js

const db = require("../db.js");   // correct better-sqlite3 wrapper
const { easternNow } = require('../utils/easternTime');
const ts = easternNow();

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
  
// Get golfers who are in town but have no play days on their calendar for next month.
// For each such golfer, find each date of next month that matches the golfer's DOW days 
// and INSERT a row into schedule with is_playing = 1 ... on conflict do nothing (another
// way of saying that we keep any schedule row that already exists - we do NOT overwrite
// is_playing=0  with is_playing=1).                                        
    const sql = `
      INSERT INTO schedule (user_id, league_id, date, is_playing, updated_at)
      SELECT u.user_id
	         , u.league_id
           , d.date
           , 1
           , ?
        FROM user_play_months u
        JOIN user_play_days p
          ON p.user_id = u.user_id
         AND p.league_id = u.league_id
         AND p.is_play_day = 1
        JOIN calendar_dates d
          ON d.day_of_week = p.day_of_week        
         AND d.date >= ?
         AND d.date <  ? 
	     WHERE u.month = ?
         AND u.in_town = 1   
         AND NOT EXISTS (
              SELECT 1
                FROM schedule s
               WHERE s.user_id = u.user_id
                 AND s.league_id = u.league_id
                 AND s.date >= ?
                 AND s.date <  ?
                 AND s.is_playing = 1
	          )
    ON CONFLICT DO NOTHING
  `;

  try {
    const stmt = db.prepare(sql);

    const info = stmt.run(
        ts                     // current timestamp
      , nextMonthStart         // d.date >= ?
      , monthAfterNextStart    // d.date < ?
      , nextMonthNumber        // u.month = ?
      , nextMonthStart         // NOT EXISTS range start
      , monthAfterNextStart    // NOT EXISTS range end
    );

    console.log(`✅ Default playdates UPSERT complete. Rows affected: ${info.changes}`);
    return info.changes;

  } catch (err) {
    console.error("❌ Error in setDefaultPlaydatesNextMonth:", err);
    throw err;
  }
}

module.exports = setDefaultPlaydatesNextMonth;
