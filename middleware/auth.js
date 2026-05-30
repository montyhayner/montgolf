// middleware/auth.js

function requireLogin(req, res, next) {
    console.log("🔐 requireLogin CHECK:", req.session.user);

    if (!req.session.user) {
        console.log("🔐 BLOCKED — NO SESSION USER");
        return res.redirect("/login?error=1");
    }

    // ⭐ FIX: Attach req.user
    req.user = req.session.user;

    console.log("🔐 PASSED — USER:", req.user);
    next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }
    req.user = req.session.user;

  next();
}

function requireAdminOrSelf(req, res, next) {
  const loggedIn = req.session.user;
  const targetUserId = parseInt(req.params.userId);

  if (loggedIn.is_admin === 1 || loggedIn.id === targetUserId) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
}

module.exports = {
  requireLogin,
  requireAdmin,
  requireAdminOrSelf
};