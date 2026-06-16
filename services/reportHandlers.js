// ------------------------------------------------------------
// IMPORTS
// ------------------------------------------------------------
const db = require("../db");
const transporter = require("./mailer");

// ------------------------------------------------------------
// LATEST TEE SHEET HELPERS (your code)
// ------------------------------------------------------------
function generateLatestTeeSheetText(teeSheet, playDate, leagueName) {
  let text = `Latest Tee Sheet Report - ${leagueName}\n`;
  text += `Play Date: ${playDate}\n\n`;

  for (const row of teeSheet) {
    text += `${row.tee_time}  ${row.first_name} ${row.last_name}  `;
    text += `Subgroup ${row.subgroup} #${row.subgroup_number}\n`;
  }

  return text;
}

function generateLatestTeeSheetHTML(teeSheet, playDate, leagueName) {
  let html = `<h2>Latest Tee Sheet Report - ${leagueName}</h2>`;
  html += `<h3>${playDate}</h3>`;
  html += `<table border="1" cellpadding="6" cellspacing="0">
             <tr>
               <th>Tee Time</th>
               <th>Name</th>
               <th>Subgroup</th>
               <th>#</th>
             </tr>`;

  for (const row of teeSheet) {
    html += `<tr>
      <td>${row.tee_time}</td>
      <td>${row.first_name} ${row.last_name}</td>
      <td>${row.subgroup}</td>
      <td>${row.subgroup_number}</td>
    </tr>`;
  }

  html += `</table>`;
  return html;
}

// ------------------------------------------------------------
// TWO-WEEK REPORT (USER-FACING VERSION)
// ------------------------------------------------------------
function buildTwoWeekUserReportData(db, leagueId) {
  const rows = db.prepare(`
    SELECT 
      u.first_name,
      u.last_name,
      u.email,
      s.date AS play_date,
      s.tee_time,
      s.subgroup,
      s.subgroup_number
    FROM schedule s
    JOIN users u ON u.id = s.user_id
    WHERE s.is_playing = 1
      AND u.league_id = ?
      AND s.date >= datetime(CURRENT_TIMESTAMP, '-4 hours')
      AND s.date <= datetime(CURRENT_TIMESTAMP, '+14 days', '-4 hours')
    ORDER BY s.date, s.tee_time, u.last_name, u.first_name
  `).all(leagueId);

  return rows;
}

// ------------------------------------------------------------
// TWO‑WEEK REPORT HELPERS (your code)
// ------------------------------------------------------------
async function buildTwoWeekReportData(db, leagueId) {
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

  return { dates, rows, totals, allocatedTeeTimes };
}

function generateTwoWeekReportHTML(dates, rows, totals, allocatedTeeTimes, leagueName = "") {
  if (!dates || dates.length === 0) {
    return `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        <h2>Two‑Week Golfers Report - ${leagueName}</h2>
        <p>No scheduled play in the next 14 days.</p>
      </div>
    `;
  }

  function buildAllocatedTeeTimesTableHTML(dates, allocated) {
    const allTeeNumbers = new Set();

    dates.forEach(date => {
      const rows = allocated[date] || [];
      rows.forEach(r => allTeeNumbers.add(r.tee_time_number));
    });

    const teeNumbers = Array.from(allTeeNumbers).sort((a, b) => a - b);

    let html = `
      <table style="width:100%; border-collapse: collapse; max-width: 700px; margin: 20px auto 0 auto;">
      <thead>
        <tr style="background:#e6ffe6;">
          <th style="padding: 8px; border:1px solid #ccc; text-align:left;">Tee Time</th>
          ${dates.map(d => {
            const [y, m, day] = d.split("-").map(Number);
            const dt = new Date(y, m - 1, day);
            const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
            const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

            return `
              <th style="padding: 8px; border:1px solid #ccc; text-align:center;">
                <div>${dow}</div>
                <div style="font-size:12px; color:#555;">${md}</div>
              </th>
            `;
          }).join("")}
        </tr>
      </thead>
      <tbody>
    `;

    html += `
      <tr style="background:#ffffff;">
        <td style="padding: 6px; border:1px solid #ccc;"><strong>Starting 9</strong></td>
        ${dates.map(date => {
          const rows = allocated[date] || [];
          const starting9 = rows.length > 0 ? rows[0].first_nine : "—";
          return `
            <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
              ${starting9}
            </td>
          `;
        }).join("")}
      </tr>
    `;

    teeNumbers.forEach((num, idx) => {
      html += `
        <tr style="background:${idx % 2 === 0 ? '#e6ffe6' : '#ffffff'};">
          <td style="padding: 6px; border:1px solid #ccc;">${num}</td>
      `;

      dates.forEach(date => {
        const rows = allocated[date] || [];
        const match = rows.find(r => r.tee_time_number === num);

        html += `
          <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
            ${match ? match.tee_time : ""}
          </td>
        `;
      });

      html += `</tr>`;
    });

    html += `
        </tbody>
      </table>
    `;

    return html;
  }

  return `
  <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
    <h2 style="text-align:center; margin-bottom: 20px;">
      Two‑Week Golfers Report - ${leagueName}
    </h2>

    <table style="width:100%; border-collapse: collapse; max-width: 700px; margin: 0 auto;">
    <thead>
      <tr style="background:#e6ffe6;">
        <th style="padding: 8px; border:1px solid #ccc; text-align:left;">Golfer</th>
        ${dates.map(d => {
          const [year, month, day] = d.split("-").map(Number);
          const dt = new Date(year, month - 1, day);
          const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
          const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

          return `
            <th style="padding: 8px; border:1px solid #ccc; text-align:center;">
              <div>${dow}</div>
              <div style="font-size:12px; color:#555;">${md}</div>
            </th>
          `;
        }).join("")}
      </tr>
    </thead>

    <tbody>
      ${rows.map((r, idx) => `
        <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#e6ffe6'};">
          <td style="padding: 6px; border:1px solid #ccc;">${r.name}</td>
          ${dates.map(d => `
            <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
              ${r.plays[d] || ""}
            </td>
          `).join("")}
        </tr>
      `).join("")}

      <tr style="background:${rows.length % 2 === 0 ? '#ffffff' : '#e6ffe6'}; font-weight:bold;">
        <td style="padding: 6px; border:1px solid #ccc;">Total</td>
        ${dates.map(d => `
          <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
            ${totals[d]}
          </td>
        `).join("")}
      </tr>
    </tbody>
    </table>

    <hr style="margin:30px 0; border:none; border-top:1px solid #ccc;" />

    <h3 style="text-align:center; margin-bottom:10px;">Allocated Tee Times</h3>

    ${buildAllocatedTeeTimesTableHTML(dates, allocatedTeeTimes)}

  </div>
  `;
}

// ------------------------------------------------------------
// ROUTE HANDLERS (NEW)
// ------------------------------------------------------------

// 1. GET /reports/two-week
async function getTwoWeekReport(req, res) {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    const { dates, rows, totals, allocatedTeeTimes } =
      await buildTwoWeekReportData(db, leagueId);

    res.json({ dates, rows, totals, allocatedTeeTimes });

  } catch (err) {
    console.error("❌ getTwoWeekReport error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// 2. POST /admin/reports/two-week/email
async function sendTwoWeekReportEmail(req, res) {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    const league = db.prepare(`
      SELECT league_name FROM leagues WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";

    const { dates, rows, totals, allocatedTeeTimes } =
      await buildTwoWeekReportData(db, leagueId);

    const htmlReport = generateTwoWeekReportHTML(
      dates, rows, totals, allocatedTeeTimes, leagueName
    );

    const textReport = htmlReport.replace(/<[^>]+>/g, "");

    let recipients = [];

    if (!user.is_admin && !user.is_super_admin) {
      recipients = [user.email];
    } else {
      const { includeSelf } = req.body;
      if (includeSelf) recipients.push(user.email);
    }

    await transporter.sendMail({
      from: "rlhayner@verizon.net",
      to: recipients.join(", "),
      subject: `Two-Week Golfers Report - ${leagueName}`,
      text: textReport,
      html: htmlReport
    });

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ sendTwoWeekReportEmail error:", err);
    res.status(500).json({ error: "Unable to send report email" });
  }
}

// 3. GET /reports/latest-tee-sheet
async function getLatestTeeSheet(req, res) {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    const row = db.prepare(`
      SELECT MAX(tee_date) AS latest_date
      FROM tee_sheet
      WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.latest_date) {
      return res.json({ teeSheet: [], play_date: null });
    }

    const latestDate = row.latest_date;

    const teeSheet = db.prepare(`
      SELECT ts.tee_time, ts.subgroup, ts.subgroup_number,
             u.first_name, u.last_name
      FROM tee_sheet ts
      JOIN users u ON u.id = ts.user_id
      WHERE ts.league_id = ? AND ts.tee_date = ?
      ORDER BY ts.tee_time, ts.subgroup, ts.subgroup_number
    `).all(leagueId, latestDate);

    res.json({ play_date: latestDate, teeSheet });

  } catch (err) {
    console.error("❌ getLatestTeeSheet error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// 4. POST /admin/reports/latest-tee-sheet/email
async function sendLatestTeeSheetEmail(req, res) {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    const league = db.prepare(`
      SELECT league_name FROM leagues WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";

    const row = db.prepare(`
      SELECT MAX(tee_date) AS latest_date
      FROM tee_sheet
      WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.latest_date) {
      await transporter.sendMail({
        from: "rlhayner@verizon.net",
        to: user.email,
        subject: `Latest Tee Sheet Report - ${leagueName}`,
        text: "No tee sheet found.",
        html: "<p>No tee sheet found.</p>"
      });

      return res.json({ ok: true });
    }

    const latestDate = row.latest_date;

    const teeSheet = db.prepare(`
      SELECT ts.tee_time, ts.subgroup, ts.subgroup_number,
             u.first_name, u.last_name
      FROM tee_sheet ts
      JOIN users u ON u.id = ts.user_id
      WHERE ts.league_id = ? AND ts.tee_date = ?
      ORDER BY ts.tee_time, ts.subgroup, ts.subgroup_number
    `).all(leagueId, latestDate);

    const textReport = generateLatestTeeSheetText(teeSheet, latestDate, leagueName);
    const htmlReport = generateLatestTeeSheetHTML(teeSheet, latestDate, leagueName);

    let recipients = [];

    if (!user.is_admin && !user.is_super_admin) {
      recipients = [user.email];
    } else {
      const { includeSelf } = req.body;
      if (includeSelf) recipients.push(user.email);
    }

    await transporter.sendMail({
      from: "rlhayner@verizon.net",
      to: recipients.join(", "),
      subject: `Latest Tee Sheet Report - ${leagueName}`,
      text: textReport,
      html: htmlReport
    });

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ sendLatestTeeSheetEmail error:", err);
    res.status(500).json({ error: "Unable to send report email" });
  }
}

// ------------------------------------------------------------
// EXPORTS
// ------------------------------------------------------------
module.exports = {
  // helpers
  generateLatestTeeSheetText,
  generateLatestTeeSheetHTML,
  buildTwoWeekReportData,
  generateTwoWeekReportHTML,

  // route handlers
  getTwoWeekReport,
  sendTwoWeekReportEmail,
  getLatestTeeSheet,
  sendLatestTeeSheetEmail
};