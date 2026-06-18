// -------------------------------------------------------
// Load Admin Nav Bar
// -------------------------------------------------------
async function loadAdminNav() {
    const navContainer = document.getElementById("admin-nav-container");
    if (!navContainer) return;

    const res = await fetch("/partials/admin-nav.html", { credentials: "include" });
    const html = await res.text();
    navContainer.innerHTML = html;

    // Highlight current page
    const path = window.location.pathname;

    document.querySelectorAll(".admin-nav .nav-links a").forEach(link => {
        const href = link.getAttribute("href");
        if (href === path || (href !== "/" && path.startsWith(href))) {
            link.classList.add("active");
        }
    });

    return true;
}
