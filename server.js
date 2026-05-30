//server.js
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
delete require.cache[require.resolve("./db")];
console.log("REQUIRING DB FROM:", require.resolve("./db"));
const app = express();
const db = require("./db");
const { requireLogin } = require("./middleware/auth");
const bcrypt = require("bcrypt");
const { easternNow } = require("./utils/easternTime");
const latestApplyResultMap = {};
const transporter = require("./services/mailer");


// ------------------------------
// Express Setup
// ------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: "your-secret",
    resave: false,
    saveUninitialized: false
}));

console.log("🧩 SESSION MIDDLEWARE LOADED");

// ------------------------------------------------------
// DEBUG LOGGER — NOW sessions exist here
// ------------------------------------------------------
app.use((req, res, next) => {
    console.log("🔥 GLOBAL REQUEST:", req.method, req.url);
    console.log("🔥 SESSION AT START:", req.session);
    next();
});

console.log("USING DB FILE:", require("path").resolve("./golf.db"));
console.log("DB TYPE:", db);
console.log("DB KEYS:", Object.keys(db));

if (process.env.NODE_ENV === "development") {
  console.log("Running in development mode");
}

// ------------------------------
// Static files
// ------------------------------
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------
// Login page
// ------------------------------
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ------------------------------
// Routers
// ------------------------------

console.log("🔍 About to require routes...");

[
  "./routes/auth",
  "./routes/user",
  "./routes/guests",
  "./routes/reports"
].forEach(r => {
  try {
    console.log("🔎 Trying require:", r);
    require(r);
    console.log("   ✔ Success:", r);
  } catch (err) {
    console.log("   ❌ Failed:", r, "→", err.message);
  }
});

app.use("/auth", require("./routes/auth"));
app.use("/user", require("./routes/user"));
const guestsRouter = require("./routes/guests");
app.use("/api/guests", requireLogin, guestsRouter);
const reportsRoutes = require("./routes/reports");
app.use("/reports", reportsRoutes);
app.use("/partials", express.static(__dirname + "/public/partials"));
const leaguePlayDaysRouter = require("./routes/leaguePlayDays")(db);
app.use("/api/league-play-days", requireLogin, leaguePlayDaysRouter);

// ------------------------------
// Safety net — allow login.html
// ------------------------------
//app.get(/.*\.html$/, (req, res, next) => {
//    if (req.url.startsWith("/admin")) return next();
//   if (req.url === "/login.html") return next();
//   return res.redirect("/admin-login");
// });
// ==============================

// ------------------------------
// SQLite Promise Helpers
// ------------------------------
function dbGet(sql, params = []) {
  return db.getAsync(sql, params);
}

function dbAll(sql, params = []) {
  return db.allAsync(sql, params);
}

function dbRun(sql, params = []) {
  return db.runAsync(sql, params);
}

// ------------------------------
// Middleware
// ------------------------------
function requireAdmin(req, res, next) {
    if (!req.session.user) {
        if (req.originalUrl.includes("/api")) {
            return res.status(401).json({ error: "Not logged in" });
        }
        return res.redirect("/admin-login");
    }

    if (req.session.user.is_super_admin) {
        return next();
    }

    if (req.session.user.is_admin && req.session.user.league_id) {
        return next();
    }

    if (req.originalUrl.includes("/api")) {
        return res.status(403).json({ error: "No league selected" });
    }

    return res.redirect("/auth/select-league");
}

function requireAdminLoginOnly(req, res, next) {
    console.log("→ requireAdminLoginOnly fired");
    console.log("  session.user =", req.session.user);

    if (!req.session.user) {
        return res.redirect("/admin-login");
    }

    if (req.session.user.is_super_admin || req.session.user.is_admin) {
        return next();
    }

    return res.status(403).send("Admins only");
}

function requireSuperAdmin(req, res, next) {
    console.log("→ requireSuperAdmin fired");
    console.log("  session.user =", req.session.user);

    if (req.session.user && req.session.user.is_super_admin) {
        console.log("  ✔ Super Admin allowed");
        return next();
    }

    console.log("  ✖ Super Admin denied");
    return res.status(403).send("Super Admin only");
}

function requireLeagueAdmin(req, res, next) {
    console.log("→ requireLeagueAdmin fired");
    console.log("  session.user =", req.session.user);

    const isApi = req.originalUrl.includes("/api");

    // Super Admin WITH league
    if (req.session.user?.is_super_admin && req.session.user?.league_id) {
        console.log("  ✔ Super Admin WITH league allowed");
        return next();
    }

    // League Admin WITH league
    if (req.session.user?.is_admin && req.session.user?.league_id) {
        console.log("  ✔ League Admin allowed");
        return next();
    }

    // No league selected
    console.log("  ✖ No league selected");

    if (isApi) {
        // API routes must return JSON, not redirect
        return res.status(403).json({ error: "No league selected" });
    }

    // Page routes can redirect normally
    return res.redirect("/auth/select-league");
}

async function requireTeeSheetEditor(req, res, next) {
  try {
    const user = req.session.user;   // FIXED

    if (!user) {
      console.log("No user in session");
      return res.status(401).send("Not logged in");
    }

    const leagueId = parseInt(req.params.leagueId, 10);

    // 1. Super admin always allowed
    if (user.is_super_admin) {
      return next();
    }

    // 2. Load league coordinator info
    const league = await dbGet(
      `SELECT email, coordinator_controls_editing
         FROM leagues
        WHERE id = ?`,
      [leagueId]
    );

    if (!league) {
      return res.status(404).send("League not found");
    }

    const isCoordinator = (user.email === league.email);

    // 3. Coordinator always allowed
    if (isCoordinator) {
      return next();
    }

    // 4. If coordinator allows admins → allow league admins
    if (league.coordinator_controls_editing === 0 && user.is_admin) {
      return next();
    }

    // 5. Otherwise deny
    return res.status(403).send("You do not have permission to edit this tee sheet");

  } catch (err) {
    console.error("Permission error:", err);
    res.status(500).send("Server error");
  }
}


app.get("/guests", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "guests.html"));
});

app.get("/reports", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});

app.get("/my-availability", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "my-availability.html"));
});

app.get("/admin/allocated-tee-times", requireLeagueAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-allocated-tee-times.html"));
});
  
// ------------------------------
// AUTH ROUTES
// ------------------------------
app.get("/admin-login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

app.get("/edit-profile", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "user-edit-profile.html"));
});

// ----------------------------------------------------------------------------------------------
// Produce the CURRENT TIMESTAMP in yyyy-mm-dd hh:mn:ss 
// format and return to calling code.
// ----------------------------------------------------------------------------------------------
async function formatSqliteTimestamp() {
// ----------------------------------------------------------------------------------
// determine whether to subtract 4 hours or 5 hours from
// the db timestamp depending on whether today's
// date is EDT (eastern daylight savings time) or EST
// (eastern standard time).  EDT is between 2nd Sunday
// in March and the first Sunday in November.
// ----------------------------------------------------------------------------------
  const currYear = new Date().getFullYear();
  console.log("currYear=", currYear);

//  get first Eastern Daylight savings Time date (first sunday in Nov)...
  const march1 = new Date(currYear, 2, 1);  // 2 is March
  const marchDay = march1.getDay(); // 0=Sun ... 6=Sat 
  const firstSundayDate = 1 + ((7 - marchDay) % 7);
  const secondSundayDate = firstSundayDate + 7;
  const firstEDTDate = new Date(currYear, 2, secondSundayDate);
  console.log("firstEDTDate=", firstEDTDate);

//  now get first Eastern Standard Time date (first sunday in Nov)...
  const nov1 = new Date(currYear, 10, 1);
  const novDay = nov1.getDay(); // 0=Sunday ... 6=Saturday
  const firstSunDate = 1 + ((7 - novDay) % 7);
  const firstESTDate = new Date(currYear, 10, firstSunDate);
  console.log("firstESTDate=", firstESTDate);

  const currDate = new Date();
  console.log("formatSqliteTimestamp() function - javascript currDate=", currDate);
  let league;
 try {
  if (currDate >= firstEDTDate && currDate < firstESTDate) { 
       league = await dbGet(
           `SELECT datetime(CURRENT_TIMESTAMP, '-4 hours') AS eastern_timestamp
                 FROM leagues 
             WHERE id in
                                  (SELECT MIN(id) 
                                        FROM leagues)`,
              []);
      
  } else {
          league = await dbGet(
          `SELECT datetime(CURRENT_TIMESTAMP, '-5 hours') AS eastern_timestamp
                FROM leagues 
            WHERE id in
                                 (SELECT MIN(id) 
                                       FROM leagues)`,
               []);
  } 
     if (!league) {
        return ("Error - sql failure in function formatSqliteTimestamp()");
      } 
   const easternTS =  league.eastern_timestamp;
   console.log("function formatSqliteTimestamp()  eastern timestamp=", easternTS);
   return easternTS;
  } catch (err) {
    console.error("Error - formatSqliteTimestamp()", err);
    return ("Server error");
  }
}

// -------------------------------------------------------------------------------------
// place added golfers into free slots (user_id-based)
// -------------------------------------------------------------------------------------
// AUTO‑PLACE GOLFERS (patched with tee sheet history logging)
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// AUTO‑PLACE GOLFERS (Simplified Model)
// Places golfers into the first available slot (chronological order)
// -----------------------------------------------------------------------------
async function autoPlaceGolfers(leagueId, teeDate, addedGolfers, changedBy) {
  // 1. Load working tee sheet (later tee times first)
  const rows = await dbAll(
    `SELECT *
       FROM tee_sheet_working
      WHERE league_id = ?
        AND tee_date = ?
      ORDER BY tee_time DESC, starting_nine`,
    [leagueId, teeDate]
  );

  const placed = [];
  const unplaced = [];

  // 2. Try to place each golfer
  for (const golfer of addedGolfers) {
    let placedThisGolfer = false;

    for (const row of rows) {
      const slots = [
        row.user_id1,
        row.user_id2,
        row.user_id3,
        row.user_id4
      ];

      const emptyIndex = slots.findIndex(s => !s);

      if (emptyIndex !== -1) {
        const slotNum = emptyIndex + 1;
        const colUser  = `user_id${slotNum}`;
        const colFirst = `first_name${slotNum}`;
        const colLast  = `last_name${slotNum}`;

        // ⭐ UPDATE DB (no history logging)
        await dbRun(
          `UPDATE tee_sheet_working
              SET ${colUser}  = ?,
                  ${colFirst} = ?,
                  ${colLast}  = ?
            WHERE id = ?`,
          [golfer.user_id, golfer.first_name, golfer.last_name, row.id]
        );

        // ⭐ Update in‑memory row
        row[colUser] = golfer.user_id;
        row[colFirst] = golfer.first_name;
        row[colLast] = golfer.last_name;

        placed.push(golfer);
        placedThisGolfer = true;
        break;
      }
    }

    if (!placedThisGolfer) {
      unplaced.push(golfer);
    }
  }

  // 3. Reload updated rows
  const updatedRows = await dbAll(
    `SELECT *
       FROM tee_sheet_working
      WHERE league_id = ?
        AND tee_date = ?
      ORDER BY tee_time, starting_nine`,
    [leagueId, teeDate]
  );

  return { placed, unplaced, rows: updatedRows };
}

// ------------------------------
// ADMIN LOGIN (POST)
// ------------------------------
app.post("/admin-login", async (req, res) => {
    const { email, password } = req.body;

    console.log("LOGIN BODY:", req.body);

    try {
        // 1. SUPER ADMIN LOGIN
	console.log(  "SQL:",
  "SELECT * FROM super_admins WHERE email = '" + email + "' AND password_hash = '" + password + "'"
);
        const superAdmin = await db.getAsync(
            "SELECT * FROM super_admins WHERE email = ? AND password_hash = ?",
            [email, password]
        );

        console.log("SUPER ADMIN QUERY RESULT:", superAdmin);

    if (superAdmin) {
        req.session.user = {
            id: superAdmin.id,
            email: superAdmin.email,
            first_name: superAdmin.first_name,
            last_name: superAdmin.last_name,
            is_super_admin: true,
            is_admin: false,
            league_id: null
        };

         // ADD THESE TWO LINES:
        req.session.league_id = null;
        req.session.league_name = null;

        console.log("SUPER ADMIN LOGIN SUCCESS:", req.session.user);

        return req.session.save(() => {
            res.redirect("/auth/select-league");
        });
     }

  // 2. LEAGUE ADMIN LOGIN (supports multi-league admins)
  // Get all users that match on email id and have is_admin = 1 (league admin)
  // If no rows are returned, display a message indicating that the user
  // is neither a Super Admin nor a League Admin.
  // If at least one row is returned, compare the bcryption of the user entered
  // password against the value found in the users table.  If the password 	
  // matches, the user IS a League Admin.  If none of the rows returned
  // matches on password, the user is Neither a Super Admin Nor a League
  // Admin.  If only one league matches the user's email and PW, return the
  // league id.  If more than one league matches, return -1 as the league_id

        const rows = await db.allAsync(
             `SELECT users.id
	                 , users.email
 			             , users.password_hash
	                 , users.first_name
                   , users.last_name
                   , leagues.league_name
                FROM  users
                JOIN leagues ON leagues.id = users.league_id
               WHERE users.email = ?
                 AND users.is_admin = 1`,
            [email]
        );

  let user = null;
	let leaguesCount = 0;

  for (const row of rows) {
    const match = await bcrypt.compare(password, row.password_hash);
    if (match) {
                user = row;
		            adminLeague = user.league_id;
		            leaguesCount = 1;
                console.log("LEAGUE ADMIN User and Password  MATCHED:", user);
                req.session.user = {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                is_super_admin: false,
                is_admin: true,
                league_id: user.league_id
                };
		  req.session.league_id = user.league_id;
      req.session.league_name = user.league_name;
 	    break;
	    }
    }
	  if (leaguesCount === 0) {
      console.log("LOGIN FAILED user is neither a Super Admin nor a League Admin email = ", email );
      return res.redirect("/admin-login?error=Invalid Admin credentials");
	  }
    return req.session.save(() => {
           res.redirect("/admin-dashboard");  // NOT select-league for league admins
    });

  } catch (err) {
        console.error("❌ Login error in POST of admin-login:", err);
        return res.redirect("/admin-login?error=Server error.");
  }
});

// ------------------------------
// SUPER ADMIN LEAGUE SELECTION
// ------------------------------
app.get("/auth/select-league", requireAdminLoginOnly, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "select-league.html"));
    console.log("→ HANDLER: GET /auth/select-league");
    console.log("  session.user =", req.session.user);
});

app.get("/auth/leagues", requireSuperAdmin, async (req, res) => {
    console.log("→ HANDLER: GET /auth/app.get(/auth/leagues");
    console.log("  session.user =", req.session.user);
    try {
        const rows = await dbAll("SELECT id, league_name FROM leagues ORDER BY league_name");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error loading Super Admin leagues" });
    }
});

app.get("/auth/leagues2", requireAdminLoginOnly, async (req, res) => {
    console.log("→ HANDLER: GET /auth/leagues2");
    console.log("  session.user =", req.session.user);

    try {
        const rows = await dbAll(
            `SELECT leagues.id, leagues.league_name
             FROM users
             JOIN leagues ON leagues.id = users.league_id
             WHERE users.email = ?
               AND users.is_admin = 1
             ORDER BY leagues.league_name`,
            [req.session.user.email]
        );

        res.json(rows);

    } catch (err) {
        console.error("❌ SQL ERROR in /auth/leagues2:", err);
        res.status(500).json({ error: "Error loading League Admin leagues" });
    }
});

app.get("/auth/me", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged in" });
    }

    return res.json(req.session.user);
});

// -----------------------------------------------------------------------------
// GET CHANGES SINCE LAST TEE SHEET UPDATE
// -------------------------------------------------------------------------------------------------
// SHOW CHANGES (simplified model: only schedule adds/drops)
// -------------------------------------------------------------------------------------------------
app.get(
  "/admin/api/tee-sheet/:leagueId/:teeDate/changes",
  requireTeeSheetEditor,
  async (req, res) => {
    try {
      const { leagueId, teeDate } = req.params;
      console.log("GET /admin/api/tee-sheet/:leagueId/:teeDate/changes - route start -", 
      " leagueId=", leagueId, " teeDate=", teeDate);

      // -----------------------------------------------------------------------
      // 1. Find last tee sheet update time (baseline)
      // -----------------------------------------------------------------------
      const lastUpdateRow = await dbGet(
        `SELECT MAX(edited_at) AS last_update
           FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?`,
        [leagueId, teeDate]
      );

      const lastUpdate = lastUpdateRow?.last_update || null;

      console.log("=== SHOW CHANGES (SIMPLIFIED) ===");
      console.log("leagueId:", leagueId, "teeDate:", teeDate);
      console.log("baseline lastUpdate:", lastUpdate);

      // -----------------------------------------------------------------------
      // 2. Load schedule_history rows AFTER lastUpdate
      // -----------------------------------------------------------------------
      const historyRows = await dbAll(
        `SELECT 
            sh.user_id,
            sh.old_is_playing,
            sh.new_is_playing,
            sh.changed_at,
            u.first_name,
            u.last_name,
            u.email
         FROM schedule_history sh
         JOIN users u ON u.id = sh.user_id
        WHERE sh.league_id = ?
          AND sh.play_date = ?
          AND sh.changed_at > ?
        ORDER BY sh.changed_at ASC`,
        [leagueId, teeDate, lastUpdate || "1970-01-01 00:00:00"]
      );

      console.log("historyRows:", historyRows.length);

      // -----------------------------------------------------------------------
      // 3. Classify adds and drops
      // -----------------------------------------------------------------------
      const added = [];
      const removed = [];

      for (const row of historyRows) {
        // ADD: was not playing → now playing
        if (row.old_is_playing === 0 && row.new_is_playing === 1) {
          added.push({
            user_id: row.user_id,
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
            requested_at: row.changed_at
          });
        }

        // DROP: was playing → now not playing
        if (row.old_is_playing === 1 && row.new_is_playing === 0) {
          removed.push({
            user_id: row.user_id,
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email
          });
        }
      }

      // -----------------------------------------------------------------------
      // 4. Return simplified diff
      // -----------------------------------------------------------------------
      res.json({
        lastUpdate,
        added,
        removed
      });

    } catch (err) {
      console.error("Error in simplified tee-sheet changes route:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

app.get("/admin/api/tee-sheet/:leagueId/:teeDate", requireTeeSheetEditor, async (req, res) => {
  const { leagueId, teeDate } = req.params;

  const userEmail =  req.session.user.email;

  console.log("get /admin/api/tee-sheet/:leagueid/:teeDate - req.session.user.email=", req.session.user.email);
  console.log("get /admin/api/tee-sheet/:leagueid/:teeDate - TEE SHEET ROUTE SESSION:", req.session);

  try {
    // 1. Check if working copy exists
    const workingRows = await dbAll(
      `SELECT *
            FROM tee_sheet_working
        WHERE league_id = ?
               AND tee_date = ?
         ORDER BY tee_time ASC`,
      [leagueId, teeDate]
    );

    if (workingRows.length > 0) {
      return res.json(workingRows);
    }

    // 2. If not, copy from tee_sheet
    const liveRows = await dbAll(
      `SELECT *
            FROM tee_sheet
         WHERE league_id = ?
                AND tee_date = ?
          ORDER BY tee_time ASC`,
      [leagueId, teeDate]
    );

    if (liveRows.length === 0) {
      return res.status(404).send("No tee sheet exists for this league/date");
    }

    // 3. Insert into working table
    const insertStmt = `
      INSERT INTO tee_sheet_working (
        tee_date, tee_time, starting_nine, league_id, league_name,
        user_id1, last_name1, first_name1,
        user_id2, last_name2, first_name2,
        user_id3, last_name3, first_name3,
        user_id4, last_name4, first_name4,
        edited_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const row of liveRows) {
      await dbRun(insertStmt, [
        row.tee_date,
        row.tee_time,
        row.starting_nine,
        leagueId,
        row.league_name,
        row.user_id1,
        row.last_name1,
        row.first_name1,
        row.user_id2,
        row.last_name2,
        row.first_name2,
        row.user_id3,
        row.last_name3,
        row.first_name3,
        row.user_id4,
        row.last_name4,
        row.first_name4,
        userEmail
      ]);
    }

    const fresh = await dbAll(
      `SELECT *
            FROM tee_sheet_working
         WHERE league_id = ?
                AND tee_date = ?
          ORDER BY tee_time ASC`,
      [leagueId, teeDate]
    );

    res.json(fresh);

  } catch (err) {
    console.error("Load tee sheet error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------------------------------------------
// SERVE THE TEE SHEET EDITOR HTML PAGE
// ----------------------------------------------------
const fs = require("fs");

app.get("/admin/tee-sheet/:leagueId/:teeDate", requireTeeSheetEditor, (req, res) => {
  const { leagueId, teeDate } = req.params;

  const html = fs.readFileSync(
    path.join(__dirname, "public", "admin-edit-tee-sheet.html"),
    "utf8"
  );

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Edit Tee Sheet</title>
      <script>
        window.LEAGUE_ID = "${leagueId}";
        window.TEE_DATE = "${teeDate}";
      </script>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `);
});


app.get("/admin/tee-sheet", requireAdmin, async (req, res) => {
  console.log("admin/tee-sheet get route - TEE SHEET ROUTE SESSION:", req.session);

  const leagueId = req.session.league_id;

  if (!leagueId) {
    return res.status(400).send("No league selected. Please log in again.");
  }

  try {
    // Find the most recent tee_date for this league
    const row = await dbGet(
      `SELECT MAX(tee_date) AS max_date
            FROM tee_sheet
        WHERE league_id = ?`,
      [leagueId]
    );

    if (!row || !row.max_date) {
      return res.send(`
        <h2>No tee sheet found</h2>
        <p>The upcoming tee sheet has not been generated yet.</p>
      `);
    }

    const maxDate = row.max_date;
    const today = new Date().toISOString().slice(0, 10);

    if (maxDate < today) {
      return res.send(`
        <h2>No upcoming tee sheet</h2>
        <p>The most recent tee sheet (${maxDate}) is in the past.<br>
        The upcoming tee sheet has not been generated yet.</p>
      `);
    }

    // Redirect to the editor for this league/date
        return res.redirect(
          `/admin/tee-sheet/${leagueId}/${maxDate}?leagueId=${leagueId}&teeDate=${maxDate}`
        );

  } catch (err) {
    console.error("Error loading tee sheet:", err);
    res.status(500).send("Server error");
  }
});

// ----------------------------------------------------------------------------------
// SAVE
// ----------------------------------------------------------------------------------
app.post("/admin/api/tee-sheet/:leagueId/:teeDate/save",
  requireTeeSheetEditor,
  async (req, res) => {
    const { leagueId, teeDate } = req.params;
    const newRows = req.body.rows;
    const userEmail = req.session.user.email;
    const easternTimestamp = easternNow();

    console.log("=== SAVE START ===");

    try {
      // 1. Load old tee_sheet rows
      const oldRows = await dbAll(
        `SELECT *
           FROM tee_sheet
          WHERE league_id = ?
            AND tee_date = ?
       ORDER BY tee_time ASC`,
        [leagueId, teeDate]
      );

      // 2. Audit log
      await dbRun(
        `INSERT INTO tee_sheet_audit_log
           (tee_date, league_id, user_email, action, change_summary,
            before_state, after_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          teeDate,
          leagueId,
          userEmail,
          "SAVE",
          "Full save (no diff)",
          JSON.stringify(oldRows),
          JSON.stringify(newRows),
          easternTimestamp
        ]
      );

      // 3. Load existing working rows so we can PRESERVE edited_at
      const oldWorking = await dbAll(
        `SELECT tee_time, starting_nine, edited_at
           FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?`,
        [leagueId, teeDate]
      );

      function findEditedAt(row) {
        const match = oldWorking.find(
          r =>
            r.tee_time === row.tee_time &&
            r.starting_nine === row.starting_nine
        );
        return match ? match.edited_at : easternTimestamp;
      }

      // 4. Replace tee_sheet with newRows
      await dbRun(
        `DELETE FROM tee_sheet
          WHERE league_id = ?
            AND tee_date = ?`,
        [leagueId, teeDate]
      );

      const insertStmt = `
        INSERT INTO tee_sheet (
          tee_date, tee_time, starting_nine, league_id, league_name,
          user_id1, last_name1, first_name1,
          user_id2, last_name2, first_name2,
          user_id3, last_name3, first_name3,
          user_id4, last_name4, first_name4,
          is_locked, generated_by, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      for (const row of newRows) {
        await dbRun(insertStmt, [
          row.tee_date,
          row.tee_time,
          row.starting_nine,
          leagueId,
          row.league_name,
          row.user_id1,
          row.last_name1,
          row.first_name1,
          row.user_id2,
          row.last_name2,
          row.first_name2,
          row.user_id3,
          row.last_name3,
          row.first_name3,
          row.user_id4,
          row.last_name4,
          row.first_name4,
          1,
          userEmail,
          row.generated_at
        ]);
      }

      // 5. Sync working copy — PRESERVE edited_at
      await dbRun(
        `DELETE FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?`,
        [leagueId, teeDate]
      );

      const insertWorking = `
        INSERT INTO tee_sheet_working (
          tee_date, tee_time, starting_nine, league_id, league_name,
          user_id1, last_name1, first_name1,
          user_id2, last_name2, first_name2,
          user_id3, last_name3, first_name3,
          user_id4, last_name4, first_name4,
          edited_by, edited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      for (const row of newRows) {
        await dbRun(insertWorking, [
          row.tee_date,
          row.tee_time,
          row.starting_nine,
          leagueId,
          row.league_name,
          row.user_id1,
          row.last_name1,
          row.first_name1,
          row.user_id2,
          row.last_name2,
          row.first_name2,
          row.user_id3,
          row.last_name3,
          row.first_name3,
          row.user_id4,
          row.last_name4,
          row.first_name4,
          userEmail,
          findEditedAt(row)   // ⭐ PRESERVE baseline
        ]);
      }

      res.json({ status: "SUCCESS" });

    } catch (err) {
      console.error("Save tee sheet error:", err);
      res.status(500).send("Server error");
    }
  }
);

app.post("/admin/api/tee-sheet/:leagueId/:teeDate/revert", requireTeeSheetEditor, async (req, res) => {
  const { leagueId, teeDate } = req.params;
  const userEmail = req.session.user.email;
  const easternTimestamp = easternNow();

  try {
    // 1. Delete working copy
    await dbRun(
      `DELETE 
         FROM tee_sheet_working
        WHERE league_id = ?
          AND tee_date = ?`,
      [leagueId, teeDate]
    );

    // 2. Copy from tee_sheet
    const liveRows = await dbAll(
      `SELECT *
         FROM tee_sheet
        WHERE league_id = ?
          AND tee_date = ?
     ORDER BY tee_time ASC`,
      [leagueId, teeDate]
    );

    const insertStmt = `
      INSERT INTO tee_sheet_working (
        tee_date, tee_time, starting_nine, league_id, league_name,
          user_id1, last_name1, first_name1, 
          user_id2, last_name2, first_name2,
          user_id3, last_name3, first_name3,
          user_id4, last_name4, first_name4,
        edited_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const row of liveRows) {
      await dbRun(insertStmt, [
        row.tee_date,
        row.tee_time,
        row.starting_nine,
        leagueId,
        row.league_name,
        row.user_id1,
        row.last_name1,
        row.first_name1,
        row.user_id2,
        row.last_name2,
        row.first_name2,
        row.user_id3,
        row.last_name3,
        row.first_name3,
        row.user_id4,
        row.last_name4,
        row.first_name4,
        userEmail
      ]);
    }

    // 3. Log revert
    await dbRun(
      `INSERT INTO tee_sheet_audit_log
         (tee_date, league_id, user_email, action, change_summary, 
          before_state, after_state, created_at)
       VALUES (?, ?, ?, 'REVERT', 'Reverted working copy', '[]', '[]', ?)`,
      [teeDate, leagueId, userEmail, easternTimestamp]
    );

    res.json(liveRows);

  } catch (err) {
    console.error("Revert error:", err);
    res.status(500).send("Server error");
  }
});

// -----------------------------------------------------------------------------
// REBUILD TEE SHEET (Simplified Model)
// No slot column, no diffing, no history logging
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// REBUILD TEE SHEET (Corrected, No DB Locks in Route)
// -----------------------------------------------------------------------------
app.post(
  "/admin/api/tee-sheet/:leagueId/:teeDate/rebuild",
  requireTeeSheetEditor,
  async (req, res) => {
    const { leagueId, teeDate } = req.params;
    const adminEmail = req.session.user.email;

    console.log("🔥 REBUILD REQUEST:", leagueId, teeDate, "by", adminEmail);

    try {
      // ❗ NO TRANSACTION HERE
      // ❗ NO DELETE HERE
      // ❗ NO INSERT HERE
      // ❗ JUST CALL THE GENERATOR
      await generateTeeSheet({
        leagueId: Number(leagueId),
        playDate: teeDate,
        generatedBy: adminEmail
      });

      res.json({ status: "SUCCESS" });

    } catch (err) {
      console.error("Rebuild tee sheet error:", err);
      res.status(500).json({
        status: "ERROR",
        message: err.message || "Rebuild failed"
      });
    }
  }
);

// -----------------------------------------------------------------------------
// INTERNAL: APPLY DROPS (Simplified Model)
// removedUserIds = array of objects: { user_id, first_name, last_name, email }
// -----------------------------------------------------------------------------
async function applyDropsInternal(leagueId, teeDate, removedUserIds, changedBy) {
  if (!Array.isArray(removedUserIds) || removedUserIds.length === 0) return;

  console.log("applyDropsInternal: removing", removedUserIds);

  for (const item of removedUserIds) {
    const uid = Number(item.user_id);

    // 1. Find the row where this golfer is currently placed
    const row = await dbGet(
      `SELECT *
         FROM tee_sheet_working
        WHERE league_id = ?
          AND tee_date = ?
          AND (
                CAST(user_id1 AS INTEGER) = CAST(? AS INTEGER)
             OR CAST(user_id2 AS INTEGER) = CAST(? AS INTEGER)
             OR CAST(user_id3 AS INTEGER) = CAST(? AS INTEGER)
             OR CAST(user_id4 AS INTEGER) = CAST(? AS INTEGER)
          )`,
      [leagueId, teeDate, uid, uid, uid, uid]
    );

    if (!row) {
      console.log(`applyDropsInternal: user ${uid} not found on tee sheet`);
      continue;
    }

    // 2. Determine which slot they occupy
    let slot = null;
    if (Number(row.user_id1) === uid) slot = 1;
    else if (Number(row.user_id2) === uid) slot = 2;
    else if (Number(row.user_id3) === uid) slot = 3;
    else if (Number(row.user_id4) === uid) slot = 4;

    if (!slot) {
      console.log(`applyDropsInternal: user ${uid} found but slot unknown`);
      continue;
    }

    const colUser  = `user_id${slot}`;
    const colFirst = `first_name${slot}`;
    const colLast  = `last_name${slot}`;

    // 3. Clear the slot (ALL THREE COLUMNS)
    await dbRun(
      `UPDATE tee_sheet_working
          SET ${colUser} = NULL,
              ${colFirst} = '',
              ${colLast} = ''
        WHERE id = ?`,
      [row.id]
    );

    console.log(`applyDropsInternal: cleared slot ${slot} for user ${uid}`);
  }
}

// -------------------------------------------------------------------------------------------
// apply the changes that occurred since the last editing of
// tee_sheet_editor page ... which could be simply moving
// players to other tee times or tee slots via drag and drop, or
// it could be via applying drops and or adds of users or 
// guests who dropped out or have been added through the
// schedule or guests processes.
// ------------------------------------------------------------------------------------------- 
// APPLY CHANGES (Simplified Model: Drops → Adds Chronologically)
// -----------------------------------------------------------------------------
app.post(
  "/admin/api/tee-sheet/:leagueId/:teeDate/apply-changes",
  requireTeeSheetEditor,
  async (req, res) => {
    const { leagueId, teeDate } = req.params;
    const { removed, added } = req.body;
    const adminEmail = req.session.user.email;
    const ts = easternNow();

    console.log("=== APPLY CHANGES (SIMPLIFIED) ===");
    console.log("removed:", removed);
    console.log("added:", added);

    if (!Array.isArray(removed) || !Array.isArray(added)) {
      return res.status(400).json({
        error: "Apply Changes error: request body missing valid 'added' and 'removed' arrays."
      });
    }

    try {
      // ---------------------------------------------------------
      // BEGIN TRANSACTION
      // ---------------------------------------------------------
      // await dbRun("BEGIN TRANSACTION");

      // ---------------------------------------------------------
      // 1. APPLY DROPS FIRST
      // ---------------------------------------------------------
      if (removed.length > 0) {
        console.log("Applying DROPS...");
        await applyDropsInternal(leagueId, teeDate, removed, adminEmail);
      }

      // ---------------------------------------------------------
      // 2. APPLY ADDS (SORTED BY requested_at)
      // ---------------------------------------------------------
      let placed = [];
      let unplaced = [];

      if (added.length > 0) {
        console.log("Applying ADDS chronologically...");

        // Sort by requested_at ascending
        const sortedAdds = [...added].sort(
          (a, b) => new Date(a.requested_at) - new Date(b.requested_at)
        );

        const placementResult = await autoPlaceGolfers(
          leagueId,
          teeDate,
          sortedAdds,
          adminEmail
        );

        placed = placementResult.placed;
        unplaced = placementResult.unplaced;
      }

      // ---------------------------------------------------------
      // 3. UPDATE edited_at / edited_by ONCE
      // ---------------------------------------------------------
      await dbRun(
        `UPDATE tee_sheet_working
           SET edited_at = ?, edited_by = ?
         WHERE league_id = ? AND tee_date = ?`,
        [ts, adminEmail, leagueId, teeDate]
      );

      // ---------------------------------------------------------
      // COMMIT TRANSACTION
      // ---------------------------------------------------------
      // await dbRun("COMMIT");

      // ---------------------------------------------------------
      // 4. RETURN UPDATED TEE SHEET
      // ---------------------------------------------------------
      const rows = await dbAll(
        `SELECT *
           FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
          ORDER BY tee_time, starting_nine`,
        [leagueId, teeDate]
      );

      console.log("=== APPLY CHANGES COMPLETE ===");

      res.json({
        status: "SUCCESS",
        placed,
        unplaced,
        rows
      });

    } catch (err) {
      console.error("Apply Changes Error:", err);

     // try { await dbRun("ROLLBACK"); } catch {}

      res.status(500).json({ error: "Server error applying changes." });
    }
  }
);

// -----------------------------------------------------------------------------
// SEND NOTIFICATIONS
// -----------------------------------------------------------------------------
app.post(
  "/admin/api/tee-sheet/:leagueId/:teeDate/send-notifications",
  requireTeeSheetEditor,
  async (req, res) => {
    const { leagueId, teeDate } = req.params;
    const { recipientGroups, includeTeeSheet, includeUnplaced, message } = req.body;

    const adminEmail = req.session.user.email;

    try {
      // ---------------------------------------------------------
      // 1. Load tee sheet WITH golfer emails via JOIN
      // ---------------------------------------------------------
      const teeRows = await dbAll(
        `
        SELECT 
          ts.*,
          u1.email AS email1,
          u2.email AS email2,
          u3.email AS email3,
          u4.email AS email4
        FROM tee_sheet_working ts
        LEFT JOIN users u1 ON ts.user_id1 = u1.id
        LEFT JOIN users u2 ON ts.user_id2 = u2.id
        LEFT JOIN users u3 ON ts.user_id3 = u3.id
        LEFT JOIN users u4 ON ts.user_id4 = u4.id
        WHERE ts.league_id = ?
          AND ts.tee_date = ?
        ORDER BY ts.tee_time, ts.starting_nine
        `,
        [leagueId, teeDate]
      );

      // ---------------------------------------------------------
      // 2. Load placed/unplaced from Apply Changes
      // ---------------------------------------------------------
      const applyResult =
        latestApplyResultMap?.[`${leagueId}_${teeDate}`] || {
          placed: [],
          unplaced: []
        };

      const placed = applyResult.placed || [];
      const unplaced = applyResult.unplaced || [];

      // ---------------------------------------------------------
      // 3. Build recipient list
      // ---------------------------------------------------------
      let recipients = new Set();

      // Tee sheet players
      if (recipientGroups.teeSheetPlayers) {
        for (const row of teeRows) {
          [row.email1, row.email2, row.email3, row.email4].forEach(email => {
            if (email) recipients.add(email);
          });
        }
      }

      // Unplaced golfers
      if (recipientGroups.unplacedGolfers) {
        unplaced.forEach(g => {
          if (g.email) recipients.add(g.email);
        });
      }

      // League admins
      if (recipientGroups.leagueAdmins) {
        const admins = await dbAll(
          `SELECT email FROM users WHERE league_id = ? AND is_admin = 1`,
          [leagueId]
        );
        admins.forEach(a => {
          if (a.email) recipients.add(a.email);
        });
      }

      // Club staff
      if (recipientGroups.clubStaff) {
        const staff = await dbAll(
          `SELECT email FROM club_staff WHERE league_id = ? AND is_active = 1`,
          [leagueId]
        );
        staff.forEach(s => {
          if (s.email) recipients.add(s.email);
        });
      }

      // Always CC the admin
      recipients.add(adminEmail);

      // Convert to array
      const recipientList = Array.from(recipients).filter(Boolean);

      // ---------------------------------------------------------
      // 4. Build email HTML body
      // ---------------------------------------------------------
      let html = "";

      if (message && message.trim()) {
        html += `<p>${message}</p>`;
      }

      if (includeTeeSheet) {
        html += `<h2>Tee Sheet for ${teeDate}</h2>`;
        html += `<table border="1" cellpadding="6" cellspacing="0">`;
        html += `<tr><th>Tee Time</th><th>Nine</th><th>Players</th></tr>`;

        for (const row of teeRows) {
          const players = [
            row.first_name1 && `${row.first_name1} ${row.last_name1}`,
            row.first_name2 && `${row.first_name2} ${row.last_name2}`,
            row.first_name3 && `${row.first_name3} ${row.last_name3}`,
            row.first_name4 && `${row.first_name4} ${row.last_name4}`
          ]
            .filter(Boolean)
            .join(", ");

          html += `
            <tr>
              <td>${row.tee_time}</td>
              <td>${row.starting_nine}</td>
              <td>${players}</td>
            </tr>
          `;
        }

        html += `</table>`;
      }

      if (includeUnplaced && unplaced.length > 0) {
        html += `<h2>Unplaced Golfers</h2><ul>`;
        unplaced.forEach(g => {
          html += `<li>${g.first_name} ${g.last_name}</li>`;
        });
        html += `</ul>`;
      }

      // ---------------------------------------------------------
      // 5. Send ONE email with all recipients
      // ---------------------------------------------------------
      const subject = `Tee Sheet – ${teeDate}`;

      const toList = recipientList.filter(e => e !== adminEmail);
      const ccList = [adminEmail];

      if (toList.length === 0) {
        console.warn("No TO recipients — falling back to admin only");
        toList.push(adminEmail);
      }

      await transporter.sendMail({
        from: adminEmail,
        to: toList.join(","),
        cc: ccList.join(","),
        subject,
        html
      });

      res.json({
        status: "SENT",
        count: recipientList.length
      });

    } catch (err) {
      console.error("Send Notifications Error:", err);
      res.status(500).json({ error: "Server error sending notifications." });
    }
  }
);

// ---------------------------------------------------------------------
// SUPER ADMIN LEAGUE SELECTION (POST)
// ---------------------------------------------------------------------
app.post("/auth/select-league", requireAdminLoginOnly, async (req, res) => {
    const leagueId = parseInt(req.body.league_id, 10);

    try {
        const league = await db.getAsync(
            `SELECT id
                  , league_name 
               FROM leagues 
              WHERE id = ?`,
            [leagueId]
        );

        if (!league) {
            return res.status(400).send("Invalid league selection.");
        }

        // Store selected league in session
        req.session.league_id = league.id;
        req.session.league_name = league.league_name;

        // Also update the user object for consistency
        req.session.user.league_id = league.id;

        console.log("SUPER ADMIN SELECTED LEAGUE:", req.session);

        return req.session.save(() => {
            res.redirect("/admin-dashboard");
        });

    } catch (err) {
        console.error("Error selecting league:", err);
        res.status(500).send("Server error");
    }
});

// ------------------------------
// START AT index.html
// -----------------------------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ------------------------------
// ADMIN PAGES
// ------------------------------
app.get("/admin", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

// ------------------------------
// ADMIN DASHBOARD (Protected)
// ------------------------------
app.get("/admin-dashboard", requireAdmin, (req, res) => {
    console.log("→ GET /admin-dashboard", {
        admin_id: req.session.user?.id,
        league_id: req.session.user?.league_id
    });
    console.log("session.league_id =", req.session.league_id);
    console.log("session.league_name =", req.session.league_name);

    res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

app.get("/admin/golfers", requireLeagueAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin-golfers.html"));
});

app.get("/admin/leagues", requireSuperAdmin, (req, res) => {
    console.log("→ GET /admin/leagues");
    console.log("  session.user =", req.session.user);
    res.sendFile(path.join(__dirname, "public", "admin-leagues.html"));
});

app.get("/admin/session-info", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;

        let leagueName = null;
        if (user.league_id) {
            const row = await db.getAsync(
                "SELECT league_name FROM leagues WHERE id = ?",
                [user.league_id]
            );
            leagueName = row ? row.league_name : null;
        }

        res.json({
            id: user.id,
            email: user.email,
            is_super_admin: user.is_super_admin,
            is_admin: user.is_admin || false,
            league_id: user.league_id,
            first_name: user.first_name,
            last_name: user.last_name,
            league_name: leagueName
        });

    } catch (err) {
        console.error("server.js app.get /admin/session-info - SESSION INFO ERROR:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ------------------------------
// LEAGUE APIs
// ------------------------------

app.get("/admin/leagues/api/:id", requireAdmin, async (req, res) => {
    const id = req.params.id;
    console.log("/admin/leagues/api/:id   id=", id);

    try {
        const league = await dbGet(
            "SELECT id, league_name, first_name, last_name, email, description FROM leagues WHERE id = ?",
            [id]
        );

        if (!league) {
            return res.json({ error: "League not found" });
        }

        console.log("league=", league);
        res.json(league);
    } catch (err) {
        console.error(err);
        res.json({ error: "Database error" });
    }
});

app.get("/admin/leagues/api", requireSuperAdmin, async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT id, league_name, last_name, first_name, email, description
            FROM leagues
            ORDER BY league_name
        `);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error loading leagues" });
    }
});

app.get("/admin/leagues/tee-interval", requireLeagueAdmin, async (req, res) => {
  const leagueId = req.session.user.league_id;
  console.log("get of /admin/leagues/tee-interval ... leagueId=", leagueId, "req.session.user=", req.session.user);

  try {
    const row = await dbGet(
      `SELECT tee_interval_minutes
       FROM leagues
       WHERE id = ?`,
      [leagueId]
    );
    console.log("get of /admin/leagues/tee-interval ... row.tee_interval_minutes=", row.tee_interval_minutes);
    res.json({ tee_interval_minutes: row.tee_interval_minutes });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/allocated-tee-times/:play_date", requireLeagueAdmin, async (req, res) => {
  const leagueId = req.session.user.league_id;
  const { play_date } = req.params;

  try {
    const rows = await dbAll(
      `SELECT id, play_date, tee_time_number, tee_time
       FROM allocated_tee_times
       WHERE league_id = ? AND play_date = ?
       ORDER BY tee_time_number ASC`,
      [leagueId, play_date]
    );

    res.json({ teeTimes: rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/user/selected-league", requireLogin, async (req, res) => {
  try {
    const leagueId = req.session.user.league_id;

    if (!leagueId) {
      return res.json({ league: null });
    }

    const row = await dbGet(
      `SELECT id, league_name
       FROM leagues
       WHERE id = ?`,
      [leagueId]
    );

    res.json({ league: row });

  } catch (err) {
    console.error("Error in /user/selected-league:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/leagues/api/:id", requireAdmin, async (req, res) => {
    const id = req.params.id;
    const { league_name, first_name, last_name, email, description } = req.body;

    try {
        await dbRun(
            `UPDATE leagues
             SET league_name = ?, first_name = ?, last_name = ?, email = ?, description = ?
             WHERE id = ?`,
            [league_name, first_name, last_name, email, description, id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error("PUT /admin/leagues/api/:id ERROR:", err);
        res.json({ error: "Database error" });
    }
});

app.post("/admin/leagues/api", requireSuperAdmin, async (req, res) => {
    const { league_name, last_name, first_name, email, description } = req.body;

    if (!league_name) return res.status(400).json({ error: "League name is required" });

    try {
        const result = await dbRun(`
            INSERT INTO leagues (league_name, last_name, first_name, email, description)
            VALUES (?, ?, ?, ?, ?)
        `, [league_name, last_name, first_name, email, description]);

        const newLeagueId = result.lastID;

        req.session.user.league_id = newLeagueId;
        req.session.save(() => {

            res.json({
                success: true,
                newLeagueId,
                coordinator: {
                    last_name: last_name,
                    first_name: first_name,
                    email: email,
                    description: description
                }
            });
        });


    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error creating league" });
    }
});

app.post("/admin/allocated-tee-times", requireLeagueAdmin, async (req, res) => {
  const leagueId = req.session.user.league_id;
  const { play_date, first_nine, tee_times } = req.body;

  if (!play_date || !first_nine || !Array.isArray(tee_times)) {
    return res.status(400).json({ error: "Missing play_date, first_nine, or tee_times array" });
  }

  try {
    // 1. Delete existing rows
    await dbRun(
      `DELETE FROM allocated_tee_times
      WHERE league_id = ? AND play_date = ?`,
      [leagueId, play_date]
    );

    // 2. Insert new rows (better-sqlite3 version)
    const stmt = db.prepare(`
      INSERT INTO allocated_tee_times (play_date, league_id, tee_time_number, tee_time, first_nine)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const [index, time] of tee_times.entries()) {
      stmt.run(play_date, leagueId, index + 1, time, first_nine);
    }

    // 3. Verify
    const check = await dbAll(`
      SELECT tee_time_number, tee_time, first_nine
      FROM allocated_tee_times
      WHERE league_id = ? AND play_date = ?
      ORDER BY tee_time_number ASC
    `, [leagueId, play_date]);

    console.log("DB rows AFTER SAVE:", check);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/leagues/api/:id", requireSuperAdmin, async (req, res) => {
    const leagueId = parseInt(req.params.id, 10);
    console.log("leagueId=", leagueId);
    try {
        const row = await dbGet(
            `SELECT EXISTS (
                         SELECT 1
                              FROM schedule
                                 JOIN users ON schedule.user_id = users.id
                           WHERE users.league_id = ?
               ) AS schedule_data_exists`,
            [leagueId]
        );
	console.log("row.schedule_data_exists=", row.schedule_data_exists);
	
        if (row.c > 0) {
            return res.status(400).json({
                error: "Cannot delete league with existing schedule data"
            });
        }

        await dbRun("DELETE FROM leagues WHERE id = ?", [leagueId]);

        if (req.session.user.league_id === leagueId) {
            delete req.session.user.league_id;
        }

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error deleting league" });
    }
});

// ------------------------------
// GOLFER APIs
// ------------------------------
// ------------------------------
// GET ALL GOLFERS FOR THIS LEAGUE
// ------------------------------
app.get("/admin/golfers/api", requireLeagueAdmin, async (req, res) => {
    const leagueId = req.session.user.league_id;

    console.log("📌 HIT /admin/golfers/api");
    console.log("📌 leagueId =", leagueId);

    try {
        const rows = await db.allAsync(
            `SELECT id, first_name, last_name, email, is_admin, is_member, subgroup, subgroup_number
             FROM users
             WHERE league_id = ?
             ORDER BY last_name, first_name`,
            [leagueId]
        );

        console.log("📌 DB rows returned:", rows);

        res.json(rows);
    } catch (err) {
        console.error("❌ Error loading users:", err);
        res.status(500).json({ error: "Failed to load users" });
    }
});

app.get("/admin/nines", requireAdminLoginOnly, async (req, res) => {
  const leagueId = req.session.user.league_id;

  try {
    const rows = await dbAll(
      `SELECT id, nine
       FROM nines
       WHERE league_id = ?
       ORDER BY nine ASC`,
      [leagueId]
    );

    res.json({ nines: rows });

  } catch (err) {
    console.error("Error fetching nines:", err);
    res.status(500).json({ error: "Failed to load nines" });
  }
});

app.post("/admin/golfers/api", requireLeagueAdmin, async (req, res) => {
    const leagueId = req.session.user.league_id;
    console.log("📌 HIT /admin/golfers/api");
    console.log("📌 leagueId =", leagueId)

    const {
        first_name, last_name, email, password,
        is_admin, is_member, subgroup, subgroup_number
    } = req.body;

    if (!first_name || !last_name || !email || !password) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    if (subgroup && !/^[A-Z]$/.test(subgroup)) {
        return res.status(400).json({ error: "Invalid subgroup" });
    }

    if (subgroup_number && !(Number(subgroup_number) >= 1 && Number(subgroup_number) <= 9)) {
        return res.status(400).json({ error: "Invalid subgroup number" });
    }

    try {
        const hashed = await bcrypt.hash(password, 10);

        // INSERT USER
        const result = await dbRun(`
            INSERT INTO users
            (first_name, last_name, email, password_hash, is_admin, is_member, subgroup, subgroup_number, league_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            first_name,
            last_name,
            email,
            hashed,
            is_admin ? 1 : 0,
            is_member ? 1 : 0,
            subgroup === "" ? "" : subgroup,
            subgroup_number === "" ? "" : Number(subgroup_number),
            leagueId
        ]);

        // ⭐ NEW: Get the new user's ID
        const newUser = await dbGet(`SELECT id FROM users WHERE email = ?`, [email]);
        const newUserId = newUser.id;

        // ⭐ NEW: Initialize all 12 months as in-town
        for (let m = 1; m <= 12; m++) {
            await dbRun(`
                INSERT INTO user_play_months (user_id, month, in_town)
                VALUES (?, ?, 1)
            `, [newUserId, m]);
        }
	// ⭐ NEW: Initialize weekly play days based on league defaults
        // Load league play days (0–6 where league plays)
        const leagueDays = await dbAll(
          `SELECT day_of_week
           FROM league_play_days
           WHERE league_id = ? AND is_play_day = 1`,
          [leagueId]
        );

        const leaguePlayDays = leagueDays.map(r => r.day_of_week);

        // Insert 7 rows (0–6) for the new user
        for (let dow = 0; dow <= 6; dow++) {
          await dbRun(
            `INSERT INTO user_play_days (user_id, day_of_week, is_play_day)
             VALUES (?, ?, ?)`,
            [newUserId, dow, leaguePlayDays.includes(dow) ? 1 : 0]
          );
        }

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error adding golfer" });
    }
});

// ------------------------------
// UPDATE GOLFER
// ------------------------------
app.put("/admin/golfers/api/:id", requireLeagueAdmin, async (req, res) => {
    const leagueId = req.session.user.league_id;
    const id = parseInt(req.params.id, 10);

    const {
        first_name, last_name, email,
        is_admin, is_member, subgroup, subgroup_number
    } = req.body;

    // Validate subgroup
    if (subgroup && !/^[A-Z]$/.test(subgroup)) {
        return res.status(400).json({ error: "Invalid subgroup" });
    }

    // Validate subgroup_number
    if (subgroup_number && !(Number(subgroup_number) >= 1 && Number(subgroup_number) <= 9)) {
        return res.status(400).json({ error: "Invalid subgroup number" });
    }

    try {
        const existing = await dbGet("SELECT league_id FROM users WHERE id = ?", [id]);
        if (!existing || existing.league_id !== leagueId) {
            return res.status(404).json({ error: "Golfer not found" });
        }

        await dbRun(`
            UPDATE users
            SET first_name = ?, last_name = ?, email = ?,
                is_admin = ?, is_member = ?, subgroup = ?, subgroup_number = ?
            WHERE id = ?
        `, [
            first_name, last_name, email,
            is_admin ? 1 : 0,
            is_member ? 1 : 0,
            subgroup === "" ? "" : subgroup,
            subgroup_number === "" ? "" : Number(subgroup_number),
            id
        ]);

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error updating golfer" });
    }
});


// ------------------------------
// DELETE GOLFER
// ------------------------------
app.delete("/admin/golfers/api/:id", requireLeagueAdmin, async (req, res) => {
    const leagueId = req.session.user.league_id;
    const id = parseInt(req.params.id, 10);

    try {
        const existing = await dbGet("SELECT league_id FROM users WHERE id = ?", [id]);
        if (!existing || existing.league_id !== leagueId) {
            return res.status(404).json({ error: "Golfer not found" });
        }

        await dbRun("DELETE FROM users WHERE id = ?", [id]);

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error deleting golfer" });
    }
});

app.delete("/admin/allocated-tee-times/date/:play_date", requireLeagueAdmin, async (req, res) => {
  const leagueId = req.session.user.league_id;
  const { play_date } = req.params;

  try {
    await dbRun(
      `DELETE FROM allocated_tee_times
       WHERE league_id = ? AND play_date = ?`,
      [leagueId, play_date]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/allocated-tee-times/:id", requireLeagueAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await dbRun(`DELETE FROM allocated_tee_times WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// RESET PASSWORD
// ------------------------------
app.put("/admin/golfers/api/:id/password", requireLeagueAdmin, async (req, res) => {
    const leagueId = req.session.user.league_id;
    const id = parseInt(req.params.id, 10);
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: "Password required" });
    }

    try {
        const existing = await dbGet("SELECT league_id FROM users WHERE id = ?", [id]);
        if (!existing || existing.league_id !== leagueId) {
            return res.status(404).json({ error: "Golfer not found" });
        }

        // ⭐ HASH THE PASSWORD
        const hashed = await bcrypt.hash(password, 10);

        await dbRun(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            [hashed, id]
        );

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error resetting password" });
    }
});

app.put("/admin/allocated-tee-times/:id", requireLeagueAdmin, async (req, res) => {
  const leagueId = req.session.user.league_id;
  const { id } = req.params;
  const { tee_time } = req.body;

  if (!tee_time) {
    return res.status(400).json({ error: "Missing tee_time" });
  }

  try {
    await dbRun(
      `UPDATE allocated_tee_times
       SET tee_time = ?
       WHERE id = ? AND league_id = ?`,
      [tee_time, id, leagueId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

//-----------------------------------------------
//-  /auth/login  POST
//-----------------------------------------------
app.post("/auth/login", async (req, res) => {
    console.log("➡️ ENTERED /auth/login ROUTE");
    console.log("➡️ BODY:", req.body);

    const { email, password } = req.body;

    console.log("USER LOGIN BODY:", req.body);

    try {
        const user = await db.getAsync(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (!user) {
            console.log("USER LOGIN FAILED — no such email");
            return res.redirect("/login.html?error=Invalid%20credentials&email=" + encodeURIComponent(email));
        }

        // Compare bcrypt hash
        const match = await bcrypt.compare(password, user.password_hash);

        if (!match) {
            console.log("USER LOGIN FAILED — bad password");
            return res.redirect("/login.html?error=Invalid%20credentials&email=" + encodeURIComponent(email));
        }

        // Store user session
        req.session.user = {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            is_admin: false,
            league_id: user.league_id
        };

        console.log("💾 SESSION AFTER SET:", req.session);

        return res.redirect("/schedule");

    } catch (err) {
        console.error("USER LOGIN ERROR:", err);
        return res.redirect("/login.html?error=Server%20error");
    }
});

app.get("/schedule", (req, res) => {
    console.log("📅 ENTERED /schedule ROUTE");
    console.log("📅 SESSION USER:", req.session.user);
    res.sendFile(path.join(__dirname, "public", "schedule.html"));
});

// ------------------------------
// LOGOUT
// ------------------------------
app.get("/admin-logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/admin-login");
    });
});

// -------------------------
//  Cron jobs
// -------------------------

const cron = require("node-cron");
const { optimizeDatabase, vacuumDatabase } = require("./db/maintenance");
const { generateTeeSheet } = require("./services/generateTeeSheet");

// TEMP: Run nightly generator immediately on server startup (for testing)
generateTeeSheet();  // comment out to stop running 8pm cron job to load tee sheet for 2 days hence

// Run ANALYZE + PRAGMA optimize at startup
(async () => {
  await optimizeDatabase();
})();

// Run VACUUM on the 1st of every month at 3:00 AM
cron.schedule("0 3 1 * *", async () => {
  await vacuumDatabase();
});

// Tee sheet generation (daily at 8 PM)
cron.schedule("0 20 * * *", async () => {
  console.log("⏰ not Running tee-sheet cron job (8 PM Eastern)...");
  // await generateTeeSheet();   // nightly job for all leagues
}, {
  timezone: "America/New_York"
});


// ------------------------------
// START SERVER
// ------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
