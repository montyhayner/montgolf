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
function buildAllocatedTeeTimesHTML(dates, allocated) {
  let html = `
    <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr style="background:#e6ffe6; height:22px;">
          <th style="padding:4px; text-align:center;">Tee Time</th>
  `;

  // Column headers
  dates.forEach(d => {
    const dt = new Date(d);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    html += `
      <th style="background:#e6ffe6; text-align:center; padding:4px; height:22px;">
        ${dow}<br>
        <span style="font-size:12px; color:#555;">${md}</span>
      </th>
    `;
  });

  html += `
        </tr>
      </thead>
      <tbody>
  `;

  // Row: Starting 9
  html += `
    <tr style="background:#ffffff; height:22px;">
      <td style="padding:4px; text-align:center;"><strong>Starting 9</strong></td>
  `;
  dates.forEach(d => {
    const slots = allocated[d] || [];
    const firstNine = slots.length > 0 ? slots[0].first_nine : "";
    html += `<td style="padding:4px; text-align:center;">${firstNine}</td>`;
  });
  html += `</tr>`;

  // Rows: Tee times #1, #2, #3
  for (let i = 1; i <= 3; i++) {
    const bg = i % 2 === 1 ? "#e6ffe6" : "#ffffff";  // alternate colors

    html += `
      <tr style="background:${bg}; height:22px;">
        <td style="padding:4px; text-align:center;"><strong>${i}</strong></td>
    `;

    dates.forEach(d => {
      const slots = allocated[d] || [];
      const slot = slots[i - 1];
      html += `<td style="padding:4px; text-align:center;">${slot ? slot.tee_time : ""}</td>`;
    });

    html += `</tr>`;
  }

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
    ${buildAllocatedTeeTimesHTML(data.dates, allocated)}
  `;
}

module.exports = {
  buildTwoWeekTableHTML,
  buildAllocatedTeeTimesHTML,
  buildUserTwoWeekEmailHTML
};
