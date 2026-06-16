router.get("/reports/latest-tee-sheet", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    // 1. Find the latest tee_date for this league
    const row = db.prepare(`
      SELECT MAX(tee_date) AS latest_date
      FROM tee_sheet
      WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.latest_date) {
      return res.json({ teeSheet: [], play_date: null });
    }

    const latestDate = row.latest_date;

    // 2. Retrieve the tee sheet rows for that date
    const teeSheet = db.prepare(`
      SELECT 
        ts.tee_time,
        ts.subgroup,
        ts.subgroup_number,
        u.first_name,
        u.last_name
      FROM tee_sheet ts
      JOIN users u ON u.id = ts.user_id
      WHERE ts.league_id = ?
        AND ts.tee_date = ?
      ORDER BY ts.tee_time ASC, ts.subgroup ASC, ts.subgroup_number ASC
    `).all(leagueId, latestDate);

    return res.json({
      play_date: latestDate,
      teeSheet
    });

  } catch (err) {
    console.error("❌ Error loading latest tee sheet:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/reports/latest-tee-sheet/email", requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const leagueId = user.league_id;

    // -----------------------------
    // 0. Get league name
    // -----------------------------
    const league = db.prepare(`
      SELECT league_name
      FROM leagues
      WHERE id = ?
    `).get(leagueId);

    const leagueName = league?.league_name || "";

    // -----------------------------
    // 1. Get latest tee sheet
    // -----------------------------
    const row = db.prepare(`
      SELECT MAX(tee_date) AS latest_date
      FROM tee_sheet
      WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.latest_date) {
      const emptyText = `Latest Tee Sheet Report - ${leagueName}\n\nNo tee sheet found.\n`;

      await transporter.sendMail({
        from: "rlhayner@verizon.net",
        to: user.email,
        subject: `Latest Tee Sheet Report - ${leagueName}`,
        text: emptyText,
        html: `<p>No tee sheet found.</p>`
      });

      return res.json({ ok: true });
    }

    const latestDate = row.latest_date;

    const teeSheet = db.prepare(`
      SELECT 
        ts.tee_time,
        ts.subgroup,
        ts.subgroup_number,
        u.first_name,
        u.last_name
      FROM tee_sheet ts
      JOIN users u ON u.id = ts.user_id
      WHERE ts.league_id = ?
        AND ts.tee_date = ?
      ORDER BY ts.tee_time ASC, ts.subgroup ASC, ts.subgroup_number ASC
    `).all(leagueId, latestDate);

    // -----------------------------
    // 2. Generate email content
    // -----------------------------
    const textReport = generateLatestTeeSheetText(teeSheet, latestDate, leagueName);
    const htmlReport = generateLatestTeeSheetHTML(teeSheet, latestDate, leagueName);

    // -----------------------------
    // 3. Build recipient list
    // -----------------------------
    let finalRecipients = [];

    // CASE A: Regular user → force self-only
    if (!user.is_super_admin && !user.is_admin) {
      finalRecipients = [user.email];
    }

    // CASE B: Admin → use modal selections
    else {
      const {
        includePlayers,
        includeAdmins,
        includeStaff,
        includeSelf
      } = req.body;

      const recipients = new Set();

      // Self
      if (includeSelf && user.email) {
        recipients.add(user.email);
      }

      // Players in tee sheet
      if (includePlayers) {
        const players = db.prepare(`
          SELECT DISTINCT u.email
          FROM tee_sheet ts
          JOIN users u ON u.id = ts.user_id
          WHERE ts.league_id = ?
            AND ts.tee_date = ?
        `).all(leagueId, latestDate);

        players.forEach(p => p.email && recipients.add(p.email));
      }

      // Admins
      if (includeAdmins) {
        const admins = db.prepare(`
          SELECT email
          FROM users
          WHERE league_id = ?
            AND is_admin = 1
        `).all(leagueId);

        admins.forEach(a => a.email && recipients.add(a.email));
      }

      // Staff
      if (includeStaff) {
        const staff = db.prepare(`
          SELECT email
          FROM club_staff
          WHERE league_id = ?
        `).all(leagueId);

        staff.forEach(s => s.email && recipients.add(s.email));
      }

      finalRecipients = Array.from(recipients);

      if (finalRecipients.length === 0) {
        return res.status(400).json({ error: "No recipients selected" });
      }
    }

    // -----------------------------
    // 4. Send the email
    // -----------------------------
    await transporter.sendMail({
      from: "rlhayner@verizon.net",
      to: finalRecipients.join(", "),
      subject: `Latest Tee Sheet Report - ${leagueName}`,
      text: textReport,
      html: htmlReport
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("❌ Error sending latest tee sheet report:", err);
    return res.status(500).json({ error: "Unable to send report email" });
  }
});
