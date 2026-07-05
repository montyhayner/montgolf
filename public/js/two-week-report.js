// ============================================================================
// unified-two-week-report.js
// Two-Week Golfers Report + Allocated Tee Times (side-by-side)
// Uses unified endpoint: /api/reports/two-week/full
// ============================================================================

// ------------------------------------------------------
// Helper: Build Allocated Tee Times HTML (right column)
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
          <th style="
            background:#e6ffe6;
            text-align:left;
            width: 120px;
            min-width: 120px;
            max-width: 120px;
            padding: 4px 6px;
          ">
            Tee Time
          </th>
  `;

  dates.forEach(d => {
    const [year, month, day] = d.split("-").map(Number);
    const dt = new Date(year, month - 1, day);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    html += `
      <th style="
        background:#e6ffe6;
        text-align:center;
        width: 55px;
        min-width: 55px;
        max-width: 55px;
        padding: 4px 2px;
      ">
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

  html += `<tr style="background:#ffffff;"><td><strong>Starting 9</strong></td>`;

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
// Helper: Build Two-Week Golfers Report Table (left column)
// ------------------------------------------------------
function buildTwoWeekTableHTML(data, playersInReport, guestsInReport) {
  let html = `
    <table class="report-table" style="table-layout: fixed; width: auto;">
      <thead>
        <tr style="background:#e6ffe6;">
          <th style="
            background:#e6ffe6;
            text-align:left;
            width: 180px;
            min-width: 180px;
            max-width: 180px;
            padding: 4px 6px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          ">
            Golfer
          </th>
  `;

  data.dates.forEach(d => {
    const [year, month, day] = d.split("-").map(Number);
    const dt = new Date(year, month - 1, day);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    html += `
      <th style="
        background:#e6ffe6;
        text-align:center;
        width: 55px;
        min-width: 55px;
        max-width: 55px;
        padding: 4px 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      ">
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
    if (p.is_guest) {
      guestsInReport.add(p.id);
    } else {
      playersInReport.add(p.id);
    }

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
// DOMContentLoaded
// ------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const playersInReport = new Set();
  const guestsInReport = new Set();

  const container = document.getElementById("report-table-container");
  const res = await fetch("/api/reports/two-week/full", { credentials: "include" });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.log("JSON PARSE FAILED");
    return;
  }

  const leftHTML = buildTwoWeekTableHTML(data, playersInReport, guestsInReport);
  const rightHTML = buildAllocatedTeeTimesTableHTML(data.dates, data.allocatedTeeTimes);

  container.innerHTML = `
    <div class="reports-two-column">
      <div class="left-report">
        ${leftHTML}
      </div>
      <div class="right-report">
        ${rightHTML}
      </div>
    </div>
  `;

  const modal = document.getElementById("sendReportModal");

  document.getElementById("btnEmailReport").addEventListener("click", () => {
    modal.classList.remove("hidden");
  });

  document.getElementById("btnCancelSend").addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  document.getElementById("chkSelectAll").addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.getElementById("chkPlayers").checked = checked;
    document.getElementById("chkAdmins").checked = checked;
    document.getElementById("chkStaff").checked = checked;
  });

  document.getElementById("btnSendReport").addEventListener("click", async () => {
    const selfOnly = document.getElementById("chkSelfOnly").checked;

    const payload = {
      includePlayers: selfOnly ? false : document.getElementById("chkPlayers").checked,
      includeAdmins: selfOnly ? false : document.getElementById("chkAdmins").checked,
      includeStaff: selfOnly ? false : document.getElementById("chkStaff").checked,
      includeSelf: true,
      playersInReport: selfOnly ? [] : Array.from(playersInReport),
      guestsInReport: selfOnly ? [] : Array.from(guestsInReport)
    };

    const response = await fetch("/api/reports/two-week/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      alert("Report sent successfully");
      modal.classList.add("hidden");
    } else {
      alert("Error sending report");
    }
  });
});
