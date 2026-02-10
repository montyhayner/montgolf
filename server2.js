const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
const PORT = 3000;
const path = require("path");

app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'change_this_secret',
  resave: false,
  saveUninitialized: false
}));

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.redirect("/admin-login");
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Login required" });
  }
  next();
}

function requireAdminOrSelf(req, res, next) {
  const loggedInUser = req.session.user;
  const targetUserId = parseInt(req.params.userId);

  if (loggedInUser.is_admin === 1 || loggedInUser.id === targetUserId) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
}

app.get('/', (req, res) => {
  res.send('Golf Scheduler is running');
});

app.get("/partials/login-nav", (req, res) => {
  res.sendFile(path.join(__dirname, "public/partials/login-nav.html"));
});

app.get("/partials/user-nav", (req, res) => {
  res.sendFile(path.join(__dirname, "public/partials/user-nav.html"));
});

app.get("/api/user/info", requireLogin, (req, res) => {
  const userId = req.session.user.id;

  db.get(
    `SELECT first_name, last_name FROM users WHERE id = ?`,
    [userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ user: row });
    }
  );
});

app.get("/my-availability", (req, res) => {
  res.sendFile(path.join(__dirname, "public/my-availability.html"));
});

app.get('/api/user/schedule/:year/:month', requireLogin, async (req, res) => {
  console.log("SESSION AT SCHEDULE ROUTE:", req.session);

  const userId = req.session.user.id;
  const { year, month } = req.params;

  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2,'0')}-${String(endDate).padStart(2,'0')}`;

  // ---------------------------------------------------------
  // 1. FETCH SAVED SCHEDULE (correct SQL, correct placement)
  // ---------------------------------------------------------
  const saved = await new Promise((resolve, reject) => {
    db.all(
      `
      SELECT date, is_playing
      FROM schedule
      WHERE user_id = ?
        AND date BETWEEN ? AND ?
      `,
      [userId, start, end],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });

  console.log("SAVED ROW COUNT:", saved.length);

  // If saved schedule exists → return it
  if (saved.length > 0) {
    const schedule = {};
    saved.forEach(r => {
      schedule[r.date] = r.is_playing === 1;
    });

    console.log("RETURNING STATUS:", saved.length > 0 ? "saved" : "default");
    console.log("RETURNING SCHEDULE:", schedule);

    return res.json({
      schedule,
      status: "saved"
    });
  }

  // ---------------------------------------------------------
  // 2. NO SAVED SCHEDULE → CHECK IN-TOWN STATUS
  // ---------------------------------------------------------
  const monthRow = await new Promise((resolve, reject) => {
    db.get(
      `
      SELECT in_town
      FROM user_play_months
      WHERE user_id = ? AND month = ?
      `,
      [userId, month],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });

  if (!monthRow || monthRow.in_town === 0) {
    return res.json({
      schedule: {},
      status: "out_of_town"
    });
  }

  // ---------------------------------------------------------
  // 3. GET WEEKLY PLAY DAYS
  // ---------------------------------------------------------
  const playDays = await new Promise((resolve, reject) => {
    db.all(
      `
      SELECT day_of_week
      FROM user_play_days
      WHERE user_id = ? AND is_play_day = 1
      `,
      [userId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.day_of_week));
      }
    );
  });

  // ---------------------------------------------------------
  // 4. GENERATE DEFAULT SCHEDULE
  // ---------------------------------------------------------
  const schedule = {};

  for (let d = 1; d <= endDate; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0–6
    const fullDate = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    schedule[fullDate] = playDays.includes(dow);
  }

  return res.json({
    schedule,
    status: "default"
  });
});

app.get("/api/user/schedule", requireLogin, (req, res) => {
  let { lastScheduleYear, lastScheduleMonth } = req.session;

  if (!lastScheduleYear || !lastScheduleMonth) {
    const now = new Date();
    lastScheduleYear = now.getFullYear();
    lastScheduleMonth = String(now.getMonth() + 1).padStart(2, "0");
  }

  res.json({
    year: lastScheduleYear,
    month: lastScheduleMonth
  });
});

// Get list of all leagues
app.get('/api/leagues', (req, res) => {
  db.all("SELECT * FROM leagues ORDER BY league_name", [], (err, rows) => {
    if (err) {
      console.error("Error fetching leagues:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});

// Get league by id
app.get('/api/leagues/:id', (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM leagues WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error("Error fetching league:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!row) return res.status(404).json({ error: "League not found" });

    res.json(row);
  });
});

app.get("/api/user/availability", requireLogin, (req, res) => {
  const userId = req.session.user.id;

  const playDays = {};
  const playMonths = {};

  db.all(
    "SELECT day_of_week, is_play_day FROM user_play_days WHERE user_id = ?",
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      rows.forEach(r => {
        playDays[r.day_of_week] = r.is_play_day === 1;
      });

      db.all(
        "SELECT month, in_town FROM user_play_months WHERE user_id = ?",
        [userId],
        (err2, rows2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          rows2.forEach(r => {
            playMonths[r.month] = r.in_town === 1;
          });

          res.json({ playDays, playMonths });
        }
      );
    }
  );
});

// Get play days for a specific league
app.get("/api/admin/league/:league/play-days", (req, res) => {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  const sql = `
    SELECT league_id, day_of_week, is_play_day 
    FROM league_play_days 
    WHERE id = ?
   `;

  db.get(sql, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "League not found" });

    res.json(row);
  });
});

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get("/schedule", (req, res) => {
  res.sendFile(__dirname + "/public/schedule.html");
});

//app.get('/admin', (req, res) => {
//  res.send("Admin dashboard (coming soon)");
//});

app.get('/admin', requireAdmin, (req, res) => {
  console.log("app get /admin Session:", req.session);
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

app.get('/admin-users', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin-users.html"));
});

app.get('/admin-leagues', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin-leagues.html"));
});

app.get('/admin-play-months', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin-play-months.html"));
});

app.get('/admin-play-days', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin-play-days.html"));
});


app.get('/api/schedule/:leagueId/:date', (req, res) => {
  const { leagueId, date } = req.params;

  const dt = new Date(date);
  if (isNaN(dt)) {
    return res.status(400).json({ error: "Invalid date" });
  }

  const month = dt.getMonth() + 1;   // JS months 0–11
  const dayOfWeek = dt.getDay();     // 0–6

  const sql = `
    SELECT u.id, u.first_name, u.last_name
    FROM users u
    JOIN user_play_months m 
      ON m.user_id = u.id 
      AND m.month = ?
      AND m.in_town = 1
    JOIN user_play_days d
      ON d.user_id = u.id
      AND d.day_of_week = ?
      AND d.is_play_day = 1
    JOIN league_play_days l
      ON l.league_id = u.league_id
      AND l.day_of_week = ?
      AND l.is_play_day = 1
    WHERE u.league_id = ?
    ORDER BY u.last_name, u.first_name
  `;

  db.all(sql, [month, dayOfWeek, dayOfWeek, leagueId], (err, rows) => {
    if (err) {
      console.error("Scheduler error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({
      league_id: leagueId,
      date,
      month,
      day_of_week: dayOfWeek,
      eligible_players: rows
    });
  });
});

app.get('/api/users', (req, res) => {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  db.all(`SELECT id, last_name, first_name, email, 
     password_hash, is_admin, league_id,
     Subgroup, Subgroup_Number, is_member FROM users`,
     [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.json([]);
    }
    //console.log("Session:", req.session);
    res.json(rows);
  });
});

app.get("/api/user/playdays", (req, res) => {
  const userId = req.session.user.id;

  const sql = "SELECT play_days FROM user_play_days WHERE user_id = ?";
  db.get(sql, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ play_days: row ? row.play_days : "" });
  });
});

app.get("/api/admin/user", (req, res) => {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  const sql = `
    SELECT id, first_name, last_name, email, password_hash, 
        is_admin, league_id, subgroup, subgroup_number, is_member
    FROM users
    ORDER BY last_name, first_name
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ users: rows });
  });
});

app.get("/api/admin/user/:id/playdays", (req, res) => {
  const sql = "SELECT play_days FROM user_play_days WHERE user_id = ?";
  db.get(sql, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ play_days: row ? row.play_days : "" });
  });
});

app.get("/api/admin/user/:userId/leagues", requireAdmin, (req, res) => {
  db.all(
    `SELECT l.id, l.league_name
     FROM users u
     JOIN leagues l ON l.id = u.league_id
     WHERE u.email = (SELECT email FROM users WHERE id = ?)`,
    [req.params.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ leagues: rows });
    }
  );
});

app.get("/api/admin/schedule/:user_id/:year/:month", (req, res) => {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  const userId = parseInt(req.params.user_id);
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const start = `${year}-${String(month).padStart(2,"0")}-01`;
  const end = `${year}-${String(month).padStart(2,"0")}-31`;

  const sql = `
    SELECT date, playing
    FROM schedule
    WHERE user_id = ? AND date BETWEEN ? AND ?
  `;

  db.all(sql, [userId, start, end], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const result = {};
    rows.forEach(r => result[r.date] = r.playing);

    res.json(result);
  });
});

app.get('/api/user-play-months/:userId', requireLogin, requireAdminOrSelf, (req, res) => {
  const { userId } = req.params;

  const sql = `
    SELECT id, user_id, month, in_town
    FROM user_play_months
    WHERE user_id = ?
    ORDER BY month
  `;

  db.all(sql, [userId], (err, rows) => {
    if (err) {
      console.error("Error fetching user play months:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows);
  });
});

app.get('/api/user-play-days/:userId', requireLogin, requireAdminOrSelf, (req, res) => {
  const { userId } = req.params;

  db.all(`
    SELECT id, user_id, day_of_week, is_play_day
    FROM user_play_days
    WHERE user_id = ?
    ORDER BY day_of_week
  `, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(rows);
    console.log("STATUS:", saved.length > 0 ? "saved" : "default");
  });
});

app.get('/api/league-play-days/:leagueId', (req, res) => {
  const { leagueId } = req.params;

  const sql = `
    SELECT id, league_id, day_of_week, is_play_day
    FROM league_play_days
    WHERE league_id = ?
    ORDER BY day_of_week
  `;

  db.all(sql, [leagueId], (err, rows) => {
    if (err) {
      console.error("Error fetching league play days:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows);
  });
});

// two week report of players
app.get('/api/report/available-next-two-weeks/:leagueId', (req, res) => {
  const { leagueId } = req.params;

  const today = new Date();
  const results = {};

  let pending = 14;

  for (let i = 0; i < 14; i++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() + i);

    const dateStr = dt.toISOString().split('T')[0];
    const month = dt.getMonth() + 1;
    const dayOfWeek = dt.getDay();

    const sql = `
      SELECT u.id, u.first_name, u.last_name
      FROM users u
      JOIN user_play_months m 
        ON m.user_id = u.id 
        AND m.month = ?
        AND m.in_town = 1
      JOIN user_play_days d
        ON d.user_id = u.id
        AND d.day_of_week = ?
        AND d.is_play_day = 1
      JOIN league_play_days l
        ON l.league_id = u.league_id
        AND l.day_of_week = ?
        AND l.is_play_day = 1
      WHERE u.league_id = ?
      ORDER BY u.last_name, u.first_name
    `;

    db.all(sql, [month, dayOfWeek, dayOfWeek, leagueId], (err, rows) => {
      if (err) {
        results[dateStr] = { error: "Database error" };
      } else {
        results[dateStr] = rows;
      }

      pending--;
      if (pending === 0) {
        res.json(results);
      }
    });
  }
});

//report - players on a specific date
app.get('/api/report/available-date/:leagueId/:date', (req, res) => {
  const { leagueId, date } = req.params;

  const dt = new Date(date);
  if (isNaN(dt)) {
    return res.status(400).json({ error: "Invalid date" });
  }

  const month = dt.getMonth() + 1;   // 1–12
  const dayOfWeek = dt.getDay();     // 0–6

  const sql = `
    SELECT u.id, u.first_name, u.last_name
    FROM users u
    JOIN user_play_months m 
      ON m.user_id = u.id 
      AND m.month = ?
      AND m.in_town = 1
    JOIN user_play_days d
      ON d.user_id = u.id
      AND d.day_of_week = ?
      AND d.is_play_day = 1
    JOIN league_play_days l
      ON l.league_id = u.league_id
      AND l.day_of_week = ?
      AND l.is_play_day = 1
    WHERE u.league_id = ?
    ORDER BY u.last_name, u.first_name
  `;

  db.all(sql, [month, dayOfWeek, dayOfWeek, leagueId], (err, rows) => {
    if (err) {
      console.error("Scheduler error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({
      league_id: leagueId,
      date,
      month,
      day_of_week: dayOfWeek,
      eligible_players: rows
    });
  });
});

app.get("/api/pending-leagues", (req, res) => {
  if (!req.session.pendingUser) return res.json({ leagues: [] });
  res.json({ leagues: req.session.pendingUser.userRows });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.all(
    `SELECT * FROM users WHERE email = ?`,
    [email],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
      }

      // No rows for this email
      if (!rows || rows.length === 0) {
        return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
      }

      // All rows share the same password in plain-text mode
      const storedPassword = rows[0].password_hash;

      if (password !== storedPassword) {
        return res.redirect("/login?error=1&email=" + encodeURIComponent(email));
      }

      // CASE 1: User belongs to exactly one league
      if (rows.length === 1) {
        const user = rows[0];
        req.session.user = {
          id: user.id,
          email: user.email,
          league_id: user.league_id
        };
        return res.redirect("/schedule");
      }

      // CASE 2: User belongs to multiple leagues → prompt selection
      req.session.pendingUser = {
        email,
        password,
        userRows: rows
      };

      return res.redirect("/select-league");
    }
  );
});

app.post("/admin-login", (req, res) => {
  const { email, password } = req.body;

  db.get(
    `SELECT * FROM users WHERE is_admin = 1 AND email = ?`,
    [email],
    (err, user) => {
      if (err || !user) {
        return res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
      }

      // Plain-text password check
      if (password !== user.password_hash) {
        return res.redirect("/admin-login?error=1&email=" + encodeURIComponent(email));
      }

      // Success — store full user object like normal login
      req.session.user = {
        id: user.id,
        email: user.email,
        is_admin: 1,
        league_id: user.league_id
      };

      res.redirect("/admin");
    }
  );
});

app.post('/api/user/schedule/generate/:year/:month', requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const { year, month } = req.params;

  const endDate = new Date(year, month, 0).getDate();

  // Check in-town status
  const monthRow = await new Promise((resolve, reject) => {
    db.get(`
      SELECT in_town FROM user_play_months
      WHERE user_id = ? AND month = ?
    `, [userId, month], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  if (!monthRow || monthRow.in_town === 0) {
    return res.json({ schedule: {}, status: "out_of_town" });
  }

  // Weekly play days
  const playDays = await new Promise((resolve, reject) => {
    db.all(`
      SELECT day_of_week
      FROM user_play_days
      WHERE user_id = ? AND is_play_day = 1
    `, [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.day_of_week));
    });
  });

  // Build schedule
  const schedule = [];
  for (let d = 1; d <= endDate; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const fullDate = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    schedule.push({
      date: fullDate,
      is_playing: playDays.includes(dow) ? 1 : 0
    });
  }

  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const end = `${year}-${String(month).padStart(2,'0')}-${String(endDate).padStart(2,'0')}`;

  // Delete existing rows
  await new Promise((resolve, reject) => {
    db.run(`
      DELETE FROM schedule
      WHERE user_id = ?
        AND date BETWEEN ? AND ?
    `, [userId, start, end], err => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Insert new rows
  const stmt = db.prepare(`
    INSERT INTO schedule (user_id, date, is_playing)
    VALUES (?, ?, ?)
  `);

  schedule.forEach(r => stmt.run([userId, r.date, r.is_playing]));
  stmt.finalize();

  res.json({ schedule, status: "generated" });
});

app.post("/api/user/availability/default", requireLogin, (req, res) => {
  const userId = req.session.user.id;

  // Default weekly play days (Mon/Wed/Fri)
  const defaultPlayDays = {
    0: false,
    1: true,
    2: false,
    3: true,
    4: false,
    5: true,
    6: false
  };

  // Default monthly in-town (all true)
  const defaultPlayMonths = {};
  for (let m = 1; m <= 12; m++) defaultPlayMonths[m] = true;

  const stmtDays = db.prepare(`
    INSERT INTO user_play_days (user_id, day_of_week, is_play_day)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, day_of_week)
    DO UPDATE SET is_play_day = excluded.is_play_day
  `);

  const stmtMonths = db.prepare(`
    INSERT INTO user_play_months (user_id, month, in_town)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, month)
    DO UPDATE SET in_town = excluded.in_town
  `);

  db.serialize(() => {
    Object.entries(defaultPlayDays).forEach(([dow, val]) => {
      stmtDays.run(userId, Number(dow), val ? 1 : 0);
    });

    Object.entries(defaultPlayMonths).forEach(([month, val]) => {
      stmtMonths.run(userId, Number(month), val ? 1 : 0);
    });
  });

  stmtDays.finalize();
  stmtMonths.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });

    res.json({
      playDays: defaultPlayDays,
      playMonths: defaultPlayMonths
    });
  });
});

// Add a new league
app.post("/api/admin/leagues", requireAdmin, (req, res) => {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  const leagueName = req.body.league_name;

  if (!leagueName) {
    return res.status(400).json({ error: "League name required" });
  }

  const sql = `
    INSERT INTO league_play_days (league_id, day_of_week, is_play_day)
    VALUES (?, ?, ?)
  `;

  db.run(sql, [leagueName], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE")) {
        return res.status(400).json({ error: "League already exists" });
      }
      return res.status(500).json({ error: err.message });
    }

    res.json({ success: true });
  });
});

app.put("/api/user/schedule/:year/:month", requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const { schedule } = req.body;

  if (!schedule || typeof schedule !== "object") {
    return res.status(400).json({ error: "Invalid schedule payload" });
  }

  const stmt = db.prepare(`
    INSERT INTO schedule (user_id, date, is_playing)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, date)
    DO UPDATE SET is_playing = excluded.is_playing
  `);

  db.serialize(() => {
    Object.entries(schedule).forEach(([date, isPlaying]) => {
      stmt.run(userId, date, isPlaying ? 1 : 0);
    });
  });

  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/api/user/availability", requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const { playDays, playMonths } = req.body;

  if (!playDays || !playMonths) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const stmtDays = db.prepare(`
    INSERT INTO user_play_days (user_id, day_of_week, is_play_day)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, day_of_week)
    DO UPDATE SET is_play_day = excluded.is_play_day
  `);

  const stmtMonths = db.prepare(`
    INSERT INTO user_play_months (user_id, month, in_town)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, month)
    DO UPDATE SET in_town = excluded.in_town
  `);

  db.serialize(() => {
    // Save weekly play days
    Object.entries(playDays).forEach(([dow, val]) => {
      stmtDays.run(userId, Number(dow), val ? 1 : 0);
    });

    // Save monthly in-town status
    Object.entries(playMonths).forEach(([month, val]) => {
      stmtMonths.run(userId, Number(month), val ? 1 : 0);
    });
  });

  stmtDays.finalize();
  stmtMonths.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Rename a league
app.put("/api/admin/league/:league", (req, res) => {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  const oldName = req.params.league;
  const newName = req.body.new_league_name;

  if (!newName) {
    return res.status(400).json({ error: "New league name required" });
  }

  const sql = `
    UPDATE league_play_days
    SET league_name = ?
    WHERE league_name = ?
  `;

  db.run(sql, [newName, oldName], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE")) {
        return res.status(400).json({ error: "New league name already exists" });
      }
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    res.json({ success: true });
  });
});

app.put('/api/user-play-months/:userId', requireLogin, requireAdminOrSelf, (req, res) => {
  const { userId } = req.params;
  const { months } = req.body;

  if (!Array.isArray(months) || months.length !== 12) {
    return res.status(400).json({ error: "Must provide 12 month objects" });
  }

  const stmt = db.prepare(`
    INSERT INTO user_play_months (user_id, month, in_town)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, month)
    DO UPDATE SET in_town = excluded.in_town
  `);

  db.serialize(() => {
    months.forEach(m => {
      stmt.run([userId, m.month, m.in_town]);
    });
  });

  stmt.finalize(err => {
    if (err) {
      console.error("Error updating user play months:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ success: true });
  });
});

// Delete a league
app.delete("/api/admin/league/:league", (req, res) => {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  const leagueName = req.params.league;

  const sql = "DELETE FROM league_play_days WHERE league_name = ?";

  db.run(sql, [leagueName], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    if (this.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    res.json({ success: true });
  });
});

// Update play days for a league
app.put('/api/league-play-days/:leagueId', requireAdmin, (req, res) => {
  const { leagueId } = req.params;
  const { days } = req.body;

  if (!Array.isArray(days) || days.length !== 7) {
    return res.status(400).json({ error: "Must provide 7 day objects" });
  }

  const stmt = db.prepare(`
    INSERT INTO league_play_days (league_id, day_of_week, is_play_day)
    VALUES (?, ?, ?)
    ON CONFLICT(league_id, day_of_week)
    DO UPDATE SET is_play_day = excluded.is_play_day
  `);

  db.serialize(() => {
    days.forEach(d => {
      stmt.run([leagueId, d.day_of_week, d.is_play_day]);
    });
  });

  stmt.finalize(err => {
    if (err) {
      console.error("Error updating league play days:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ success: true });
  });
});

app.put('/api/user-play-days/:userId', requireLogin, requireAdminOrSelf, (req, res) => {
  const { userId } = req.params;
  const { days } = req.body;

  if (!Array.isArray(days) || days.length !== 7) {
    return res.status(400).json({ error: "Must provide 7 day objects" });
  }

  // Step 1: Get user's league
  db.get("SELECT league_id FROM users WHERE id = ?", [userId], (err, userRow) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (!userRow) return res.status(404).json({ error: "User not found" });

    const leagueId = userRow.league_id;

    // Step 2: Get league play days
    db.all(`
      SELECT day_of_week 
      FROM league_play_days 
      WHERE league_id = ? AND is_play_day = 1
    `, [leagueId], (err, leagueRows) => {
      if (err) return res.status(500).json({ error: "Database error" });

      const allowedDays = leagueRows.map(r => r.day_of_week);

      // Step 3: Validate user-submitted days
      for (const d of days) {
        if (d.is_play_day === 1 && !allowedDays.includes(d.day_of_week)) {
          return res.status(400).json({
            error: `Day ${d.day_of_week} is not a valid play day for this league`
          });
        }
      }

      // Step 4: Upsert rows
      const stmt = db.prepare(`
        INSERT INTO user_play_days (user_id, day_of_week, is_play_day)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, day_of_week)
        DO UPDATE SET is_play_day = excluded.is_play_day
      `);

      db.serialize(() => {
        days.forEach(d => {
          stmt.run([userId, d.day_of_week, d.is_play_day]);
        });
      });

      stmt.finalize(err => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json({ success: true });
      });
    });
  });
});

// INSERT sql backend
app.post('/api/users', (req, res) => {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }
  //console.log("REQ BODY:", req.body);
  const { last_name, first_name, email, password_hash,
     is_admin, league_id, subgroup,
     subgroup_number, is_member } = req.body;

  const sql = `
    INSERT INTO users (last_name, first_name, email,
    password_hash, is_admin, league_id, 
    subgroup, subgroup_number, is_member)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(sql, [last_name, first_name, email, password_hash,
     is_admin, league_id, subgroup,
     subgroup_number, is_member],
     function(err) {
    if (err) {
      console.error(err);
      return res.json({ error: "Insert failed" });
    }
    res.json({ success: true, id: this.lastID });
  });
});

app.post('/api/leagues', requireAdmin, (req, res) => {
  const { league_name, coordinator_last_name, coordinator_first_name } = req.body;

  const sql = `
    INSERT INTO leagues (league_name, coordinator_last_name, coordinator_first_name)
    VALUES (?, ?, ?)
  `;

  db.run(sql, [league_name, coordinator_last_name, coordinator_first_name], function (err) {
    if (err) {
      console.error("Error creating league:", err);
      return res.status(400).json({ error: "League name must be unique" });
    }

    res.json({
      id: this.lastID,
      league_name,
      coordinator_last_name,
      coordinator_first_name
    });
  });
});

app.post("/api/user/schedule/default/:year/:month", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const { year, month } = req.params;

  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2,'0')}-${String(endDate).padStart(2,'0')}`;

  // Check in-town status
  const monthRow = await new Promise((resolve, reject) => {
    db.get(
      `SELECT in_town FROM user_play_months WHERE user_id = ? AND month = ?`,
      [userId, month],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });

  if (!monthRow || monthRow.in_town === 0) {
    return res.json({ schedule: {}, status: "out_of_town" });
  }

  // Weekly play days
  const playDays = await new Promise((resolve, reject) => {
    db.all(
      `SELECT day_of_week FROM user_play_days WHERE user_id = ? AND is_play_day = 1`,
      [userId],
      (err, rows) => err ? reject(err) : resolve(rows.map(r => r.day_of_week))
    );
  });

  // Build default schedule
  const schedule = {};
  for (let d = 1; d <= endDate; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const fullDate = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    schedule[fullDate] = playDays.includes(dow);
  }

  // Save to DB
  const stmt = db.prepare(`
    INSERT INTO schedule (user_id, date, is_playing)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, date)
    DO UPDATE SET is_playing = excluded.is_playing
  `);

  db.serialize(() => {
    Object.entries(schedule).forEach(([date, isPlaying]) => {
      stmt.run(userId, date, isPlaying ? 1 : 0);
    });
  });

  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ schedule, status: "default" });
  });
});

app.post("/api/user/schedule/clear/:year/:month", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const { year, month } = req.params;

  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2,'0')}-${String(endDate).padStart(2,'0')}`;

  // Get all dates in month
  const dates = [];
  for (let d = 1; d <= endDate; d++) {
    dates.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  }

  const stmt = db.prepare(`
    INSERT INTO schedule (user_id, date, is_playing)
    VALUES (?, ?, 0)
    ON CONFLICT(user_id, date)
    DO UPDATE SET is_playing = 0
  `);

  db.serialize(() => {
    dates.forEach(date => stmt.run(userId, date));
  });

  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, schedule: {} });
  });

});app.post("/api/admin/user/add-league", requireAdmin, (req, res) => {
  const { email, league_id, password_hash } = req.body;

  db.run(
    `INSERT INTO users (email, league_id, password_hash)
     VALUES (?, ?, ?)`,
    [email, league_id, password_hash],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.post("/api/admin/user/remove-league", requireAdmin, (req, res) => {
  const { user_id } = req.body;

  db.run(
    `DELETE FROM users WHERE id = ?`,
    [user_id],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.post("/api/user/set-last-month", requireLogin, (req, res) => {
  const { year, month } = req.body;

  req.session.lastScheduleYear = year;
  req.session.lastScheduleMonth = month;

  res.json({ success: true });
});

app.post("/api/select-league", (req, res) => {
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

  res.json({ success: true });
});

app.post("/admin-reset-password", (req, res) => {
  const { email } = req.body;

  db.get(
    `SELECT * FROM users WHERE is_admin = 1 AND email = ?`,
    [email],
    (err, user) => {
      if (!user) {
        return res.send("If this admin email exists, a reset link will be provided.");
      }

      return res.redirect("/admin-set-new-password?email=" + encodeURIComponent(email));
    }
  );
});

app.post("/admin-set-new-password", (req, res) => {
  const { email, newPassword } = req.body;

  db.run(
    `UPDATE users SET password_hash = ? WHERE is_admin = 1 AND email = ?`,
    [newPassword, email],
    () => res.send("Admin password updated. You may now log in.")
  );
});

// UPDATE sql backend
  app.put('/api/users/:id', (req, res) => {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { last_name, first_name, email, password_hash, is_admin,
    league_id, subgroup, subgroup_number,
    is_member } = req.body;
  const id = req.params.id;

  const sql = `
    UPDATE users
    SET last_name = ?, first_name= ?, email = ?,
    password_hash = ?, is_admin = ?, league_id = ?,
    subgroup = ?, subgroup_number = ?,
    is_member = ?
    WHERE id = ?
  `;

  db.run(sql, [last_name, first_name, email, password_hash,
     is_admin, league_id, subgroup,
     subgroup_number, is_member, id], function(err) {
    if (err) {
      console.error(err);
      return res.json({ error: "Update failed" });
    }
    res.json({ success: true, changes: this.changes });
  });
});

app.put('/api/league-play-days/:leagueId', requireAdmin, (req, res) => {
  const { leagueId } = req.params;
  const { days } = req.body;

  if (!Array.isArray(days) || days.length !== 7) {
    return res.status(400).json({ error: "Must provide 7 day objects" });
  }

  const stmt = db.prepare(`
    INSERT INTO league_play_days (league_id, day_of_week, is_play_day)
    VALUES (?, ?, ?)
    ON CONFLICT(league_id, day_of_week)
    DO UPDATE SET is_play_day = excluded.is_play_day
  `);

  db.serialize(() => {
    days.forEach(d => {
      stmt.run([leagueId, d.day_of_week, d.is_play_day]);
    });
  });

  stmt.finalize(err => {
    if (err) {
      console.error("Error updating league play days:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ success: true });
  });
});

// DELETE sql backend
app.delete('/api/users/:id', (req, res) => {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const id = req.params.id;

  const sql = `DELETE FROM users WHERE id = ?`;

  db.run(sql, [id], function(err) {
    if (err) {
      console.error(err);
      return res.json({ error: "Delete failed" });
    }
    res.json({ success: true, changes: this.changes });
  });
});

//Delete a row of the leagues table
app.delete('/api/leagues/:id', requireAdmin, (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM leagues WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Error deleting league:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    res.json({ success: true });
  });
});

app.put("/api/admin/schedule", (req, res) => {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  const { user_id, schedule } = req.body;

  if (!user_id || typeof schedule !== "object") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const stmt = db.prepare(`
    INSERT INTO schedule (user_id, date, is_playing)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, date)
    DO UPDATE SET is_playing = excluded.is_playing
  `);

  db.serialize(() => {
    Object.entries(schedule).forEach(([date, isPlaying]) => {
      stmt.run(user_id, date, isPlaying ? 1 : 0);
    });
  });

  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/api/user/play-months", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const userId = req.session.user.id;
  const m = req.body; // { jan:1, feb:0, ... }

  const sql = `
    INSERT INTO user_play_months (
      user_id, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET
      jan=excluded.jan,
      feb=excluded.feb,
      mar=excluded.mar,
      apr=excluded.apr,
      may=excluded.may,
      jun=excluded.jun,
      jul=excluded.jul,
      aug=excluded.aug,
      sep=excluded.sep,
      oct=excluded.oct,
      nov=excluded.nov,
      dec=excluded.dec
  `;

  const params = [
    userId,
    m.jan, m.feb, m.mar, m.apr,
    m.may, m.jun, m.jul, m.aug,
    m.sep, m.oct, m.nov, m.dec
  ];

  db.run(sql, params, err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/api/user/playdays", (req, res) => {
  const userId = req.session.user.id;
  const playDays = req.body.play_days;

  const sql = `
    INSERT INTO user_play_days (user_id, play_days)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET play_days = excluded.play_days
  `;

  db.run(sql, [userId, playDays], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put("/api/admin/user/:id/playdays", (req, res) => {
  const playDays = req.body.play_days;

  const sql = `
    INSERT INTO user_play_days (user_id, play_days)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET play_days = excluded.play_days
  `;

  db.run(sql, [req.params.id, playDays], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put('/api/leagues/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { league_name, coordinator_last_name, coordinator_first_name } = req.body;

  const sql = `
    UPDATE leagues
    SET league_name = ?, coordinator_last_name = ?, coordinator_first_name = ?
    WHERE id = ?
  `;

  db.run(sql, [league_name, coordinator_last_name, coordinator_first_name, id], function (err) {
    if (err) {
      console.error("Error updating league:", err);
      return res.status(400).json({ error: "League name must be unique" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    res.json({ success: true });
  });
});

app.get("/api/user/selected-league", requireLogin, (req, res) => {
  const leagueId = req.session.user.league_id;

  db.get(
    "SELECT id, league_name FROM leagues WHERE id = ?",
    [leagueId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ league: row });
    }
  );
});

app.get("/partials/admin-nav", (req, res) => {
  res.sendFile(path.join(__dirname, "public/partials/admin-nav.html"));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.sendFile(path.join(__dirname, "public/logout.html"));
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});