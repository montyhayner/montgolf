// services/buildTwoWeekReportData.js

async function buildTwoWeekReportData(db, leagueId) {

  // ------------------------------------------------------------
  // 1. Dates in next 14 days
  // ------------------------------------------------------------
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

  const dates = dateRows.map(r => r.play_date);

  if (dates.length === 0) {
    return { dates: [], rows: [], totals: {}, allocatedTeeTimes: {} };
  }

  // ------------------------------------------------------------
  // 2. Players
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // 3. Guests
  // ------------------------------------------------------------
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
      guest_dates: [g.date1, g.date2, g.date3, g.date4, g.date5].filter(Boolean)
    }))
  ];

  // ------------------------------------------------------------
  // 4. Build spreadsheet matrix
  // ------------------------------------------------------------
  const totals = {};
  dates.forEach(d => totals[d] = 0);

  const rows = allPeople.map(person => {
    const name = `${person.first_name} ${person.last_name}${person.is_member ? "" : "*"}`;
    const plays = {};

    for (const d of dates) {
      let mark = " ";

      if (person.type === "player") {
        const r = db.prepare(`
          SELECT is_playing
          FROM schedule
          WHERE user_id = ? AND date = ?
        `).get(person.id, d);

        if (r && r.is_playing === 1) {
          mark = "Y";
          totals[d]++;
        }
      } else if (person.type === "guest") {
        if (person.guest_dates.includes(d)) {
          mark = "Y";
          totals[d]++;
        }
      }

      plays[d] = mark;
    }

    return { id: person.id, is_guest: person.type === "guest" ? 1 : 0, name, plays };
  });

  // ------------------------------------------------------------
  // 5. Allocated Tee Times (NEW)
  // ------------------------------------------------------------
  const allocatedTeeTimes = {};

  dates.forEach(date => {
    const rows = db.prepare(`
      SELECT tee_time_number, tee_time, first_nine
      FROM allocated_tee_times
      WHERE league_id = ?
        AND play_date = ?
      ORDER BY tee_time_number
    `).all(leagueId, date);

    allocatedTeeTimes[date] = rows;
  });

  // ------------------------------------------------------------
  // 6. Return unified structure
  // ------------------------------------------------------------
  return {
    dates,
    rows,
    totals,
    allocatedTeeTimes
  };
}

module.exports = buildTwoWeekReportData;