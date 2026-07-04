// ============================================================================
// user-two-week-report.js
// Two-Week Golfers Report (User Version)
// Sends report ONLY to the logged-in user.
// ============================================================================

// ------------------------------------------------------
// Helper: Build Allocated Tee Times HTML
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
// Helper: Build Two-Week Golfers Report Table
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
// DOMContentLoaded — USER VERSION (Single Column)
// ------------------------------------------------------
// ============================================================================
// user-two-week-report.js
// Two-Week Golfers Report (User Version)
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {

  const golfersContainer = document.getElementById("user-golfers-container");
  const teeTimesContainer = document.getElementById("user-tee-times-container");

  const res = await fetch("/api/reports/two-week/full", { credentials: "include" });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.log("JSON PARSE FAILED");
    return;
  }

  const leftHTML  = buildTwoWeekTableHTML(data);
  const rightHTML = buildAllocatedTeeTimesTableHTML(data.dates, data.allocatedTeeTimes);

  // Inject into correct containers (matching your HTML)
  golfersContainer.innerHTML = leftHTML;
  teeTimesContainer.innerHTML = rightHTML;

  // USER SEND REPORT — NO MODAL
  document.getElementById("btnEmailReport").addEventListener("click", async () => {
    try {
      const response = await fetch("/api/reports/user-two-week/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (response.ok) {
        alert("Your two-week report has been emailed.");
      } else {
        alert("Error sending your report.");
      }
    } catch (err) {
      console.error("Error:", err);
      alert("Error sending your report.");
    }
  });
});
