console.log("admin-allocated-tee-times.js LOADED");
// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON response: " + text);
  }
}

async function loadAdminNav() {
  const navContainer = document.getElementById("admin-nav-container");
  const res = await fetch("/partials/admin-nav.html", { credentials: "include" });
  const html = await res.text();
  navContainer.innerHTML = html;

  const path = window.location.pathname;
  document.querySelectorAll(".admin-nav .nav-links a").forEach(link => {
    const href = link.getAttribute("href");
    if (href === path || (href !== "/" && path.startsWith(href))) {
      link.classList.add("active");
    }
  });
}

async function loadAdminIdentity(session) {
  const container = document.getElementById("admin-identity-container");
  if (!container) return;

  const html = await fetch("/partials/admin-identity.html").then(r => r.text());
  container.innerHTML = html;

  const bar = container.querySelector(".admin-identity");
  const icon = container.querySelector("#identity-icon");
  const name = container.querySelector("#identity-name");
  const role = container.querySelector("#identity-role");
  const leagueSpan = container.querySelector("#identity-league");

  name.innerText = `${session.first_name} ${session.last_name}`;

  if (session.is_super_admin) {
    bar.classList.add("super-admin");
    icon.innerText = "⭐";
    role.innerText = "Super Admin";
  } else {
    bar.classList.add("league-admin");
    icon.innerText = "🏌️";
    role.innerText = "League Admin";
  }

  const leagueRes = await fetch("/user/selected-league");
  const leagueData = await leagueRes.json();
  if (leagueData.league) {
    leagueSpan.innerText = `— ${leagueData.league.league_name}`;
  }
}

async function loadSession() {
  const res = await fetch("/admin/session-info", { credentials: "include" });
  const session = await res.json();

  const leaguesLink = document.getElementById("nav-leagues-link");
  if (leaguesLink) {
    leaguesLink.style.display = session.is_super_admin ? "inline-block" : "none";
  }

  return session;
}

async function initPage() {
  try {
    await loadAdminNav();
    console.log("initPage - loadAdminNav function ran");
    const session = await loadSession();
    await loadAdminIdentity(session);
    console.log("session=", session);
  } catch (err) {
    console.error("Page initialization error:", err);
  }
}

// -------------------------------------------------------
// Main page logic
// -------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  // DOM ELEMENTS
  const playDateInput = document.getElementById("playDateInput");
  const first_nine = document.getElementById("firstNineSelect").value;

  const loadBtn = document.getElementById("loadBtn");

  const existingBlock = document.getElementById("existingBlock");
  const teeTimesTableBody = document.getElementById("teeTimesTableBody");

  const generateBlock = document.getElementById("generateBlock");
  const startTimeInput = document.getElementById("startTimeInput");
  const countInput = document.getElementById("countInput");
  const generateBtn = document.getElementById("generateBtn");

  const editBlockBtn = document.getElementById("editBlockBtn");
  const deleteBlockBtn = document.getElementById("deleteBlockBtn");

  const modal = document.getElementById("teeTimesModal");
  const modalTeeTimes = document.getElementById("modalTeeTimes");
  const saveModalBtn = document.getElementById("saveModalBtn");
  const closeModalBtn = document.getElementById("closeModalBtn");

  let currentPlayDate = null;
  let currentTeeTimes = [];
  let currentFirstNine = null;
  let lastRequestId = 0;

  loadNines();

async function loadTeeTimes() {
  if (!currentPlayDate) {
    console.warn("Skipping load — currentPlayDate is empty");
    return;
  }
  if (!currentFirstNine) {
    console.warn("Skipping load — currentFirstNine is empty");
    return;
  }

  const requestId = ++lastRequestId;
  console.log("LOAD START for", currentPlayDate, "requestId =", requestId, "First Nine = ", currentFirstNine);

  const res = await fetch(`/admin/allocated-tee-times/${currentPlayDate}`);
  const data = await res.json();

  // Ignore stale responses
  if (requestId !== lastRequestId) {
    console.warn("Ignoring stale GET response for", currentPlayDate);
    return;
  }

  console.log("LOAD COMPLETE for", currentPlayDate, "rows =", data.teeTimes.length);

  if (data.teeTimes.length > 0) {
    existingBlock.style.display = "block";
    generateBlock.style.display = "none";

    teeTimesTableBody.innerHTML = "";
    currentTeeTimes = data.teeTimes.map(t => t.tee_time);

    data.teeTimes.forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.tee_time_number}</td>
        <td>${row.tee_time}</td>
        <td><button class="danger" onclick="deleteSingle(${row.id})"><span>🗑️</span> Delete</button></td>
      `;
      teeTimesTableBody.appendChild(tr);
    });

    console.log("Rendered table rows:", teeTimesTableBody.querySelectorAll("tr").length);

  } else {
    existingBlock.style.display = "none";
    generateBlock.style.display = "block";
  }
}

  // -----------------------------
  // Helpers
  // -----------------------------
  function generateTeeTimes(start, count, interval) {
    const times = [];
    let [h, m] = start.split(":").map(Number);
    console.log("function generateTeeTimes(start, count, interval)  start, count, interval = ", start, count, interval);

    for (let i = 0; i < count; i++) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      times.push(`${hh}:${mm}`);

      m += interval;
      while (m >= 60) {
        m -= 60;
        h += 1;
      }
    }
    console.log("times = ", times);
    return times;
  }

  async function loadNines() {
    const res = await fetch("/admin/nines");
    const data = await res.json();

    const select = document.getElementById("firstNineSelect");
    select.innerHTML = "";

    data.nines.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n.nine;
      opt.textContent = n.nine;
      select.appendChild(opt);
    });
  }

  function renderModalRows() {
    modalTeeTimes.innerHTML = "";
    console.log("we are in renderModalRows funciton");
    currentTeeTimes.forEach((time, idx) => {
      const div = document.createElement("div");
      div.className = "tee-time-row";

      div.innerHTML = `
        <span>#${idx + 1}</span>
        <input type="time" value="${time}" data-index="${idx}">
      `;
      console.log("renderModal function div = ", div);
      modalTeeTimes.appendChild(div);
    });
  }

  function openModal() {
    modal.style.display = "flex";
    console.log("we are in the openModal function");
    renderModalRows();
  }

  // -----------------------------
  // Event handlers
  // -----------------------------
loadBtn.addEventListener("click", async () => {
  const date = playDateInput.value;
  if (!date) return alert("Please select a date.");
  currentPlayDate = date;
  const firstNine = firstNineSelect.value;
  if (!firstNine) return alert("Please Enter the First Nine for the play date");
  currentFirstNine = firstNine;
  await loadTeeTimes();
});

window.deleteSingle = async function (id) {
  if (!confirm("Delete this tee time?")) return;

  await fetch(`/admin/allocated-tee-times/${id}`, { method: "DELETE" });
  await loadTeeTimes();
};

  generateBtn.addEventListener("click", async () => {
    const start = startTimeInput.value;
    const count = Number(countInput.value);
    console.log("generateBtn.addEventListener function invoked");

    if (!start || !count) return alert("Enter start time and count.");

    const res = await fetch("/admin/leagues/tee-interval");
    const data = await res.json();
    const interval = data.tee_interval_minutes;

    currentTeeTimes = generateTeeTimes(start, count, interval);
    console.log("Generated tee times:", currentTeeTimes);
    openModal();
  });

  editBlockBtn.addEventListener("click", () => {
    openModal();
  });

  closeModalBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });

deleteBlockBtn.addEventListener("click", async () => {
  if (!confirm("Delete ALL tee times for this date?")) return;

  await fetch(`/admin/allocated-tee-times/date/${currentPlayDate}`, {
    method: "DELETE"
  });

  await loadTeeTimes();
});

saveModalBtn.addEventListener("click", async () => {
  console.log("=== SAVE CLICKED ===");

  const inputs = document.querySelectorAll("#modalTeeTimes input[type='time']");
  const newTimes = Array.from(inputs).map(i => i.value);

  await fetch("/admin/allocated-tee-times", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      play_date: currentPlayDate,
      first_nine: currentFirstNine,
      tee_times: newTimes
    })
  });

  modal.style.display = "none";
  await loadTeeTimes();
});


  // -----------------------------
  // Init
  // -----------------------------
  await initPage();
});
