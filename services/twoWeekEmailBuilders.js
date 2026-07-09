// ============================================================================
// Shared HTML Builders for Two-Week Email Reports
// ============================================================================

// ------------------------------------------------------
// Build Golfers Table (User-Friendly Version)
// ------------------------------------------------------
function buildTwoWeekTableHTML(data) {
  let html = `
    <table class="report-table" style="table-layout: fixed; width: auto;">
      <thead>
        <tr style="background:#e6ffe6;">
          <th style="background:#e6ffe6; text-align:left; width:180px; padding:4px 6px;">
            Golfer
          </th>
  `;

  data.dates.forEach(d => {
    const [year, month, day] = d.split("-").map(Number);
    const dt = new Date(year, month - 1, day);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    html += `
      <th style="background:#e6ffe6; text-align:center; width:55px; padding:4px 2px;">
        <div>${dow}</div>
        <div style="font-size:12px; color:#555;">${md}</div>
      </th>
    `;
  });

  html += `
        </tr>
      </thead>
      <tbody>
  `;

  data.players.forEach((p, idx) => {
    html += `
      <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#e6ffe6'};">
        <td>${p.name}</td>
    `;

    data.dates.forEach(d => {
      html += `<td style="text-align:center;">${p.plays[d] || " "}</td>`;
    });

    html += `</tr>`;
  });

  const totalRowColor = data.players.length % 2 === 0 ? '#ffffff' : '#e6ffe6';

  html += `
    <tr style="background:${totalRowColor}; font-weight:bold;">
      <td>Total</td>
  `;

  data.dates.forEach(d => {
    html += `<td style="text-align:center;">${data.totals[d]}</td>`;
  });

  html += `
    </tr>
    </tbody>
    </table>
  `;

  return html;
}

// ------------------------------------------------------
// Build Allocated Tee Times Table
// ------------------------------------------------------
function buildAllocatedTeeTimesTableHTML(dates, allocated) {
  const allTeeNumbers = new Set();

  dates.forEach(date => {
    const rows = allocated[date] || [];
    rows.forEach(r => allTeeNumbers.add(r.tee_time_number));
  });

  const teeNumbers = Array.from(allTeeNumbers).sort((a, b) => a - b);

  let html = `
    <table class="report-table" style="table-layout: fixed; width: auto;">
      <thead>
        <tr style="background:#e6ffe6;">
          <th style="background:#e6ffe6; text-align:left; width:120px; padding:4px 6px;">
            Tee Time
          </th>
  `;

  dates.forEach(d => {
    const [year, month, day] = d.split("-").map(Number);
    const dt = new Date(year, month - 1, day);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    html += `
      <th style="background:#e6ffe6; text-align:center; width:55px; padding:4px 2px;">
        <div>${dow}</div>
        <div style="font-size:12px; color:#555;">${md}</div>
      </th>
    `;
  });

  html += `
        </tr>
      </thead>
      <tbody>
  `;

  html += `<tr><td><strong>Starting 9</strong></td>`;
  dates.forEach(date => {
    const rows = allocated[date] || [];
    const starting9 = rows.length > 0 ? rows[0].first_nine : "—";
    html += `<td style="text-align:center;">${starting9}</td>`;
  });
  html += `</tr>`;

  teeNumbers.forEach((num, idx) => {
    html += `
      <tr style="background:${idx % 2 === 0 ? '#e6ffe6' : '#ffffff'};">
        <td>${num}</td>
    `;

    dates.forEach(date => {
      const rows = allocated[date] || [];
      const match = rows.find(r => r.tee_time_number === num);
      html += `<td style="text-align:center;">${match ? match.tee_time : ""}</td>`;
    });

    html += `</tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  return html;
}

// ------------------------------------------------------
// Build Full Email HTML
// ------------------------------------------------------
function buildUserTwoWeekEmailHTML(data, allocated) {
  return `
    <h2>Two-Week Golfers Report</h2>

    ${buildTwoWeekTableHTML(data)}

    <h2>Allocated Tee Times</h2>
    ${buildAllocatedTeeTimesTableHTML(data.dates, allocated)}
  `;
}

module.exports = {
  buildTwoWeekTableHTML,
  buildAllocatedTeeTimesTableHTML,
  buildUserTwoWeekEmailHTML
};
