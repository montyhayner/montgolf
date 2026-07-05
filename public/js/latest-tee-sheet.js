async function loadLatestTeeSheet() {
  const res = await fetch("/api/reports/latest-tee-sheet");
  const data = await res.json();

  if (!data.ok) {
    document.getElementById("teeSheetBody").innerHTML =
      `<tr><td colspan="3">No tee sheet available</td></tr>`;
    return;
  }

  // Make data available to the preview modal
  window.leagueId = data.league_id;      // needed for backend route
  window.teeDate = data.tee_date;        // needed for backend route
  window.longTeeDate = data.longDate;    // used for display only
  window.teeRows = data.teeRows;         // needed for preview + HTML builder
  
  // Load header
  loadPageHeader("Latest Tee Sheet Report", data.longDate);

  // Render table
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

  // Print
  document.getElementById("btnPrintLatest").onclick = () => window.print();

  // Send
  document.getElementById("btnSendLatest").onclick = () => {
    if (data.isAdmin) {
      // Admin → open recipients modal
      openNotifyModal();
    } else {
      // Non-admin → auto-send to self
      sendLatestToSelf();
    }
  };
}

async function sendLatestToSelf() {
  await fetch("/api/reports/latest-tee-sheet/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      includeSelf: true,
      includePlayers: false,
      includeAdmins: false,
      includeStaff: false
    })
  });

  alert("Latest tee sheet emailed to you.");
}

// Initialize for user pages
document.addEventListener("DOMContentLoaded", async () => {
  const isAdminPage = window.location.pathname.includes("admin");

  if (!isAdminPage) {
    await loadUserIdentity();
  }

  loadLatestTeeSheet();
});
