// ------------------------------
// Toast
// ------------------------------
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "show " + type;

    setTimeout(() => {
        toast.className = toast.className.replace("show", "");
    }, 3000);
}

// ------------------------------
// Modal Controls
// ------------------------------
function openModal(id) {
    document.getElementById(id).style.display = "block";
}

function closeModal(id) {
    document.getElementById(id).style.display = "none";
}

// ------------------------------
// Load Leagues on Page Load
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
    loadLeagues();
});

// ------------------------------
// Load Leagues
// ------------------------------
async function loadLeagues() {
    try {
        const res = await fetch("/admin/leagues/api");
        const leagues = await res.json();

        const tbody = document.getElementById("leaguesBody");
        tbody.innerHTML = "";

        leagues.forEach(l => {
            const tr = document.createElement("tr");

            const coordName = (l.coordinator_first_name || l.coordinator_last_name)
                ? `${l.coordinator_first_name || ""} ${l.coordinator_last_name || ""}`.trim()
                : "";

            tr.innerHTML = `
                <td>${l.name}</td>
                <td>${coordName}</td>
                <td>${l.coordinator_email || ""}</td>
                <td>
                    <button class="btn-small btn-danger" onclick="openDeleteLeagueModal(${l.id}, '${escapeHtml(l.name)}')">Delete</button>
                </td>
            `;

            tbody.appendChild(tr);
        });

    } catch (err) {
        showToast("Error loading leagues", "error");
        console.error(err);
    }
}

// ------------------------------
// Escape HTML helper
// ------------------------------
function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ------------------------------
// Add League Modal
// ------------------------------
function openAddLeagueModal() {
    document.getElementById("add_league_name").value = "";
    document.getElementById("add_coord_first_name").value = "";
    document.getElementById("add_coord_last_name").value = "";
    document.getElementById("add_coord_email").value = "";
    openModal("addLeagueModal");
}

// ------------------------------
// Create League
// ------------------------------
async function createLeague() {
    const name = document.getElementById("add_league_name").value.trim();
    const coordFirst = document.getElementById("add_coord_first_name").value.trim();
    const coordLast = document.getElementById("add_coord_last_name").value.trim();
    const coordEmail = document.getElementById("add_coord_email").value.trim();

    if (!name) {
        showToast("League name is required", "error");
        return;
    }

    const payload = {
        name,
        coordinator_first_name: coordFirst || null,
        coordinator_last_name: coordLast || null,
        coordinator_email: coordEmail || null
    };

    try {
        const res = await fetch("/admin/leagues/api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const result = await res.json();

        if (result.error) {
            showToast(result.error, "error");
            return;
        }

        closeModal("addLeagueModal");

        // If coordinator info provided, prompt to create admin user
        if (coordFirst && coordLast && coordEmail) {
            const ok = confirm(
                "League created.\n\nDo you want to create the coordinator as an admin user for this league now?"
            );
            if (ok) {
                // Redirect to golfers page with prefill params
                const params = new URLSearchParams({
                    addCoordinator: "1",
                    first: coordFirst,
                    last: coordLast,
                    email: coordEmail
                });
                window.location.href = "/admin/golfers?" + params.toString();
                return;
            }
        }

        showToast("League created", "success");
        // After creating league, you typically want to reload list
        loadLeagues();

    } catch (err) {
        showToast("Error creating league", "error");
        console.error(err);
    }
}

// ------------------------------
// Delete League Modal
// ------------------------------
function openDeleteLeagueModal(id, name) {
    document.getElementById("delete_league_id").value = id;
    document.getElementById("deleteLeagueMessage").textContent =
        `Are you sure you want to delete the league "${name}"? ` +
        `This is only allowed if no schedule data exists for this league.`;
    openModal("deleteLeagueModal");
}

// ------------------------------
// Delete League
// ------------------------------
async function deleteLeague() {
    const id = document.getElementById("delete_league_id").value;

    try {
        const res = await fetch(`/admin/leagues/api/${id}`, {
            method: "DELETE"
        });

        const result = await res.json();

        if (result.error) {
            showToast(result.error, "error");
            return;
        }

        closeModal("deleteLeagueModal");
        showToast("League deleted", "success");
        loadLeagues();

    } catch (err) {
        showToast("Error deleting league", "error");
        console.error(err);
    }
}