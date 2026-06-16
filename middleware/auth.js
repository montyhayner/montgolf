// middleware/auth.js

// ============================================================================
// REQUIRE LOGIN
// ============================================================================
function requireLogin(req, res, next) {
  console.log("🔐 requireLogin CHECK:", req.session.user);

  if (!req.session.user) {
    console.log("🔐 BLOCKED — NO SESSION USER");

    // API requests get JSON
    if (req.originalUrl.includes("/api")) {
      return res.status(401).json({ error: "Not logged in" });
    }

    // Page requests redirect
    return res.redirect("/login?error=1");
  }

  req.user = req.session.user;
  console.log("🔐 PASSED — USER:", req.user);
  next();
}

// ============================================================================
// REQUIRE ADMIN (admin OR super admin)
// ============================================================================
function requireAdmin(req, res, next) {
  const user = req.session.user;
  console.log(">>> REQUIRE ADMIN CHECK:", user);

  if (!user) {
    if (req.originalUrl.includes("/api")) {
      return res.status(401).json({ error: "Not logged in" });
    }
    return res.redirect("/admin-login");
  }

  const isAdmin = user.is_admin === 1;
  const isSuper = user.is_super_admin === 1;

  // ⭐ SUPER ADMIN ALWAYS PASSES
  if (isSuper) {
    req.user = user;
    return next();
  }

  // ⭐ REGULAR ADMIN PASSES
  if (isAdmin) {
    req.user = user;
    return next();
  }

  // ⭐ API REQUESTS GET JSON ERRORS
  if (req.originalUrl.includes("/api")) {
    return res.status(403).json({ error: "Admin only" });
  }

  // ⭐ NON-API REQUESTS GET REDIRECT
  return res.redirect("/auth/select-league");
}

// ============================================================================
// REQUIRE ADMIN OR SELF (used for profile edits, etc.)
// ============================================================================
function requireAdminOrSelf(req, res, next) {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const isAdmin = user.is_admin === 1;
  const isSuper = user.is_super_admin === 1;
  const targetUserId = parseInt(req.params.userId);

  // ⭐ SUPER ADMIN ALWAYS ALLOWED
  if (isSuper) {
    return next();
  }

  // ⭐ ADMIN OR SELF
  if (isAdmin || user.id === targetUserId) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
}

module.exports = {
  requireLogin,
  requireAdmin,
  requireAdminOrSelf
};
