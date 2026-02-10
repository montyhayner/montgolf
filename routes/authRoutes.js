// routes/authRoutes.js

const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");

// POST /auth/login
router.post("/login", async (req, res) => {
  logger.route("POST", "/auth/login");

  const { email, password } = req.body;

  try {
    const user = await dbGet(
      `SELECT * FROM users WHERE email = ?`,
      [email]
    );

    if (!user) {
      return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
    }

    if (password !== user.password_hash) {
      return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
    }

    // Save session
    req.session.user = {
      id: user.id,
      email: user.email,
      is_admin: user.is_admin,
      league_id: user.league_id
    };

    // Redirect based on role
    if (user.is_admin) {
      return res.redirect("/admin.html");
    }

    // If user has a league, go to schedule
    if (user.league_id) {
      return res.redirect("/schedule.html");
    }

    // If user has no league, go to league selector
    return res.redirect("/select-league.html");

  } catch (err) {
    logger.error(err, "POST /auth/login");
    return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
  }
});

module.exports = router;

// --- DB helpers (async/await wrappers) ---

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

// -----------------------------------------------------------------------------
// USER LOGIN
// -----------------------------------------------------------------------------
router.post("/admin-login", async (req, res) => {
  logger.route("POST", "/admin-login");

  const { email, password } = req.body;

  try {
    const user = await dbGet(
      `SELECT * FROM users WHERE is_admin = 1 AND email = ?`,
      [email]
    );

    if (!user) {
      return res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
    }

    if (password !== user.password_hash) {
      return res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      is_admin: 1,
      league_id: user.league_id
    };

    logger.route("POST", "/admin-login", { admin_id: user.id });
    res.redirect("/admin.html");

  } catch (err) {
    logger.error(err, "POST /admin-login");
    res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
  }
});

// -----------------------------------------------------------------------------
// ADMIN LOGIN
// -----------------------------------------------------------------------------

router.post("/admin-login", async (req, res) => {
  logger.route("POST", "/admin-login");

  const { email, password } = req.body;

  try {
    const user = await dbGet(
      `SELECT * FROM users WHERE is_admin = 1 AND email = ?`,
      [email]
    );

    if (!user) {
      return res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
    }

    if (password !== user.password_hash) {
      return res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      is_admin: 1,
      league_id: user.league_id
    };

    logger.route("POST", "/admin-login", { admin_id: user.id });
    res.redirect("/admin.html");

  } catch (err) {
    logger.error(err, "POST /admin-login");
    res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
  }
});

// -----------------------------------------------------------------------------
// MULTI-LEAGUE USER → SELECT LEAGUE
// -----------------------------------------------------------------------------

router.post("/select-league", async (req, res) => {
  logger.route("POST", "/select-league");

  try {
    const { league_id } = req.body;

    if (!req.session.pendingUser) {
      return res.status(400).json({ error: "No pending user" });
    }

    const row = req.session.pendingUser.userRows.find(
      r => r.league_id == league_id
    );

    if (!row) {
      return res.status(400).json({ error: "Invalid league" });
    }

    req.session.user = {
      id: row.id,
      email: row.email,
      league_id: row.league_id
    };

    delete req.session.pendingUser;

    logger.route("POST", "/select-league", { user_id: row.id, league_id });
    res.json({ success: true });

  } catch (err) {
    logger.error(err, "POST /select-league");
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// ADMIN PASSWORD RESET (NO EMAIL — SIMPLE FLOW)
// -----------------------------------------------------------------------------

router.post("/admin-reset-password", async (req, res) => {
  logger.route("POST", "/admin-reset-password");

  const { email } = req.body;

  try {
    const user = await dbGet(
      `SELECT * FROM users WHERE is_admin = 1 AND email = ?`,
      [email]
    );

    if (!user) {
      return res.send("If this admin email exists, a reset link will be provided.");
    }

    logger.route("POST", "/admin-password-reset", { email });
      return res.redirect("/admin-set-new-password.html?email=" + encodeURIComponent(email));

  } catch (err) {
    logger.error(err, "POST /admin-reset-password");
    res.send("If this admin email exists, a reset link will be provided.");
  }
});

router.post("/admin-set-new-password", async (req, res) => {
  logger.route("POST", "/admin-set-new-password");

  const { email, newPassword } = req.body;

  try {
    await dbRun(
      `UPDATE users SET password_hash = ? WHERE is_admin = 1 AND email = ?`,
      [newPassword, email]
    );
    logger.db("Admin password updated", { email });
    res.send("Admin password updated. You may now log in.");

  } catch (err) {
    logger.error(err, "POST /admin-set-new-password");
    res.status(500).send("Error updating password.");
  }
});

// -----------------------------------------------------------------------------
// LOGOUT
// -----------------------------------------------------------------------------

router.get("/logout", (req, res) => {
  logger.route("GET", "/logout");

  req.session.destroy(() => {
    res.sendFile(require("path").join(__dirname, "../public/logout.html"));
  });
});

module.exports = router;