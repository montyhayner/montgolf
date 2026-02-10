// middleware/auth.js

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Login required" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }
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