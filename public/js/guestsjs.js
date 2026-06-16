// ------------------------------------------------------------
// Guests Page Logic
// ------------------------------------------------------------

let allowedDOWs = [];

async function loadAllowedDOWs() {
  const res = await fetch("/api/league-play-days");
  const data = await res.json();
  allowedDOWs = data.days;   // e.g., [1,3,5]
}

function getDOW(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();  // local date, no UTC shift
}

function isValidEmail(email) {
  // same regex you use on Edit Profile and League modals
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// -------------------------------------------------------------------------------------------
// helper function to provide the day of week NAME (i.e. Friday)
// when given the DOW Number ( 0 - 6 )
// -------------------------------------------------------------------------------------------
function dowName(dow) {
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dow];
}

// Get names of valid DOWs for the current league
function allowedDOWNames() {
  return allowedDOWs.map(d => dowName(d)).join(", ");
}

function isValidRange(dt) {
  const [year, month, day] = dt.split("-").map(Number);
  const d = new Date(year, month - 1, day);

  const today = new Date();
  today.setHours(0,0,0,0);

  const oneYear = new Date();
  oneYear.setFullYear(oneYear.getFullYear() + 1);
  oneYear.setHours(0,0,0,0);

  return d >= today && d <= oneYear;
}

// ------------------------------------------------------------
// Load all guests into the table
// ------------------------------------------------------------
let currentGuestId = null;
async function loadGuests() {

  // Load user + league info and build header
   const [userInfo, leagueInfo] = await Promise.all([
     fetch("/user/info").then(r => r.json()),
     fetch("/user/selected-league").then(r => r.json())
  ]);
  const user = userInfo.user;
  const league = leagueInfo.league;
  const userName = `${user.first_name} ${user.last_name}`;
  const leagueName = league.league_name;
  document.getElementById("pageHeader").textContent =
  `My Guests – ${userName} – ${leagueName}`;

  try {
    const res = await fetch("/api/guests");
    const guests = await res.json();

    const tbody = document.querySelector("#guestTable tbody");
    tbody.innerHTML = "";

    guests.forEach(g => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${g.guest_last_name}</td>
        <td>${g.guest_first_name}</td>
        <td>${g.guest_email || ""}</td>
        <td>${g.date1 || ""}</td>
        <td>${g.date2 || ""}</td>
        <td>${g.date3 || ""}</td>
        <td>${g.date4 || ""}</td>
        <td>${g.date5 || ""}</td>
        <td>
          <button class="table-btn" onclick="editGuest(${g.id})">Edit</button>
          <button class="table-btn delete" onclick="deleteGuest(${g.id})">Delete</button>
        </td>
      `;

      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Error loading guests:", err);
    alert("Error loading guests");
  }
}

// ------------------------------------------------------------
// Open modal for NEW guest
// ------------------------------------------------------------
function openGuestModal() {
  currentGuestId = null;

  document.getElementById("guestModalTitle").textContent = "Add Guest";

  [
    "guest_first_name",
    "guest_last_name",
    "guest_email",
    "date1",
    "date2",
    "date3",
    "date4",
    "date5"
  ].forEach(id => (document.getElementById(id).value = ""));

  document.getElementById("guestModal").style.display = "block";
}

// ------------------------------------------------------------
// Close modal
// ------------------------------------------------------------
function closeGuestModal() {
  document.getElementById("guestModal").style.display = "none";
}

// ------------------------------------------------------------
// Edit an existing guest
// ------------------------------------------------------------
async function editGuest(id) {
  try {
    const res = await fetch(`/api/guests/${id}`);
    const g = await res.json();

    currentGuestId = id;

    document.getElementById("guestModalTitle").textContent = "Edit Guest";

    document.getElementById("guest_first_name").value = g.guest_first_name;
    document.getElementById("guest_last_name").value = g.guest_last_name;
    document.getElementById("guest_email").value = g.guest_email || "";

    document.getElementById("date1").value = g.date1 || "";
    document.getElementById("date2").value = g.date2 || "";
    document.getElementById("date3").value = g.date3 || "";
    document.getElementById("date4").value = g.date4 || "";
    document.getElementById("date5").value = g.date5 || "";

    document.getElementById("guestModal").style.display = "block";

  } catch (err) {
    console.error("Error editing guest:", err);
    alert("Error loading guest");
  }
}

// ------------------------------------------------------------
// Save guest (create or update)
// ------------------------------------------------------------
async function saveGuest() {

console.log("currentGuestId =", currentGuestId);
// -------------------------------
// BASIC FIELD VALIDATION
// -------------------------------
const first = document.getElementById("guest_first_name").value.trim();
const last  = document.getElementById("guest_last_name").value.trim();
const email = document.getElementById("guest_email").value.trim();

if (!first) {
  alert("First Name is required. The field will be cleared. Please reenter a valid first name.");
  document.getElementById("guest_first_name").value = "";
  return;
}

if (!last) {
  alert("Last Name is required. The field will be cleared. Please reenter a valid last name.");
  document.getElementById("guest_last_name").value = "";
  return;
}

if (!email || !isValidEmail(email)) {
  alert("Invalid Email Address. The field will be cleared. Please reenter a valid email.");
  document.getElementById("guest_email").value = "";
  return;
}

// -------------------------------
// DOW VALIDATION
// -------------------------------
const dateFieldIds = ["date1", "date2", "date3", "date4", "date5"];

for (const id of dateFieldIds) {
  const inputEl = document.getElementById(id);
  const dt = inputEl.value;
  
  if (!dt) continue;

  if (!isValidRange(dt)) {
    alert(
      `Invalid date range. Date must be between today and a year from today.\n\n` +
      `The invalid date (${dt}) will be cleared automatically. Please reenter a valid date.`
    );
    inputEl.value = "";  // <-- date field clears of invalid date value
    return;
  }

  const dow = getDOW(dt);

  if (!allowedDOWs.includes(dow)) {
    const name = dowName(dow);
    const leagueDows = allowedDOWNames();

    alert(
      `The date ${dt} is a ${name} ... which is NOT a valid day-of-the-week for the league.\n\n` +
      `Valid days of the week are: ${leagueDows}.\n\n` +
      `The invalid date will be cleared automatically. Please reenter a valid date.`
    );

    inputEl.value = "";   // <-- date field clears of invalid date value
    return;
  }
}

  // -------------------------------
  // BUILD PAYLOAD
  // -------------------------------
  const payload = {
    guest_first_name: document.getElementById("guest_first_name").value.trim(),
    guest_last_name: document.getElementById("guest_last_name").value.trim(),
    guest_email: document.getElementById("guest_email").value.trim(),
    date1: document.getElementById("date1").value,
    date2: document.getElementById("date2").value,
    date3: document.getElementById("date3").value,
    date4: document.getElementById("date4").value,
    date5: document.getElementById("date5").value
  };

  const method = currentGuestId ? "PUT" : "POST";
  const url = currentGuestId ? `/api/guests/${currentGuestId}` : "/api/guests";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Error saving guest");
      return;
    }

    closeGuestModal();
    loadGuests();

  } catch (err) {
    console.error("Error saving guest:", err);
    alert("Error saving guest");
  }
}

// ------------------------------------------------------------
// Delete guest
// ------------------------------------------------------------
async function deleteGuest(id) {
  if (!confirm("Delete this guest?")) return;

  try {
    const res = await fetch(`/api/guests/${id}`, { method: "DELETE" });

    if (!res.ok) {
      alert("Error deleting guest");
      return;
    }

    loadGuests();

  } catch (err) {
    console.error("Error deleting guest:", err);
    alert("Error deleting guest");
  }
}

// ------------------------------------------------------------
// Initialize page
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await loadAllowedDOWs();
  loadGuests();
  });