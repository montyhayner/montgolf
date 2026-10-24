// ============================================================================
// REQUIRE LOGIN (user or admin must be logged in)
// ============================================================================
function requireLogin(req, res, next) {
  const user = req.session.user;

  if (!user) {
    if (req.originalUrl.includes("/api")) {
      return res.status(401).json({ error: "Not logged in" });
    }
    return res.redirect("/login.html?error=1");
  }

  req.user = user;
  next();
}

// ============================================================================
// REQUIRE ADMIN (league admin OR super admin)
// ============================================================================
function requireAdmin(req, res, next) {
  const user = req.session.user;

  if (!user) {
    if (req.originalUrl.includes("/api")) {
      return res.status(401).json({ error: "Not logged in" });
    }
    return res.redirect("/admin-login.html");
  }

  // Must be logged in through admin-login
  if (user.user_mode !== "admin") {
    return res.status(403).send("Admins only");
  }

  // SUPER ADMIN ALWAYS PASSES
  if (user.is_super_admin) {
    req.user = user;
    return next();
  }

  // LEAGUE ADMIN: must administer at least one league
  const isLeagueAdmin = user.leagues.some(l => l.is_admin === 1);

  if (isLeagueAdmin) {
    req.user = user;
    return next();
  }

  // API request → JSON error
  if (req.originalUrl.includes("/api")) {
    return res.status(403).json({ error: "Admin only" });
  }

  // Non-API → redirect to admin league selector
  return res.redirect("/auth/admin-select-league");
}

function requireLeagueAdmin(req, res, next) {

    const isApi = req.originalUrl.includes("/api");

    // Super Admin WITH league
    if (req.session.user?.is_super_admin && req.session.user?.league_id) {
        console.log("  ✔ Super Admin WITH league allowed");
        return next();
    }

    // League Admin WITH league
    if (req.session.user?.is_admin && req.session.user?.league_id) {
        console.log("  ✔ League Admin allowed");
        return next();
    }

    // No league selected
    console.log("  ✖ No league selected");

    if (isApi) {
        // API routes must return JSON, not redirect
        return res.status(403).json({ error: "No league selected" });
    }

    // Page routes can redirect normally
    return res.redirect("/auth/admin-select-league");
}

// ============================================================================
// REQUIRE ADMIN OR SELF (used for profile edits, etc.)
// ============================================================================
function requireAdminOrSelf(req, res, next) {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const targetUserId = parseInt(req.params.userId);

  // SUPER ADMIN ALWAYS ALLOWED
  if (user.is_super_admin) {
    return next();
  }

  // LEAGUE ADMIN (must administer at least one league)
  const isLeagueAdmin = user.leagues.some(l => l.is_admin === 1);

  if (isLeagueAdmin || user.id === targetUserId) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
}

function requireSuperAdmin(req, res, next) {

    if (req.session.user && req.session.user.is_super_admin) {
        console.log("  ✔ Super Admin allowed");
        return next();
    }

    console.log("  ✖ Super Admin denied");
    return res.status(403).send("Super Admin only");
}

function requireAdminLoginOnly(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/admin-login");
    }

    if (req.session.user.is_super_admin || req.session.user.is_admin) {
        return next();
    }

    return res.status(403).send("Admins only");
}

module.exports = {
  requireLogin,
  requireAdmin,
  requireLeagueAdmin,
  requireAdminOrSelf,
  requireSuperAdmin,
  requireAdminLoginOnly
};
