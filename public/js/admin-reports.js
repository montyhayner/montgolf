document.addEventListener("DOMContentLoaded", () => {
  const reportType = document.getElementById("reportType");
  const leagueSection = document.getElementById("leagueSection");
  const leagueSelect = document.getElementById("leagueSelect");
  const dateSection = document.getElementById("dateSection");
  const dateInput = document.getElementById("dateInput");
  const runBtn = document.getElementById("runReportBtn");
  const resultsSection = document.getElementById("resultsSection");
  const resultsTable = document.getElementById("resultsTable");
  const exportBtn = document.getElementById("exportBtn");

  // Load leagues for dropdown
  fetch("/admin/leagues/list")
    .then(res => res.json())
    .then(leagues => {
      leagueSelect.innerHTML = leagues.map(l =>
        `<option value="${l.id}">${l.name}</option>`
      ).join("");
    });

  // Show/hide inputs based on report type
  reportType.addEventListener("change", () => {
    const type = reportType.value;

    leagueSection.style.display = type ? "block" : "none";
    dateSection.style.display = type === "specificDate" ? "block" : "none";
    runBtn.style.display = type ? "inline-block" : "none";
  });

  // Run report
  runBtn.addEventListener("click", () => {
    const type = reportType.value;
    const leagueId = leagueSelect.value;

    if (!leagueId) return alert("Please select a league");

    let url = "";

    if (type === "nextTwoWeeks") {
      url = `/admin/reports/available-next-two-weeks/${leagueId}`;
    }

    if (type === "specificDate") {
      if (!dateInput.value) return alert("Please select a date");
      url = `/admin/reports/available-date/${leagueId}/${dateInput.value}`;
    }

    fetch(url)
      .then(res => res.json())
      .then(data => renderResults(type, data));
  });

  // Render results table
  function renderResults(type, data) {
    resultsSection.style.display = "block";

    if (type === "nextTwoWeeks") {
      resultsTable.innerHTML = `
        <tr><th>Date</th><th>Players</th></tr>
        ${Object.entries(data.availability).map(([date, players]) => `
          <tr>
            <td>${date}</td>
            <td>${players.map(p => `${p.last_name}, ${p.first_name}`).join("<br>")}</td>
          </tr>
        `).join("")}
      `;
    }

    if (type === "specificDate") {
      resultsTable.innerHTML = `
        <tr><th>Last Name</th><th>First Name</th></tr>
        ${data.available.map(p => `
          <tr>
            <td>${p.last_name}</td>
            <td>${p.first_name}</td>
          </tr>
        `).join("")}
      `;
    }
  }

  // CSV Export
  exportBtn.addEventListener("click", () => {
    let csv = "";
    const rows = resultsTable.querySelectorAll("tr");

    rows.forEach(row => {
      const cols = [...row.querySelectorAll("th, td")].map(c => `"${c.innerText}"`);
      csv += cols.join(",") + "\n";
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "report.csv";
    a.click();

    URL.revokeObjectURL(url);
  });
});