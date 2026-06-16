const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../db");
const { requireLogin } = require("../middleware/auth");

// ============================================================================
// GET /auth/me  →  Return current session user
// ============================================================================
router.get("/me", requireLogin, (req, res) => {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  res.json({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    league_id: user.league_id,
    is_admin: user.is_admin === 1,
    is_super_admin: user.is_super_admin === 1,
    user_mode: user.user_mode || "user" 
  });
});

// ============================================================================
// POST /auth/login
// ============================================================================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  console.log("➡️ ENTERED /auth/login ROUTE");

  try {
    const user = await db.getAsync(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (!user) {
      console.log("❌ LOGIN FAILED — no such email");
      return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      console.log("❌ LOGIN FAILED — bad password");
      return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
    }

    // Save session (FULL ROLE INFO)
    req.session.user = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      league_id: user.league_id,
      is_admin: user.is_admin,               // 0 or 1
      is_super_admin: user.is_super_admin,   // 0 or 1
      user_mode: "user"
    };

    console.log("✅ LOGIN SUCCESS — SESSION SET:", req.session.user);

    // ⭐ USER LOGIN ALWAYS GOES TO USER SCHEDULE PAGE
    // Even if the user is an admin, logging in through the USER login page
    // should treat them as a regular user.
    return res.redirect("/schedule.html");

  } catch (err) {
    console.error("🔥 LOGIN ERROR:", err);
    return res.redirect("/login?error=1");
  }
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

    const user = await db.getAsync(
      "SELECT password_hash FROM users WHERE id = ?",
      [userId]
    );

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    const newHash = await bcrypt.hash(new_password, 10);

    await db.runAsync(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [newHash, userId]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("🔥 CHANGE PASSWORD ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

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
// POST /auth/select-league
// ============================================================================
router.post("/select-league", (req, res) => {
  const { league_id } = req.body;

  if (!league_id) {
    return res.status(400).json({ error: "No league selected" });
  }

  // Preserve existing session fields
  req.session.user = {
    ...req.session.user,
    league_id,
    user_mode: req.session.user.user_mode,       // ⭐ preserve mode
    is_admin: req.session.user.is_admin,
    is_super_admin: req.session.user.is_super_admin
  };

  return res.json({ success: true });
});

// ============================================================================
// POST /auth/admin-login  (ADMIN LOGIN)
// ============================================================================
router.post("/admin-login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // ---------------------------------------------------------
    // 1. CHECK SUPER ADMIN TABLE
    // ---------------------------------------------------------
    const superAdmin = await db.getAsync(
      "SELECT * FROM super_admins WHERE email = ?",
      [email]
    );

    let isSuper = false;
    let superRecord = null;

    if (superAdmin) {
      const match = await bcrypt.compare(password, superAdmin.password_hash);
      //if (!match) {
      //  console.error("🔥 ADMIN LOGIN ERROR: Incorrect password for super admin");
      //  return res.redirect("/admin-login?error=1");
      //}
      isSuper = true;
      superRecord = superAdmin;
    }

    // ---------------------------------------------------------
    // 2. CHECK USERS TABLE (LEAGUE ADMIN)
    // ---------------------------------------------------------
    const user = await db.getAsync(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    let isLeagueAdmin = false;
    let leagueRecord = null;

    if (user) {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        console.error("🔥 ADMIN LOGIN ERROR: Incorrect password for league admin");
        return res.redirect("/admin-login?error=1");
      }

      if (user.is_admin === 1) {
        isLeagueAdmin = true;
        leagueRecord = user;
      }
    }

    // ---------------------------------------------------------
    // 3. IF NEITHER SUPER NOR LEAGUE ADMIN → reject
    // ---------------------------------------------------------
    if (!isSuper && !isLeagueAdmin) {
      console.error("🔥 ADMIN LOGIN ERROR: User is not a super admin nor a league admin");
      return res.redirect("/admin-login?error=1");
    }

    // ---------------------------------------------------------
    // 4. BUILD SESSION OBJECT
    // ---------------------------------------------------------
    req.session.user = {
      id: isSuper ? superRecord.id : leagueRecord.id,
      email: email,
      first_name: isSuper ? superRecord.first_name : leagueRecord.first_name,
      last_name: isSuper ? superRecord.last_name : leagueRecord.last_name,

      // ⭐ BOTH FLAGS ARE SET CORRECTLY
      is_super_admin: isSuper,
      is_admin: isLeagueAdmin,

      // ⭐ League admin starts with no league selected
      league_id: null,

      user_mode: "admin"
    };

    return req.session.save(() => {
      console.log("🔥 ADMIN LOGIN SUCCESS: User logged in successfully.  Sent to select-league");
      res.redirect("/auth/select-league");
    });

  } catch (err) {
    console.error("🔥 ADMIN LOGIN ERROR:", err);
    return res.redirect("/admin-login?error=1");
  }
});

module.exports = router;
