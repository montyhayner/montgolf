document.addEventListener("DOMContentLoaded", async () => {

  // Track players + guests appearing in the report
  const playersInReport = new Set();
  const guestsInReport = new Set();

  // Load the report data
  const container = document.getElementById("report-table-container");
  const res = await fetch("/admin/reports/two-week", { credentials: "include" });

  console.log("STATUS:", res.status);

  const text = await res.text();
  console.log("RAW RESPONSE:", text);

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.log("JSON PARSE FAILED");
    return;
  }

  // Build table HTML
  let html = `
    <table class="report-table" style="table-layout: fixed; width: auto;">
      <thead>
        <tr>
          <th style="
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

  // Date headers (DOW + M/D, no leading zeros, narrow columns)
  data.dates.forEach(d => {
    const [year, month, day] = d.split("-").map(Number);
    const dt = new Date(year, month - 1, day);

    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    html += `
      <th style="
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

  // Capture players + guests
  data.players.forEach(p => {

    if (p.is_guest) {
      guestsInReport.add(p.id);
    } else {
      playersInReport.add(p.id);
    }

    html += `<tr><td>${p.name}</td>`;
    data.dates.forEach(d => {
      html += `<td>${p.plays[d] || " "}</td>`;
    });
    html += `</tr>`;
  });

  // Totals row
  html += `<tr class="totals-row"><td><strong>Total</strong></td>`;
  data.dates.forEach(d => {
    html += `<td>${data.totals[d]}</td>`;
  });
  html += `</tr>`;

  html += `</tbody></table>`;
  container.innerHTML = html;

  // -----------------------------
  // MODAL OPEN/CLOSE
  // -----------------------------
  const modal = document.getElementById("sendReportModal");

  document.getElementById("btnEmailReport").addEventListener("click", () => {
    modal.classList.remove("hidden");
  });

  document.getElementById("btnCancelSend").addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  // -----------------------------
  // SELECT ALL CHECKBOX
  // -----------------------------
  document.getElementById("chkSelectAll").addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.getElementById("chkPlayers").checked = checked;
    document.getElementById("chkAdmins").checked = checked;
    document.getElementById("chkStaff").checked = checked;
  });

  // -----------------------------
  // SEND REPORT EMAIL
  // -----------------------------
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

    console.log("PAYLOAD:", payload);

    const response = await fetch("/admin/reports/two-week/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
