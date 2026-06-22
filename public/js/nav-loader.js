// ------------------------------------------------------------
// Dynamic Navigation Loader (Admin + User)
// ------------------------------------------------------------

async function loadNav() {
  const navContainer = document.getElementById("nav-container");
  const navCss = document.getElementById("nav-css");

  if (!navContainer || !navCss) {
    console.warn("Nav loader: missing #nav-container or #nav-css");
    return;
  }

  try {
    // Get logged-in user
    const who = await fetch("/auth/whoami", { credentials: "include" });
    const user = await who.json();

    const isAdmin = user && user.user_mode === "admin";

    // Choose correct nav + CSS
    const navFile = isAdmin
      ? "/partials/admin-nav.html"
      : "/partials/user-nav.html";

    const cssFile = isAdmin
      ? "/css/admin-nav.css"
      : "/css/user-nav.css";

    // Load CSS
    navCss.href = cssFile;

    // Load HTML
    const navHtml = await fetch(navFile).then(r => r.text());
    navContainer.innerHTML = navHtml;

    // ⭐ FIRE EVENT HERE — SUCCESS PATH
    document.dispatchEvent(new Event("navLoaded"));

  } catch (err) {
    console.error("NAV LOAD ERROR:", err);

    // Fallback: user nav + user CSS
    navCss.href = "/css/user-nav.css";

    fetch("/partials/user-nav.html")
      .then(r => r.text())
      .then(html => {
        navContainer.innerHTML = html;

        // ⭐ FIRE EVENT HERE TOO — FALLBACK PATH
        document.dispatchEvent(new Event("navLoaded"));
      });
  }
}

// Auto-run on every page that includes this script
document.addEventListener("DOMContentLoaded", loadNav);
