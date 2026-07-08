console.log("NAV LOADER: script loaded");

async function loadNav() {
  console.log("NAV LOADER: loadNav() called");

  const navContainer = document.getElementById("nav-container");
  const navCss = document.getElementById("nav-css");

  if (!navContainer || !navCss) {
    console.warn("Nav loader: missing #nav-container or #nav-css");
    return;
  }

  try {
    const who = await fetch("/auth/whoami", { credentials: "include" });
    const user = await who.json();
    console.log("NAV LOADER: user:", user, " user_mode:", user.user_mode);

    const isAdmin = user && user.user_mode === "admin";

    const navFile = isAdmin
      ? "/partials/admin-nav.html"
      : "/partials/user-nav.html";

    const cssFile = isAdmin
      ? "/css/admin-nav.css"
      : "/css/user-nav.css";

    console.log("NAV LOADER: navfile:", navFile, " cssFile:", cssFile);

    navCss.href = cssFile;

    await new Promise(resolve => {
      navCss.onload = resolve;
      navCss.onerror = resolve;
    });

    console.log("NAV LOADER: fetching", navFile);
    const navHtml = await fetch(navFile).then(r => r.text());
    navContainer.innerHTML = navHtml;

    console.log("NAV LOADER: navHtml loaded");

    document.dispatchEvent(new Event("navLoaded"));
    return true;

  } catch (err) {
    console.error("NAV LOAD ERROR:", err);

    navCss.href = "/css/user-nav.css";

    await new Promise(resolve => {
      navCss.onload = resolve;
      navCss.onerror = resolve;
    });

    const html = await fetch("/partials/user-nav.html").then(r => r.text());
    navContainer.innerHTML = html;

    document.dispatchEvent(new Event("navLoaded"));
    return true;
  }
}

// ⭐ THIS MUST BE OUTSIDE THE CATCH ⭐
document.addEventListener("DOMContentLoaded", () => {
  console.log("NAV LOADER: DOMContentLoaded fired — calling loadNav()");
  loadNav();
});
