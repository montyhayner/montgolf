async function loadUserIdentity() {
  const container = document.getElementById("user-identity-container");
  if (!container) return;

  // Load the HTML partial
  const html = await fetch("/partials/user-identity.html").then(r => r.text());
  container.innerHTML = html;

  // Fetch user + league info
  const [userInfo, leagueInfo] = await Promise.all([
    fetch("/user/info").then(r => r.json()),
    fetch("/user/selected-league").then(r => r.json())
  ]);

  const user = userInfo.user;
  const league = leagueInfo.league;

  // Populate identity bar
  document.getElementById("identity-name").innerText =
    `${user.first_name} ${user.last_name}`;

  document.getElementById("identity-league").innerText =
    `${league.league_name}`;
}
