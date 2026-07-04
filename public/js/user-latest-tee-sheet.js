async function loadUserNav() {
  const html = await fetch("/partials/user-topnav.html").then(r => r.text());
  document.getElementById("user-nav-container").innerHTML = html;

  const path = window.location.pathname;
  document.querySelectorAll("#topNav .nav-link").forEach(link => {
    if (link.getAttribute("href") === path) {
      link.classList.add("active");
    }
  });
}

async function loadUserIdentity() {
  const session = await fetch("/auth/session").then(r => r.json());
  const name = `${session.first_name} ${session.last_name}`;
  const league = session.league_name;

  document.getElementById("user-identity-container").innerHTML =
    `<div class="identity-bar">${name} — ${league}</div>`;
}

async function loadLatestTeeSheet() {
  const res = await fetch("/api/reports/latest-tee-sheet");
  const data = await res.json();

  if (!data.ok) {
    document.getElementById("teeSheetBody").innerHTML =
      `<tr><td colspan="3">No tee sheet available</td></tr>`;
    return;
  }

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

  document.getElementById("btnPrintLatest").onclick = () => window.print();

  document.getElementById("btnSendLatest").onclick = async () => {
    await sendLatestToSelf();
  };
}

async function sendLatestToSelf() {
  await fetch("/api/reports/latest-tee-sheet/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ includeSelf: true })
  });

  alert("Latest tee sheet emailed to you.");
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadUserNav();
  await loadUserIdentity();
  await loadLatestTeeSheet();
});
