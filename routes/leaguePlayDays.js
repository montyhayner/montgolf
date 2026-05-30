const express = require("express");
const router = express.Router();
module.exports = (db) => {

  // GET allowed play days for the logged-in user's league
  router.get("/", async (req, res) => {
    try {
      const leagueId = req.session.user.league_id;

      const rows = await db.allAsync(
        "SELECT day_of_week FROM league_play_days WHERE league_id = ? AND is_play_day = 1",
        [leagueId]
      );

      const days = rows.map(r => r.day_of_week); // e.g., [1,3,5]

      res.json({ days });

    } catch (err) {
      console.error("Error fetching league play days:", err);
      res.status(500).json({ error: "Failed to load league play days" });
    }
  });

  return router;
};