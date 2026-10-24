const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../db");
const path = require("path");
const { requireLogin, requireAdmin, requireAdminOrSelf } = require("../middleware/auth");

// ============================================================================
// GET /auth/me  → Return full session user object
// ============================================================================
router.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  return res.json(req.session.user);
});

// ============================================================================
// GET /auth/debug-session  →  Dump full session for debugging
// ============================================================================
router.get("/debug-session", (req, res) => {
  if (!req.session) {
    return res.status(500).json({ error: "Session not initialized" });
  }

  return res.json({
    session_user: req.session.user || null,
    raw_session: req.session
  });
});

// ============================================================================
// POST /auth/login  (USER SIDE)
// ============================================================================
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const row = db.prepare(`
      SELECT *
        FROM logins
       WHERE email = ?
  `).get(email);

  if (!row) {
    return res.redirect(`/login.html?error=Invalid%20email&email=${encodeURIComponent(email)}`);
  }

  if (!bcrypt.compareSync(password, row.password_hash)) {
    return res.redirect(`/login.html?error=Invalid%20password&email=${encodeURIComponent(email)}`);
  }

  // Load all leagues the user belongs to
  const leagues = db.prepare(`
      SELECT lu.league_id, lu.is_member, lu.is_admin, lu.subgroup, lu.subgroup_number,
             l.league_name
        FROM league_users lu
        JOIN leagues l ON l.id = lu.league_id
       WHERE lu.user_id = ?
  `).all(row.id);

  req.session.user = {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    user_mode: "user",
    leagues,
    league_id: null,
    league_name: null
  };

  return req.session.save(() => {
    // USER SIDE AUTO-SELECT LOGIC
    if (leagues.length === 1) {
      req.session.user.league_id = leagues[0].league_id;
      req.session.user.league_name = leagues[0].league_name;

      return req.session.save(() => {
        res.redirect("/schedule");
      });
    }

    // Multiple leagues → show user selector
    res.redirect("/auth/user-select-league");
  });
});

// ============================================================================
// GET /auth/session  →  Return session user (safe for user pages)
// ============================================================================
router.get("/session", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.json(null);
  }

  res.json(req.session.user);
});

// ============================================================================
// PUT /auth/change-password
// ============================================================================
router.put("/change-password", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const { current_password, new_password } = req.body;

  try {
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const user = db.prepare(
      "SELECT password_hash FROM logins WHERE id = ?"
    ).get(userId);

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    const newHash = await bcrypt.hash(new_password, 10);

    db.prepare(`
       UPDATE logins
          SET password_hash = ? 
        WHERE id = ?
    `).run(newHash, userId);

    return res.json({ success: true });

  } catch (err) {
    console.error("🔥 CHANGE PASSWORD ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ============================================================================
// GET /auth/whoami
// ============================================================================
router.get("/whoami", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.json({ user: null });
  }

  res.json(req.session.user);
});

// ============================================================================
// GET /auth/logout
// ============================================================================
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ============================================================================
// GET /auth/user-select-league
// Users (including admins using the user side)
// ============================================================================
router.get("/user-select-league", requireLogin, (req, res) => {
  const user = req.session.user;

  // Must be logged in through USER side
  if (user.user_mode !== "user") {
    return res.status(403).send("Users only");
  }

  const leagues = user.leagues || [];

  // USER AUTO-SELECT LOGIC
  if (leagues.length === 1) {
    req.session.user.league_id = leagues[0].league_id;
    req.session.user.league_name = leagues[0].league_name;

    return req.session.save(() => {
      res.redirect("/schedule");
    });
  }

  // Multiple leagues → show user selector
  return res.sendFile(path.join(__dirname, "..", "public", "user-select-league.html"));
});

// ============================================================================
// GET /auth/admin-select-league
// Admins and Super Admins
// ============================================================================
router.get("/admin-select-league", requireAdmin, (req, res) => {
  const user = req.session.user;

  // SUPER ADMIN → ALWAYS show selector
  if (user.is_super_admin) {
    return res.sendFile(path.join(__dirname, "..", "public", "admin-select-league.html"));
  }

  // League admin → check how many leagues they administer
  const adminLeagues = user.leagues.filter(l => l.is_admin === 1);

  // League admin with exactly one league → auto-select
  if (adminLeagues.length === 1) {
    req.session.user.league_id = adminLeagues[0].league_id;
    req.session.user.league_name = adminLeagues[0].league_name;

    return req.session.save(() => {
      res.redirect("/admin-dashboard");
    });
  }

  // League admin with multiple leagues → show selector
  return res.sendFile(path.join(__dirname, "..", "public", "admin-select-league.html"));
});

// ============================================================================
// POST /auth/user-select-league
// Regular users (including admins using the user side)
// ============================================================================
router.post("/user-select-league", (req, res) => {
  const { league_id } = req.body;

  if (!league_id) {
    return res.status(400).json({ error: "No league selected" });
  }

  const user = req.session.user;

  // Must be logged in through the USER side
  if (!user || user.user_mode !== "user") {
    return res.status(403).json({ error: "Users only" });
  }

  // Validate that the user actually belongs to this league
  const belongs = user.leagues.some(l => l.league_id == league_id);

  if (!belongs) {
    return res.status(403).json({ error: "Not a member of this league" });
  }

  // Lookup league name for convenience
  const row = db.prepare(`
      SELECT league_name
        FROM leagues
       WHERE id = ?
  `).get(league_id);

  const league_name = row ? row.league_name : null;

  // Update session
  req.session.user = {
    ...req.session.user,
    league_id,
    league_name
  };

  return req.session.save(() => {
    res.json({ success: true });
  });
});

// ============================================================================
// POST /auth/admin-select-league
// Admins and Super Admins only
// ============================================================================
router.post("/admin-select-league", (req, res) => {
  const { league_id } = req.body;

  if (!league_id) {
    return res.status(400).json({ error: "No league selected" });
  }

  // Must already be logged in as admin or super admin
  const user = req.session.user;
  if (!user || user.user_mode !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }

  // Validate that the admin actually belongs to this league
  // Super admins bypass this check
  if (!user.is_super_admin) {
    const belongs = user.leagues.some(l => l.league_id == league_id && l.is_admin === 1);
    if (!belongs) {
      return res.status(403).json({ error: "Not an admin of this league" });
    }
  }

  // Lookup league name for convenience
  const row = db.prepare(`
      SELECT league_name
        FROM leagues
       WHERE id = ?
  `).get(league_id);

  const league_name = row ? row.league_name : null;

  // Update session
  req.session.user = {
    ...req.session.user,
    league_id,
    league_name
  };

  return req.session.save(() => {
    res.json({ success: true });
  });
});

// ============================================================================
// POST /auth/admin-login  (ADMIN SIDE)
// ============================================================================
router.post("/admin-login", (req, res) => {
  const { email, password } = req.body;

  const row = db.prepare(`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.password_hash,
        u.is_admin,
        CASE WHEN sa.email IS NOT NULL THEN 1 ELSE 0 END AS is_super_admin
      FROM users u
      LEFT JOIN super_admins sa
        ON sa.email = u.email
      WHERE u.email = ?
  `).get(email);

  if (!row) {
    return res.redirect(`/admin-login.html?error=Invalid%20email&email=${encodeURIComponent(email)}`);
  }

  if (!bcrypt.compareSync(password, row.password_hash)) {
    return res.redirect(`/admin-login.html?error=Invalid%20password&email=${encodeURIComponent(email)}`);
  }

  // Load all leagues the user belongs to
  const leagues = db.prepare(`
      SELECT lu.league_id, lu.is_member, lu.is_admin, lu.subgroup, lu.subgroup_number,
             l.league_name
        FROM league_users lu
        JOIN leagues l ON l.id = lu.league_id
       WHERE lu.user_id = ?
  `).all(row.id);

  const is_super_admin = row.is_super_admin === 1;

  req.session.user = {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    user_mode: "admin",
    leagues,
    league_id: null,
    league_name: null,
    is_super_admin
  };

  return req.session.save(() => {

    if (is_super_admin) {
      return res.redirect("/auth/admin-select-league");
    }

    const adminLeagues = leagues.filter(l => l.is_admin === 1);

    if (adminLeagues.length === 1) {
      req.session.user.league_id = adminLeagues[0].league_id;
      req.session.user.league_name = adminLeagues[0].league_name;

      return req.session.save(() => {
        res.redirect("/admin-dashboard");
      });
    }

    res.redirect("/auth/admin-select-league");
  });
});

module.exports = router;
