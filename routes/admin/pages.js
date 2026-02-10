// routes/admin/pages.js
const express = require("express");
const path = require("path");
const { requireAdmin } = require("../../middleware/auth");
const logger = require("../../utils/logger");

const router = express.Router();

// Dashboard
router.get("/", requireAdmin, (req, res) => {
  logger.route("GET", "/admin");
  res.sendFile(path.join(__dirname, "../../public/admin.html"));
});

// Golfers page
router.get("/golfers", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/golfers");
  res.sendFile(path.join(__dirname, "../../public/admin-golfers.html"));
});

// Leagues page
router.get("/leagues", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/leagues");
  res.sendFile(path.join(__dirname, "../../public/admin-leagues.html"));
});

// Play months page
router.get("/play-months", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/play-months");
  res.sendFile(path.join(__dirname, "../../public/admin-play-months.html"));
});

// Play days page
router.get("/play-days", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/play-days");
  res.sendFile(path.join(__dirname, "../../public/admin-play-days.html"));
});

// Admin nav partial
router.get("/partials/nav", requireAdmin, (req, res) => {
  logger.route("GET", "/admin/partials/nav");
  res.sendFile(path.join(__dirname, "../../public/partials/admin-nav.html"));
});

module.exports = router;