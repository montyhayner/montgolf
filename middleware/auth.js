// middleware/auth.js

function requireLogin(req, res, next) {
    console.log("🔐 requireLogin CHECK:", req.session.user);

    if (!req.session.user) {
        console.log("🔐 BLOCKED — NO SESSION USER");
        return res.redirect("/login?error=1");
    }

    req.user = req.session.user;
    console.log("🔐 PASSED — USER:", req.user);
    next();
}

function requireAdmin(req, res, next) {
    console.log(">>> REQUIRE ADMIN CHECK:", req.session.user);

    const user = req.session.user;

    if (!user) {
        if (req.originalUrl.includes("/api")) {
            return res.status(401).json({ error: "Not logged in" });
        }
        return res.redirect("/admin-login");
    }

    // ⭐ SUPER ADMINS ALWAYS PASS
    if (user.is_super_admin) {
        req.user = user;
        return next();
    }

    // ⭐ REGULAR ADMINS WITH LEAGUE PASS
    if (user.is_admin === 1 && user.league_id) {
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

function requireAdminOrSelf(req, res, next) {
    const user = req.session.user;
    const targetUserId = parseInt(req.params.userId);

    if (!user) {
        return res.status(401).json({ error: "Not logged in" });
    }

    // ⭐ SUPER ADMIN ALWAYS ALLOWED
    if (user.is_super_admin) {
        return next();
    }

    // ⭐ ADMIN OR SELF
    if (user.is_admin === 1 || user.id === targetUserId) {
        return next();
    }

    return res.status(403).json({ error: "Forbidden" });
}

module.exports = {
    requireLogin,
    requireAdmin,
    requireAdminOrSelf
};
