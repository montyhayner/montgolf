// routes/userDashboard.js
const express = require("express");
const router = express.Router();
const { requireLogin } = require("../middleware/auth");

router.get("/", requireLogin, (req, res) => {
  res.render("user-dashboard", {
    user: req.session.user
  });
});

module.exports = router;