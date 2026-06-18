// -------------------------------------------------------
// Load Session Info
// -------------------------------------------------------
async function loadSession() {
    const res = await fetch("/admin/session-info", { credentials: "include" });
    const session = await res.json();

    // Show Leagues link only for Super Admin
    const leaguesLink = document.getElementById("nav-leagues-link");
    if (leaguesLink) {
        leaguesLink.style.display = session.is_super_admin ? "inline-block" : "none";
    }

    return session;
}

// -------------------------------------------------------
// Populate Admin Identity Bar
// -------------------------------------------------------
async function loadAdminIdentity(session) {
    const container = document.getElementById("admin-identity-container");
    if (!container) return;

    const html = await fetch("/partials/admin-identity.html").then(r => r.text());
    container.innerHTML = html;

    const bar = container.querySelector(".admin-identity");
    const icon = container.querySelector("#identity-icon");
    const role = container.querySelector("#identity-role");
    const name = container.querySelector("#identity-name");
    const leagueBadge = container.querySelector("#identity-league");

    // Always show admin's name
    name.innerText = `${session.first_name} ${session.last_name}`;

    if (session.is_super_admin) {
        // Super Admin styling
        bar.classList.add("super-admin");
        icon.innerText = "⭐";
        role.innerText = "Super Admin";

        if (session.league_name) {
            leagueBadge.innerText = `Current League: ${session.league_name}`;
            leagueBadge.style.display = "inline-block";
        } else {
            leagueBadge.style.display = "none";
        }

    } else {
        // League Admin styling
        bar.classList.add("league-admin");
        icon.innerText = "🏌️";
        role.innerText = "League Admin";

        if (session.league_name) {
            leagueBadge.innerText = session.league_name;
            leagueBadge.style.display = "inline-block";
        } else {
            leagueBadge.style.display = "none";
        }
    }
}
