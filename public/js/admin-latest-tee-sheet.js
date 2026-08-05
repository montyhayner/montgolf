// ============================================================
// Load Latest Tee Sheet (Admin Version)
// ============================================================
async function loadLatestTeeSheet() {
  const res = await fetch("/api/reports/latest-tee-sheet", {
    credentials: "include"
  });
  const data = await res.json();

  if (!data.ok) {
    document.getElementById("teeSheetBody").innerHTML =
      `<tr><td colspan="3">No tee sheet available</td></tr>`;
    return;
  }

  // Set page header
  loadPageHeader("Latest Tee Sheet Report", data.longDate);

  const tbody = document.getElementById("teeSheetBody");
  tbody.innerHTML = "";

  data.teeSheet.forEach(row => {
    const players = [
      row.first_name1 && `${row.first_name1} ${row.last_name1}`,
      row.first_name2 && `${row.first_name2} ${row.last_name2}`,
      row.first_name3 && `${row.first_name3} ${row.last_name3}`,
      row.first_name4 && `${row.first_name4} ${row.last_name4}`
    ].filter(Boolean).join(", ");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.tee_time}</td>
      <td>${row.starting_nine}</td>
      <td>${players}</td>
    `;
    tbody.appendChild(tr);
  });

  // Print button
  document.getElementById("btnPrintLatest").onclick = () => window.print();

  // Send button → open modal
  document.getElementById("btnSendLatest").onclick = () => {
    sendReportModal.classList.remove("hidden");
  };
}

// ============================================================
// Modal Elements
// ============================================================
const sendReportModal = document.getElementById("sendReportModal");
const btnSendReport = document.getElementById("btnSendReport");
const btnCancelSend = document.getElementById("btnCancelSend");

// ============================================================
// Modal Close
// ============================================================
btnCancelSend.addEventListener("click", () => {
  sendReportModal.classList.add("hidden");
});

// ============================================================
// Select All
// ============================================================
document.getElementById("chkSelectAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.getElementById("chkPlayers").checked = checked;
  document.getElementById("chkAdmins").checked = checked;
  document.getElementById("chkStaff").checked = checked;
});

// ============================================================
// SEND REPORT (ADMIN)
// ============================================================
btnSendReport.addEventListener("click", async () => {

  const selfOnly = document.getElementById("chkSelfOnly").checked;

  const payload = {
    includePlayers: selfOnly ? false : document.getElementById("chkPlayers").checked,
    includeAdmins:  selfOnly ? false : document.getElementById("chkAdmins").checked,
    includeStaff:   selfOnly ? false : document.getElementById("chkStaff").checked,
    includeSelf: true,
    selfOnly
  };

  const response = await fetch("/api/reports/admin-latest-tee-sheet/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (response.ok) {
    if (data.recipients) {
      alert("Emails sent to:\n\n" + data.recipients.join("\n"));
    } else {
      alert("Report sent successfully");
    }
    sendReportModal.classList.add("hidden");
  } else {
    alert("Error sending report: " + (data.error || ""));
  }
});

// ============================================================
// Init
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  await loadLatestTeeSheet();
});
