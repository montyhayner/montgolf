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

  // Build table
  let html = `<table class="report-table"><thead><tr><th>Golfer</th>`;

  data.dates.forEach(d => {
    html += `<th>${d}</th>`;
  });

  html += `</tr></thead><tbody>`;

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
