// user-nav.js
document.addEventListener("DOMContentLoaded", () => {
  const nav = document.getElementById("user-nav");
  if (!nav) return;

  nav.innerHTML = `
    <nav style="margin-bottom: 20px;">
      <a href="/schedule.html" style="margin-right: 15px;">My Schedule</a>
      <a href="/play-months.html" style="margin-right: 15px;">My Months</a>
      <a href="/play-days.html" style="margin-right: 15px;">My Play Days</a>
      <a href="/logout">Logout</a>
    </nav>
  `;
});