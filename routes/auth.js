const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../db");
const dbGet = require("../db").getAsync;
const dbRun = require("../db").runAsync;
const { requireLogin } = require("../middleware/auth");

// POST /auth/login
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

        // Save session
        req.session.user = {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            is_admin: user.is_admin,
            league_id: user.league_id
        };

        console.log("✅ LOGIN SUCCESS — SESSION SET:", req.session.user);

        return res.redirect("/schedule");

    } catch (err) {
        console.error("🔥 LOGIN ERROR:", err);
        return res.redirect("/login?error=1");
    }
});

router.put("/change-password", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const { current_password, new_password } = req.body;

  try {
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Load current hash
    const user = await db.getAsync(
      "SELECT password_hash FROM users WHERE id = ?",
      [userId]
    );

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    // Verify current password
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    // Hash new password
    const newHash = await bcrypt.hash(new_password, 10);

    // Update DB
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

// GET /auth/logout
router.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

module.exports = router;