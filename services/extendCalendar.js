const db = require("../db.js");

function extendCalendarDates() {
  const sql = `
    WITH RECURSIVE dates(d) AS (
        SELECT COALESCE(MAX(date), CURRENT_DATE)
        FROM calendar_dates

        UNION ALL

        SELECT date(d, '+1 day')
        FROM dates
        WHERE d < date(CURRENT_DATE, '+14 months', '-1 day')
    )
    INSERT OR IGNORE INTO calendar_dates (date, day_of_week)
    SELECT
        d,
        CAST(strftime('%w', d) AS INTEGER)
    FROM dates;
  `;

  const stmt = db.prepare(sql);
  const info = stmt.run();

  return info.changes;   // number of new rows inserted
}

module.exports = { extendCalendarDates };
