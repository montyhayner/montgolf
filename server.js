//server.js
console.log(">>> RUNNING SERVER.JS FROM:", __filename);

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
// delete require.cache[require.resolve("./db")];
console.log("REQUIRING DB FROM:", require.resolve("./db"));
const app = express();
const db = require("./db"); 
const { requireLogin } = require("./middleware/auth");
const bcrypt = require("bcrypt");
const { easternNow } = require("./utils/easternTime");
const latestApplyResultMap = {};
const { sendEmail } = require("./services/mailer");
const generateTwoWeekReportText = require("./services/generateTwoWeekReportText");
const { saveScheduleHandler } = require("./routes/user");

// ------------------------------
// Express Setup
// ------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});

app.use(session({
    secret: "your-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax"
    }
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
app.use(express.static(path.join(__dirname, "public"), {
    maxAge: 0,
    etag: false
}));

// ------------------------------
// Login page
// ------------------------------
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ------------------------------
// Routers
// ------------------------------

// AUTH
app.use("/auth", require("./routes/auth"));

// USER
app.use("/user", require("./routes/user"));

// SCHEDULE but for admin editing of another user's schedule
app.use("/schedule", require("./routes/schedule"));

// GUESTS API
const guestsRouter = require("./routes/guests");
app.use("/api/guests", requireLogin, guestsRouter);

// PARTIALS
app.use("/partials", express.static(__dirname + "/public/partials"));

// LEAGUE PLAY DAYS API
const leaguePlayDaysRouter = require("./routes/leaguePlayDays")(db);
app.use("/api/league-play-days", requireLogin, leaguePlayDaysRouter);

// REPORTS API
const reportsRoutes = require("./routes/reports");
app.use("/api/reports", reportsRoutes);

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
    console.log(">>> REQUIRE ADMIN CHECK:", req.session.user);

    const u = req.session.user;

    if (!u) {
        if (req.originalUrl.includes("/api")) {
            return res.status(401).json({ error: "Not logged in" });
        }
        return res.redirect("/admin-login");
    }

    const isSuper = u.is_super_admin === true || u.is_super_admin === 1;
    const isAdmin = u.is_admin === true || u.is_admin === 1;

    // ⭐ SUPER ADMINS ALWAYS PASS
    if (isSuper) return next();

    // ⭐ LEAGUE ADMINS ALWAYS PASS (league_id NOT required for API)
    if (isAdmin) return next();

    // ⭐ API REQUESTS GET JSON ERRORS
    if (req.originalUrl.includes("/api")) {
        return res.status(403).json({ error: "Admin only" });
    }

    // ⭐ NON-API REQUESTS GET REDIRECT
    return res.redirect("/auth/select-league");
}

function requireAdminLoginOnly(req, res, next) {
    console.log(">>> server.js line 152 REQUIRE ADMIN CHECK:", req.session.user);
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

app.get("/user-reports", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "user-reports.html"));
});

app.get("/reports", (req, res) => {
  res.redirect("/user-reports");
});

app.get("/my-availability", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "my-availability.html"));
});

app.get("/admin/allocated-tee-times", requireLeagueAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-allocated-tee-times.html"));
});

app.get("/dashboard", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "user-dashboard.html"));
});

app.get("/admin/reports", requireLeagueAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-reports.html"));
});
  
app.get("/user/reports", requireLeagueAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "user-reports.html"));
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

//--------------------------------------------------------------------
//  Helper function to send an email to superAdmins
// -------------------------------------------------------------------
async function emailToSuperAdmins(subject, emailText) {
  const superAdmins = db.prepare(`
    SELECT email FROM users WHERE is_super_admin = 1
  `).all();
  await sendEmail({
    to: superAdmins.map(a => a.email),
    subject: subject,
    text: emailText
  });
}

// -------------------------------------------------------------------------------------
// helper function to parse a date string in yyyy-mm-dd format into a Date object
// -------------------------------------------------------------------------------------
function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
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
async function autoPlaceGolfers(leagueId, teeDate, addedGolfers) {
  // 1. Load working tee sheet into rows array by ascending tee times.
  const rows = await dbAll(
    `SELECT *
       FROM tee_sheet_working
      WHERE league_id = ?
        AND tee_date = ?
      ORDER BY tee_time ASC, starting_nine`,
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

      const emptyIndex = slots.findIndex(s => !Number.isInteger(s));

      if (emptyIndex !== -1) {           //an empty slot was found
        const slotNum = emptyIndex + 1;  //emptyIndex starts w 0, so we add 1 for slotNum
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
// get the unplaced golfers and return it to the frontend
// 1. Get the unplaced golfers for the upcoming play_date and for the league by
// getting all players playing today based on schedule but do not exist
// on the tee_sheet table for today.
  
app.get("/admin/api/tee-sheet/:leagueId/:teeDate/unplaced", requireTeeSheetEditor,
  async (req, res) => {
    const { leagueId, teeDate } = req.params;
    console.log("=== /UNPLACED ROUTE START ===");
    console.log("leagueId:", leagueId, "teeDate:", teeDate);

    try {
      // 1. Load all golfers scheduled for this date and current league
      //    into a js array:  schedule[]
      const scheduled = await dbAll(
        `SELECT DISTINCT id, first_name, last_name
           FROM schedule
              , users
          WHERE schedule.date = ?
            AND is_playing = 1
            AND users.id = schedule.user_id
            AND users.league_id = ?`,
        [teeDate, leagueId]
      );
      // 1. Log scheduled golfers
      console.log("Scheduled golfers:");
      console.log(JSON.stringify(scheduled, null, 2));

      // 2. Load tee sheet working rows
      const rows = await dbAll(
        `SELECT *
           FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?`,
        [leagueId, teeDate]
      );

      console.log("tee_sheet_working rows (full dump):");
      console.log(JSON.stringify(rows, null, 2));

      // 3. Build a set of placed user_ids
      const placedIds = new Set();
        for (const row of rows) {
          [row.user_id1, row.user_id2, row.user_id3, row.user_id4]
            .filter(s => Number.isInteger(s))
            .forEach(id => placedIds.add(id));
        }

      rows.forEach((row, idx) => {
        console.log(`Row ${idx} tee_time=${row.tee_time} starting_nine=${row.starting_nine}`);
        console.log("  Slots:", {
          user_id1: row.user_id1,
          user_id2: row.user_id2,
          user_id3: row.user_id3,
          user_id4: row.user_id4
        });
      });

      // 4. Find unplaced golfers
      const unplaced = scheduled.filter(g => !placedIds.has(g.id));

      console.log("Placed IDs (raw):", Array.from(placedIds));
      console.log("Unplaced golfers (computed):");
      console.log(JSON.stringify(unplaced, null, 2));

      for (const unplacedRow of unplaced) {

        await dbRun(
          `UPDATE schedule_history
              SET is_unplaced = 1
            WHERE play_date = ?
              AND league_id = ?
              AND user_id = ?
              AND changed_at = (
                  SELECT MAX(changed_at)
                    FROM schedule_history
                  WHERE play_date = ?
                    AND league_id = ?
                    AND user_id = ?
              )`,
          [
            teeDate,
            leagueId,
            unplacedRow.id,
            teeDate,
            leagueId,
            unplacedRow.id
          ]
        );
        console.log("in /unplaced route - set is_unplaced = 1  teeDate=", teeDate,
            " leagueId=", leagueId, "unplacedRow.id=", unplacedRow.id);
      }

      console.log("=== UNPLACED ROUTE END ===");
      res.json({ unplaced });

    } catch (err) {
      console.error("Error in GET of /unplaced route - loading unplaced golfers:", err);
      res.status(500).json({ error: "Server error loading unplaced golfers." });
    }
  }
);

// ------------------------------
// SUPER ADMIN LEAGUE SELECTION
// ------------------------------
app.get("/auth/select-league", requireAdminLoginOnly, async (req, res) => {
    const user = req.session.user;

    console.log("→ HANDLER: GET /auth/select-league");
    console.log("  session.user =", req.session.user);

    // If league already selected → skip this page entirely
    if (user.league_id) {
        return res.redirect("/admin-dashboard");
    }

    // ---------------------------------------------------------
    // SUPER ADMIN → always show select-league page
    // ---------------------------------------------------------
    if (user.is_super_admin) {
        return res.sendFile(path.join(__dirname, "public", "select-league.html"));
    }

    // ---------------------------------------------------------
    // LEAGUE ADMIN → find leagues they belong to
    // ---------------------------------------------------------
    const leagues = await db.allAsync(
        `SELECT l.*
           FROM leagues l
           JOIN users u ON u.league_id = l.id
          WHERE u.is_admin = 1
            AND u.id = ?`,
        [user.id]
    );

    // ---------------------------------------------------------
    // LEAGUE ADMIN WITH EXACTLY ONE LEAGUE → auto-select it
    // ---------------------------------------------------------
    if (leagues.length === 1) {
        req.session.user.league_id = leagues[0].id;

        return req.session.save(() => {
            res.redirect("/admin-dashboard");
        });
    }

    // ---------------------------------------------------------
    // LEAGUE ADMIN WITH MULTIPLE LEAGUES → show selection page
    // ---------------------------------------------------------
    return res.sendFile(path.join(__dirname, "public", "select-league.html"));
});


app.get("/auth/leagues", requireSuperAdmin, async (req, res) => {
    console.log("→ HANDLER: GET /auth/app.get(/auth/leagues");
    console.log("  session.user =", req.session.user);
    try {
        const rows = await dbAll(`SELECT id
                                       , league_name 
                                    FROM leagues 
                                ORDER BY league_name`);
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

// -------------------------------------------------------------------------------------------
// get golfers who have dropped out of golfing on the upcoming tee date and get golfers
// who decided at the last minute (so to speak) to play on the upcoming tee date.
// We return an 'removed' array and a 'added" array back to the frontend.
// -------------------------------------------------------------------------------------------
app.get("/admin/api/tee-sheet/:leagueId/:teeDate/changes",
  requireTeeSheetEditor,
  async (req, res) => {
    try {
      const { leagueId, teeDate } = req.params;
      console.log("GET /admin/api/tee-sheet/:leagueId/:teeDate/changes - route start -", 
      " leagueId=", leagueId, " teeDate=", teeDate);
      
      // -----------------------------------------------------------------------
      // 1. Find users who are scheduled to play on the current play date but are
      //    not found on tee_sheet_working (each such golfer needs to be added
      //    to the current tee_sheet_working table)  
      //    Any such players are to be put in the "added" array to be passed back
      //     to the frontend.
      // -----------------------------------------------------------------------
      const missingRows = await dbAll(
        `SELECT missing.userId
              , missing.firstName
              , missing.lastName
              , missing.updatedAt
           FROM (SELECT LFT.user_id as userId
                      , LFT.first_name AS firstName
                      , LFT.last_name as lastName
                      , LFT.updated_at AS updatedAt
                      , RGHT.user_id
                      , RGHT.first_name
                      , RGHT.last_name
                   FROM (SELECT user_id
                              , first_name
                              , last_name
                              , updated_at
		                       FROM (SELECT users.id AS user_id
                                      , first_name
                                      , last_name
                                      , updated_at
                                   FROM schedule
                                      , users
                                  WHERE schedule.date = ?
                                    AND is_playing = 1
                                    AND users.id = schedule.user_id
                                    AND users.league_id = ?
                         UNION
                        SELECT DISTINCT guests.id as user_id
                             , guest_first_name as first_name
                             , guest_last_name as last_name
                             , updated_at
                          FROM guests
                             , users
                         WHERE guests.sponsor_user_id = users.id
                           AND users.league_id = ?
                           AND ? in 
                               (guests.date1, guests.date2, guests.date3,
                                guests.date4, guests.date5))) AS LFT
								 
                LEFT JOIN

                (SELECT user_id
                      , first_name
                      , last_name			
                   FROM (SELECT user_id1 as user_id
                              , first_name1 as first_name
                              , last_name1 as last_name
                           FROM tee_sheet_working
                          WHERE league_id = ?
                            AND tee_date = ?
                            AND user_id1 <> ''
                 UNION
                SELECT user_id2 as user_id
                     , first_name2 as first_name
                     , last_name2 as last_name
                  FROM tee_sheet_working
                 WHERE league_id = ?
                   AND tee_date = ?
                   AND user_id2 <> ''
                 UNION
                SELECT user_id3 as user_id
                     , first_name3 as first_name
                     , last_name3 as last_name
                  FROM tee_sheet_working
                 WHERE league_id = ?
                   AND tee_date = ?
                   AND user_id3 <> ''
                 UNION
                SELECT user_id4 as user_id
                     , first_name4 as first_name
                     , last_name4 as last_name
                  FROM tee_sheet_working
                 WHERE league_id = ?
                   AND tee_date = ?
                   AND user_id4 <> '')) AS RGHT
  
  		              ON RGHT.user_id = LFT.user_id
	               WHERE RGHT.user_id is NULL) AS missing 
              ORDER BY updatedAT ASC`,
        [teeDate, leagueId, leagueId, teeDate, leagueId, teeDate,
         leagueId, teeDate, leagueId, teeDate, leagueId, teeDate]
      );

      const added = [];
      const removed = [];
      if (missingRows.length > 0) {
        for (const row of missingRows) {
          // ADD: was not playing → now playing
            added.push({
              user_id: row.userId,
              first_name: row.firstName,
              last_name: row.lastName,
              requested_at: row.updatedAt
            });
        }
      }

      console.log("/CHANGES route - added=", added);

      // ---------------------------------------------------------------------------
      // 2. Find users who are on tee_sheet_working table to golf on current play
      //    date but are not scheduled to play on the current play date.  Any such
      //    players are to be put in the "removed" array to be passed back to the
      //    frontend.
      // ----------------------------------------------------------------------------
  const extraRows = await dbAll(
  `SELECT extra.userId
        , extra.firstName
        , extra.lastName
        , extra.editedAt
     FROM (SELECT LFT.user_id AS userId
                , LFT.first_name AS firstName
                , LFT.last_name AS lastName
                , LFT.edited_at AS editedAt
                , RGHT.user_id
                , RGHT.first_name
                , RGHT.last_name
             FROM (SELECT user_id
                        , first_name
                        , last_name
                        , edited_at			
                     FROM (SELECT user_id1 as user_id
                                , first_name1 as first_name
                                , last_name1 as last_name
                                , edited_at
                             FROM tee_sheet_working
                            WHERE league_id = ?
                              AND tee_date = ?
                              AND user_id1 <> ''
                          UNION
                          SELECT user_id2 as user_id
                              , first_name2 as first_name
                              , last_name2 as last_name
                              , edited_at
                            FROM tee_sheet_working
                          WHERE league_id = ?
                            AND tee_date = ?
                            AND user_id2 <> ''
                          UNION
                          SELECT user_id3 as user_id
                              , first_name3 as first_name
                              , last_name3 as last_name
                              , edited_at
                            FROM tee_sheet_working
                          WHERE league_id = ?
                            AND tee_date = ?
                            AND user_id3 <> ''
                          UNION
                          SELECT user_id4 as user_id
                              , first_name4 as first_name
                              , last_name4 as last_name
                              , edited_at
                            FROM tee_sheet_working
                          WHERE league_id = ?
                            AND tee_date = ?
                            AND user_id4 <> '')) AS LFT
  
                    LEFT JOIN
  

                   (SELECT user_id
                         , first_name
                         , last_name
		                  FROM (SELECT users.id AS user_id
                                 , first_name
                                 , last_name
                              FROM schedule
                                 , users
                             WHERE schedule.date = ?
                               AND is_playing = 1
                               AND users.id = schedule.user_id
                               AND users.league_id = ?
                            UNION
                           SELECT DISTINCT guests.id as user_id
                                , guest_first_name as first_name
                                , guest_last_name as last_name
                             FROM guests
                                , users
                            WHERE guests.sponsor_user_id = users.id
                              AND users.league_id = ?
                              AND ? in 
                                  (guests.date1, guests.date2, guests.date3,
                                   guests.date4, guests.date5))) AS RGHT
  
  		                 ON RGHT.user_id = LFT.user_id
	                  WHERE RGHT.user_id is NULL) AS extra 
            ORDER BY editedAt ASC`,
        [leagueId, teeDate, leagueId, teeDate, leagueId, teeDate,
         leagueId, teeDate, teeDate, leagueId, leagueId, teeDate]
      );

      if (extraRows.length > 0) {
        for (const row of extraRows) {
            removed.push({
              user_id: row.userId,
              first_name: row.firstName,
              last_name: row.lastName,
              requested_at: row.editedAt
            });
        }
      }

      console.log("/CHANGES route - removed=", removed);

      res.json({
        added,
        removed
      });

    } catch (err) {
      console.error("Error in tee-sheet /changes route:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

function deleteFirstDupUserSlot(leagueId, teeDate, dupUserId) {
  try {
    const dupFoundRow = dbGet(
      `SELECT tee_time
            , user_id1
            , last_name1
            , first_name1
            , user_id2
            , last_name2
            , first_name2
            , user_id3
            , last_name3
            , first_name3
            , user_id4
            , last_name4
            , first_name4
        FROM tee_sheet_working
        WHERE league_id = ?
          AND tee_date = ?
          AND ? in (user_id1, user_id2, user_id3, user_id4)
        LIMIT 1`,
      [leagueId, teeDate, dupUserId]
    );
    const teeTime = dupFoundRow.tee_time;
    let userId1 = dupFoundRow.user_id1;
    let lastName1 = dupFoundRow.last_name1;
    let firstName1 = dupFoundRow.first_name1;
    let userId2 = dupFoundRow.user_id2;
    let lastName2 = dupFoundRow.last_name2;
    let firstName2 = dupFoundRow.first_name2;
    let userId3 = dupFoundRow.user_id3;
    let lastName3 = dupFoundRow.last_name3;
    let firstName3 = dupFoundRow.first_name3;
    let userId4 = dupFoundRow.user_id4;
    let lastName4 = dupFoundRow.last_name4;
    let firstName4 = dupFoundRow.first_name4;
    let slotNum;
    if (userId1 = dupUserId) {
      userId1 = '';lastName1 = ''; firstName1 = ''; slotNum = 1}
    else if (userId2 = dupUserId) {
      userId2 = '';lastName2 = ''; firstName2 = ''; slotNum = 2}
    else if (userId3 = dupUserId) {
      userId3 = '';lastName3 = ''; firstName3 = ''; slotNum = 3}
    else if (userId4 = dupUserId) {
      userId4 = '';lastName4 = ''; firstName4 = ''; slotNum = 41}
    
    const dupGone = dbGet(
      `UPDATE tee_sheet_working
          SET user_id1 = ?
            , last_name1 = ?
            , first_name1 = ?
            , user_id2 = ?
            , last_name2 = ?
            , first_name2 = ?
            , user_id3 = ?
            , last_name3 = ?
            , first_name3 = ?
            , user_id4 = ?
            , last_name4 = ?
            , first_name4 = ?
        WHERE league_id = ?
          AND tee_date = ?
          AND tee_time = ?`,
      [userId1, lastName1, firstName1,
        userId2, lastName2, firstName2,
        userId3, lastName3, firstName3,
        userId4, lastName4, firstName4,
        leagueId, teeDate, teeTime]
    );

    if (dupGone.length === 0) {
      console.log("failed to remove user with id: ", dupUserId,
                  " from tee_sheet_working with tee Date=", teeDate, " tee time=",
                  teeTime, "and slot=", slotNum, ". Rows updated =", dupGone.length); 

    } else {
      console.log("removed user with id: ", dupUserId, " from tee_sheet_working",
                  " tee Date=", teeDate, " tee time=", teeTime,
                  "and slot=", slotNum);
    }
    return
  } catch (err) {
    console.error("deleteFirstDupUserSlot() function error:", err);
    res.status(500).send("Server error");
    return
  }
}

function getNextTeeTime(teeTime, teeTimeInterval) {
  // Split "hh:mm"
  const [hh, mm] = teeTime.split(":").map(Number);

  // Create a Date object for today with that time
  const d = new Date();
  d.setHours(hh);
  d.setMinutes(mm);
  d.setSeconds(0);
  d.setMilliseconds(0);

  // Add interval
  d.setMinutes(d.getMinutes() + teeTimeInterval);

  // Format back to hh:mm (12‑hour)
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");

  // Convert 24‑hour → 12‑hour
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;

  return `${hours}:${minutes}`;
}
//--------------------------------------------------------------------------------
// The validate2 route elimnates duplicate users from tee_sheet_working.
//--------------------------------------------------------------------------------
app.get("/admin/api/tee-sheet/:leagueId/:teeDate/validate2", requireTeeSheetEditor,
         async (req, res) => {
  const { leagueId, teeDate } = req.params;

  console.log("get /admin/api/tee-sheet/:leagueid/:teeDate/validate2 - ",
              "TEE SHEET ROUTE SESSION:", req.session);
  try {
    // 1. first we find any user id on tee_sheet_working that occurs in more than
    //    one slot. If any such user_id is found, remove from the first slot in which
    //    it is found.   
    const duplicateRows = await dbAll(
      `SELECT A.user_id
            , count(*) as slots_count
         FROM (SELECT user_id1 AS user_id
                 FROM tee_sheet_working 
                WHERE league_id = ?
                  AND tee_date = ?
                  AND user_id1 <> ''
                UNION ALL
                SELECT user_id2 AS user_id
                  FROM tee_sheet_working
                  WHERE league_id = ?
                  AND tee_date = ?
                  AND user_id2 <> '' 
                UNION ALL
                SELECT user_id3 AS user_id
                  FROM tee_sheet_working
                 WHERE league_id = ?
                   AND tee_date = ?
                   AND user_id3 <> ''
                 UNION ALL
                SELECT user_id4 AS user_id
                  FROM tee_sheet_working
                 WHERE league_id = ?
                   AND tee_date = ?
                   AND user_id4 <> '') AS A
        GROUP BY user_id
       HAVING count(*) > 1`,
       [leagueId, teeDate, leagueId, teeDate,
        leagueId, teeDate, leagueId, teeDate]
    );
    console.log("/Validate2 route - duplicate user(s) found on tee_sheet_working is ",
                duplicateRows.length, "for date:", teeDate, " and league:", leagueId);

    if (duplicateRows.length > 0) {
       console.log("/Validate2 route - duplicate user(s) found on tee_sheet_working: ",
                duplicateRows.length);
       // For each duplicate user found on tee_sheet_working table, we delete the
       // first slot found containing the user_id.
       let dupUserId;    
       let dupCount;
       duplicateRows.forEach(d => {
          dupUserId = d.user_id;
          dupCount = slots_count - 1;
          for (var i=1; i <= dupCount; i++) {
            deleteFirstDupUserSlot(leagueId, teeDate, dupUserId);
          }
       });
    }

    const workingRows = await dbAll(
      `SELECT *
         FROM tee_sheet_working
        WHERE league_id = ?
          AND tee_date = ?
        ORDER BY tee_time ASC`,
      [leagueId, teeDate]
    );

    if (workingRows.length === 0) {
        return res.status(404).send("No rows found", 
               " on tee_sheet_working table for current league and date: ", teeDate,
               ".  Click back button.  Contact League Coordinator."
        );
    }

    res.json(workingRows);

  } catch (err) {
    console.error("Load tee sheet error:", err);
    res.status(500).send("Server error");
  }
});

// --------------------------------------------------------------------------------
// make sure tee_sheet_working table is populated.  
// Throw error if there are no rows on tee_sheet_working nor on tee_sheet for the
// tee date.  If rows exist, check to see if the same number of rows exist on the
// allocated_tee_times table.
// If no rows exist on allocated_tee_times table, throw an error.
// If there are more rows on allocated_tee_times than on tee_sheet_working, add
// row(s) to tee_sheet_working.
// If there are fewer rows on allocated_tee_times than on tee_sheet_working, remove
// row(s) from tee_sheet_working.
// if there are no rows on tee_sheet_working and there are rows on tee_sheet table
// for the tee date, copy tee_sheet rows to tee_sheet_working table.
// Finally, after all changes to working_tee_sheet are done, select all rows from
// the tee_sheet_working table into an array and return the array to the frontend.
//---------------------------------------------------------------------------------
app.get("/admin/api/tee-sheet/:leagueId/:teeDate/validate1", requireTeeSheetEditor,
        async (req, res) => {
  const { leagueId, teeDate } = req.params;
  const userEmail =  req.session.user.email;

  console.log("get /admin/api/tee-sheet/:leagueid/:teeDate - req.session.user.email=",
              req.session.user.email);
  console.log("get /admin/api/tee-sheet/:leagueid/:teeDate - TEE SHEET ROUTE SESSION:",
              req.session);

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

    console.log("tee_sheet_working row count = ", workingRows.length);

    if (workingRows.length > 0)
    {
      const allocatedRows = await dbAll(
        `SELECT tee_time_number, tee_time, tee_interval_minutes, league_name
            FROM allocated_tee_times
              , leagues
          WHERE play_date = ?
            AND league_id = ?
            AND leagues.id = ?
          ORDER BY tee_time_number ASC`,
        [teeDate, leagueId, leagueId]
        ); 

        // b. no allocated_tee_times rows exist, send error.
        if (allocatedRows.length === 0) {
          return res.status(404).send("No allocated tee times for league on: ", teeDate,
                  ".  Click back button.  Then click on 'Allocate Tee Times' link (or",
                  " button, if available) and enter tee times for", teeDate, "."
          );
        }
        
        // c. if there are more rows allocated then there are rows in tee_sheet_working,
        //    then add a row to tee_sheet_working with all empty slots for each added row
        if (allocatedRows.length > workingRows.length) {
          const allocatedRowCount = allocatedRows.length;
          const workingRowCount = workingRows.length;
          const missingRows = allocatedRowCount - workingRowCount;

          const teeIntervalMinutes = allocatedRows[0].tee_interval_minutes;

          const lastTeeTime = workingRows[workingRowCount - 1].tee_time;
          let newTeeTime = getNextTeeTime(lastTeeTime, teeIntervalMinutes);

          const startingNine = workingRows[0].starting_nine;
          const leagueName = workingRows[0].league_name;

          console.log("More allocated tee times:", allocatedRows.length,
                      " than rows on the tee_sheet_working table ", workingRows.length,
                      " Adding ", missingRows, " to tee_sheet_working.")
            
          const insertTSWorking = `
            INSERT INTO tee_sheet_working (
              tee_date, tee_time, starting_nine, league_id, league_name,
              user_id1, last_name1, first_name1,
              user_id2, last_name2, first_name2,
              user_id3, last_name3, first_name3,
              user_id4, last_name4, first_name4,
              edited_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          for (var i=workingRowCount; i < allocatedRowCount; i++) {
            // Insert row into tee_sheet_working table
            await dbRun(insertTSWorking, [
              teeDate,
              newTeeTime,
              startingNine,
              leagueId,
              leagueName,
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              userEmail
            ]);
            newTeeTime = getNextTeeTime(newTeeTime, teeIntervalMinutes);
          }
        } else 
          if (allocatedRows.length < workingRows.length) {
          // d. there are fewer allocated tee times than there are rows of the 
          //    tee_sheet_working table, so we must delete extra rows from
          //    tee_sheet_working.
          let extraRows = workingRows.length - allocatedRows.length; 
          while (extraRows > 0) {
            await dbRun(
              `DELETE FROM tee_sheet_working
                WHERE league_id = ?
                  AND tee_date = ?
                  AND tee_time = 
                      (SELECT max(tee_time)
                        FROM tee_sheet_working
                        WHERE league_id = ?
                        AND tee_date = ?)`,
              [leagueId, teeDate, leagueId, teeDate]
            );
            extraRows = extraRows - 1;        
          }
        } else if (allocatedRows.length === workingRows.length) {
            // e. number of allocated_tee_time rows = number of tee_sheet_working rows
            //    so we can return the results of the workingRows select at the
            //    top of route.
            return res.json(workingRows);
        }
    } else {
      // 2. No rows found on tee_sheet_working.  
      //    So we copy data from tee_sheet table to the tee_sheet_working table.
      const liveRows = await dbAll(
        `SELECT *
          FROM tee_sheet
          WHERE league_id = ?
            AND tee_date = ?
          ORDER BY tee_time ASC`,
        [leagueId, teeDate]
      );

      if (liveRows.length === 0) {
        return res.status(404).send("No tee sheet exists for league on: ", teeDate,
        ".  Click back button.  Wait for the tee date's deadline ",
        " (typically 8pm two days prior to actual tee date).  Check with League ",
        " Coordinator for actual date and time that the tee sheet will be available.");
      }
      
      // Insert into working table
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
    console.log("admin/tee-sheet get route - SESSION:", req.session);

    const leagueId = req.session.user?.league_id;

    if (!leagueId) {
        return res.status(400).send("No league selected. Please log in again.");
    }

    try {
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

        return res.redirect(
            `/admin/tee-sheet/${leagueId}/${maxDate}?leagueId=${leagueId}&teeDate=${maxDate}`
        );

    } catch (err) {
        console.error("Error loading tee sheet:", err);
        res.status(500).send("Server error");
    }
});

// =====================================================
// ADMIN OVERRIDE: INITIAL MONTH LOAD (SQLite)
// =====================================================
app.get("/admin/schedule/init/:targetUserId/:month", (req, res) => {
  console.log("🔥 ADMIN INIT ROUTE HIT");
  console.log("🔥 SESSION =", req.session);

  try {
    const adminUserId = req.session.user?.id;
    const targetUserId = req.params.targetUserId;
    const month = req.params.month;
    const easternTS = easternNow();
    console.log("🔥 adminUserId =", adminUserId);
    console.log("🔥 targetUserId =", targetUserId);
    console.log("🔥 month =", month);

    // --- Verify admin privileges ---
    const adminRow = db.prepare(
      "SELECT id, is_admin FROM users WHERE id = ?"
    ).get(adminUserId);

    console.log("🔥 adminRow =", adminRow);

    if (!adminRow) {
      console.log("🔥 403 — adminRow is null");
      return res.status(403).json({ error: "Admin not found." });
    }

    if (adminRow.is_admin !== 1) {
      console.log("🔥 403 — adminRow.is_admin !== 1");
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Verify target user exists ---
    const userRow = db.prepare(
      `SELECT users.id, first_name, last_name, in_town, league_id
       FROM  users 
          ,  user_play_months
       WHERE users.id = user_play_months.user_id
       AND   user_play_months.month = ?
       AND   users.id = ?`
    ).get(month, targetUserId);

    console.log("🔥 GET /admin/schedule/init/:targetUserId/:month userRow =", userRow);

    if (!userRow) {
      console.log("🔥 GET /admin/schedule/init/:targetUserId/:month - 404 — target user not found");
      return res.status(404).json({ error: "Target user not found." });
    }

    // --- Load league play days (CRITICAL FIX) ---
    const leaguePlayDays = db.prepare(
      `SELECT day_of_week
         FROM league_play_days
        WHERE league_id = ?
          AND is_play_day = 1`
    ).all(userRow.league_id).map(r => r.day_of_week);

    console.log("🔥 GET /admin/schedule/init/:targetUserId/:month - leaguePlayDays =", leaguePlayDays);

    // --- Determine current year/month ---
    const now = new Date();
    const year = now.getFullYear();

    console.log("🔥 GET /admin/schedule/init/:targetUserId/:month -year =", year, "month =", month);

    // --- Load current month's schedule for the target user ---
    const rows = db.prepare(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND strftime('%Y', date) = ?
         AND strftime('%m', date) = ?
       ORDER BY date`
    ).all(targetUserId, String(year), String(month).padStart(2, "0"));

    console.log("🔥 GET /admin/schedule/init/:targetUserId/:month -rows =", rows);

    const scheduleObj = {};
    rows.forEach(r => {
      scheduleObj[r.date] = r.is_playing === 1;
    });

    console.log("🔥 GET /admin/schedule/init/:targetUserId/:month - SUCCESS — returning JSON");

    return res.json({
      status: "ok",
      user: userRow,
      year,
      month,
      schedule: scheduleObj,
      leaguePlayDays,        // ⭐ CRITICAL FIX
      origInTown: userRow.in_town,
      easternTS: easternTS
    });

  } catch (err) {
    console.error("🔥 GET /admin/schedule/init/:targetUserId/:month - ADMIN INIT ERROR:", err);
    return res.status(500).json({ error: "Server error loading initial schedule." });
  }
});

// =====================================================
// ADMIN OVERRIDE: LOAD TARGET USER SCHEDULE (SQLite)
// =====================================================
app.get("/admin/schedule/:targetUserId/:year/:month", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    console.log("ADMIN ROUTE - /admin/schedule/:targetUserId/:year/:month — adminUserId =", adminUserId);

    const { targetUserId, year, month } = req.params;

    // --- Validate input ---
    if (!targetUserId || !year || !month) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // --- Verify admin privileges ---
    const adminRow = db.prepare(
      "SELECT id, is_admin FROM users WHERE id = ?"
    ).get(adminUserId);

    console.log("🔥 /admin/schedule/:targetUserId/:year/:month - adminRow =", adminRow);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Verify target user exists ---
    const userRow = db.prepare(
      `SELECT users.id, first_name, last_name, in_town, league_id
       FROM  users
          ,  user_play_months
       WHERE user_play_months.user_id = users.id
       AND   users.id = ?`
    ).get(targetUserId);

    console.log("🔥 userRow =", userRow);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }
    // --- Load league play days (CRITICAL FIX) ---
    const leaguePlayDays = db.prepare(
      `SELECT day_of_week
       FROM league_play_days
       WHERE league_id = ?
         AND is_play_day = 1`
    ).all(userRow.league_id).map(r => r.day_of_week);

    console.log("🔥 /admin/schedule/:targetUserId/:year/:month - leaguePlayDays =", leaguePlayDays);

    // --- Load schedule for the month ---
    const rows = db.prepare(
      `SELECT date, is_playing
       FROM schedule
       WHERE user_id = ?
         AND strftime('%Y', date) = ?
         AND strftime('%m', date) = ?
       ORDER BY date`
    ).all(targetUserId, String(year), String(month).padStart(2, "0"));

    console.log("🔥 rows =", rows);

    const scheduleObj = {};
    rows.forEach(r => {
      scheduleObj[r.date] = r.is_playing === 1;
    });

    // --- Return everything schedule.html needs ---
    return res.json({
      status: "ok",
      user: {
        id: userRow.id,
        first_name: userRow.first_name,
        last_name: userRow.last_name,
        in_town: userRow.in_town
      },
      schedule: scheduleObj,
      leaguePlayDays        // ⭐ CRITICAL FIX
    });

  } catch (err) {
    console.error("Admin override GET error:", err);
    return res.status(500).json({ error: "Server error loading schedule." });
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
async function applyDropsInternal(leagueId, teeDate, removedUserIds) {
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
          AND (  CAST(user_id1 AS INTEGER) = CAST(? AS INTEGER)
              OR CAST(user_id2 AS INTEGER) = CAST(? AS INTEGER)
              OR CAST(user_id3 AS INTEGER) = CAST(? AS INTEGER)
              OR CAST(user_id4 AS INTEGER) = CAST(? AS INTEGER)
          )
        ORDER BY TEE_TIME ASC`,
      [leagueId, teeDate, uid, uid, uid, uid]
    );

    if (!row) {
      console.log(`🔥applyDropsInternal: user ${uid} not found on tee sheet`);
      continue;
    }

    // 2. Determine which slot they occupy
    let slot = null;
    if (Number(row.user_id1) === uid) slot = 1;
    else if (Number(row.user_id2) === uid) slot = 2;
    else if (Number(row.user_id3) === uid) slot = 3;
    else if (Number(row.user_id4) === uid) slot = 4;

    if (!slot) {
      console.log(`🔥applyDropsInternal: user ${uid} found but slot unknown`);
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

    console.log(`applyDropsInternal: cleared slot ${slot} for user ${uid} and 
                tee time ${row.tee_time}`);
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
app.post("/admin/api/tee-sheet/:leagueId/:teeDate/apply-changes",requireTeeSheetEditor,
  async (req, res) => {
    const { leagueId, teeDate } = req.params;
    const { removed, added } = req.body;
    const adminEmail = req.session.user.email;
    const ts = easternNow();

    if (!Array.isArray(removed) || !Array.isArray(added)) {
      return res.status(400).json({
        error: "/Apply-Changes error: request body missing valid added and removed arrays."
      });
    }

    // the 4 variables in both removed and added are:
    // user_id  first_name  last_name  reqeusted_at

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
        await applyDropsInternal(leagueId, teeDate, removed);
      }

      // ---------------------------------------------------------
      // 2. APPLY ADDS (SORTED BY requested_at)
      // ---------------------------------------------------------
      let placed = [];
      let unplaced = [];

      if (added.length > 0) {

        //console.log("Applying ADDS chronologically...");
        // Sort by requested_at ascending
        // const sortedAdds = [...added].sort(
        //   (a, b) => new Date(a.requested_at) - new Date(b.requested_at)
        // );

        const placementResult = await autoPlaceGolfers(
          leagueId,
          teeDate,
          added
        );

        placed = placementResult.placed;
        unplaced = placementResult.unplaced;
      }

      // ---------------------------------------------------------
      // 3. UPDATE edited_at / edited_by ONCE
      // ---------------------------------------------------------
      await dbRun(
        `UPDATE tee_sheet_working
            SET edited_at = ?
              , edited_by = ?
          WHERE league_id = ? 
            AND tee_date = ?`,
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
// SEND NOTIFICATIONS — one email per recipient (Mailgun‑compatible)
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

      if (recipientGroups.teeSheetPlayers) {
        for (const row of teeRows) {
          [row.email1, row.email2, row.email3, row.email4].forEach(email => {
            if (email) recipients.add(email);
          });
        }
      }

      if (recipientGroups.unplacedGolfers) {
        unplaced.forEach(g => {
          if (g.email) recipients.add(g.email);
        });
      }

      if (recipientGroups.leagueAdmins) {
        const admins = await dbAll(
          `SELECT email FROM users WHERE league_id = ? AND is_admin = 1`,
          [leagueId]
        );
        admins.forEach(a => {
          if (a.email) recipients.add(a.email);
        });
      }

      if (recipientGroups.clubStaff) {
        const staff = await dbAll(
          `SELECT email FROM club_staff WHERE league_id = ? AND is_active = 1`,
          [leagueId]
        );
        staff.forEach(s => {
          if (s.email) recipients.add(s.email);
        });
      }

      // Always include admin
      recipients.add(adminEmail);

      const recipientList = Array.from(recipients).filter(Boolean);

      // ---------------------------------------------------------
      // 4. Build email HTML body
      // ---------------------------------------------------------
      let html = "";

      if (message && message.trim()) {
        html += `<p>${message}</p>`;
      }

      if (includeTeeSheet) {
        const dateObj = parseLocalDate(teeDate);
        let longDateStr = 
          `${dateObj.toLocaleDateString("en-US", { weekday: "long" })}, ` +
          dateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        
        html += `
          <div style="text-align:center; margin-bottom:10px;">
            <div style="font-size:24px; font-weight:bold; color:#333;">
              Tee Sheet for ${longDateStr}
            </div>
          </div>
        `;
        html += `
          <table style="border-collapse:collapse; margin:auto; border:1px solid #000;">
            <tr style="background:#e6ffe6;">
              <th style="padding:6px; border:1px solid #000;">Tee Time</th>
              <th style="padding:6px; border:1px solid #000;">Nine</th>
              <th style="padding:6px; border:1px solid #000;">Players</th>
            </tr>
        `;

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
              <td style="padding:6px; border:1px solid #000;">${row.tee_time}</td>
              <td style="padding:6px; border:1px solid #000;">${row.starting_nine}</td>
              <td style="padding:6px; border:1px solid #000;">${players}</td>
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
      // 5. Send ONE email per recipient (Mailgun‑compatible)
      // ---------------------------------------------------------
      const subject = `Tee Sheet – ${teeDate}`;
      let verticalRecipientList = "" + recipientList.join("\n") + "\n";

      for (const recipient of recipientList) {
        await sendEmail({
          to: recipient,
          subject,
          html
        });
      }

      console.log(`Sent notifications to ${recipientList} for league ${leagueId} on ${teeDate}`);

      res.json({
        status: "SENT",
        count: recipientList.length,
        recipients: recipientList
      });

    } catch (err) {
      console.error("Send Notifications Error:", err);
      res.status(500).json({ error: "Server error sending notifications." });
    }
  }
);

// ------------------------------------------------------------------------------------
// Copy data from tee_sheet table to tee_sheet_working for current league and play date
// ------------------------------------------------------------------------------------
app.post("/admin/api/tee-sheet/:leagueId/:teeDate/reset-working",
  requireTeeSheetEditor,
  async (req, res) => {
    const { leagueId, teeDate } = req.params;
    const userEmail = req.session.user.email;
    const easternTimestamp = easternNow();

    try {
      // 1. Delete working rows
      await dbRun(
        `DELETE FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?`,
        [leagueId, teeDate]
      );

      // 2. Load saved tee_sheet rows
      const savedRows = await dbAll(
        `SELECT *
           FROM tee_sheet
          WHERE league_id = ?
            AND tee_date = ?
       ORDER BY tee_time ASC`,
        [leagueId, teeDate]
      );

      // 3. Insert into working copy
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

      for (const row of savedRows) {
        await dbRun(insertWorking, [
          row.tee_date,
          row.tee_time,
          row.starting_nine,
          row.league_id,
          row.league_name,
          row.user_id1, row.last_name1, row.first_name1,
          row.user_id2, row.last_name2, row.first_name2,
          row.user_id3, row.last_name3, row.first_name3,
          row.user_id4, row.last_name4, row.first_name4,
          userEmail,
          easternTimestamp
        ]);
      }

      res.json({ status: "RESET" });

    } catch (err) {
      console.error("RESET WORKING ERROR:", err);
      res.status(500).send("Server error");
    }
  }
);

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

    console.log("session.user.league_id =", req.session.user?.league_id);
    console.log("session.user.id =", req.session.user?.id);

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
        console.log("→ GET /admin/session-info - SESSION:", req.session, " user:", user, " user.id:", user.id);
        let leagueName = null;
        if (user.league_id) {
            const row = await db.getAsync(
                "SELECT league_name FROM leagues WHERE id = ?",
                [user.league_id]
            );
            leagueName = row ? row.league_name : null;
            console.log("→ GET /admin/session-info - leagueName:", leagueName);
        }

        res.json({
            id: user.id,
            email: user.email,

            // ⭐ Normalize to REAL booleans
            is_super_admin: user.is_super_admin === true || user.is_super_admin === 1,
            is_admin: user.is_admin === true || user.is_admin === 1,

            // ⭐ Normalize league_id
            league_id: user.league_id ? Number(user.league_id) : null,

            first_name: user.first_name,
            last_name: user.last_name,
            league_name: leagueName,
            user_mode: user.user_mode
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

// =======================================
// ADMIN OVERRIDE: SAVE SCHEDULE (SQLite)
// =======================================
app.put("/admin/schedule/save/:origInTownStatus/:sessionStartTS", async (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const { target_user_id, year, month, schedule } = req.body;
    const { origInTownStatus, sessionStartTS } = req.params;
    const source = "ADMIN";

    let golfingThisMonth = 0;

    console.log(">>>> DEBUG: /admin/schedule/save -", {
      target_user_id,
      adminUserId,
      year,
      month,
      schedule,
      origInTownStatus,
      sessionStartTS
    });

    // --- Validate input ---
    if (!target_user_id || !year || !month || !schedule) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // --- Verify admin privileges ---
    const adminRow = db.prepare(
      "SELECT is_admin, email, league_id FROM users WHERE id = ?"
    ).get(adminUserId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    const adminEmail = adminRow.email;
    const leagueId = adminRow.league_id;

    // --- Verify target user exists ---
    const userRow = db.prepare(
      "SELECT id FROM users WHERE id = ?"
    ).get(target_user_id);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    // -------------------------------------------------------------------------
    // VALIDATION: Ensure user is only selecting days allowed by the league
    // -------------------------------------------------------------------------
    const leagueDaysRows = await dbAll(
      `SELECT day_of_week
         FROM league_play_days
        WHERE league_id = ?
          AND is_play_day = 1`,
      [leagueId]
    );

    const allowedDays = leagueDaysRows.map(r => r.day_of_week);
    const invalidSelections = [];

    for (const [date, isPlaying] of Object.entries(schedule)) {
      if (!isPlaying) continue;

      const [y, m, d] = date.split("-");
      const dow = new Date(y, m - 1, d).getDay();

      if (!allowedDays.includes(dow)) {
        invalidSelections.push(date);
      }
    }

    if (invalidSelections.length > 0) {
      return res.status(400).json({
        error: "Invalid days selected",
        invalidDates: invalidSelections
      });
    }

    // -------------------------------------------------------------------------
    // LOAD EXISTING SCHEDULE FOR THIS USER + MONTH
    // -------------------------------------------------------------------------
    const pad = n => String(n).padStart(2, "0");
    const prefix = `${year}-${pad(month)}-`;

    const existingRows = await dbAll(
      `SELECT date, is_playing
         FROM schedule
        WHERE user_id = ?
          AND date LIKE ?`,
      [target_user_id, `${prefix}%`]
    );

    const existingMap = {};
    for (const row of existingRows) {
      existingMap[row.date] = row.is_playing;
    }

    // -------------------------------------------------------------------------
    // WRITE CHANGES TO schedule_history (UPSERT)
    // AND
    // WRITE CHANGED TO schedule (UPSERT) as we want to keep the updated_at
    // timestamp.
    // -------------------------------------------------------------------------
    const historyStmt = db.prepare(`
      INSERT INTO schedule_history (
          user_id,
          league_id,
          play_date,
          old_is_playing,
          new_is_playing,
          changed_by,
          changed_at,
          source,
          before_state,
          after_state
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, league_id, play_date, changed_at)
      DO UPDATE SET
          new_is_playing = excluded.new_is_playing,
          changed_by     = excluded.changed_by,
          source         = excluded.source,
          after_state    = excluded.after_state
    `);

    const scheduleStmt = db.prepare(`
      INSERT INTO schedule (user_id, date, is_playing, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, date)
      DO UPDATE SET
          is_playing = excluded.is_playing,
          updated_at = excluded.updated_at
    `);

    for (const [date, newVal] of Object.entries(schedule)) {
      const oldVal = existingMap[date] ?? 0;
      const newInt = newVal ? 1 : 0;

      if (oldVal !== newInt) {
        historyStmt.run(
          target_user_id,
          leagueId,
          date,
          oldVal,
          newInt,
          adminEmail,
          sessionStartTS,
          source,
          JSON.stringify({ is_playing: oldVal }),
          JSON.stringify({ is_playing: newInt })
        );

        scheduleStmt.run(
          target_user_id,
          date,
          newInt,
          sessionStartTS
        );
      }
    }    
    
    // -------------------------------------------------------------------------
    // DELETE schedule rows where after prior UPSERT caused new_is_playing to be
    // equal to old_is_playing as that would indicate no change ... and we only
    // want to keep the history rows where there is a change.
    // -------------------------------------------------------------------------
    db.prepare(
      `DELETE FROM schedule_history
        WHERE user_id = ?
          AND play_date LIKE ?
          AND new_is_playing = old_is_playing`
    ).run(target_user_id, `${prefix}%`);

    console.log("admin save route ... schedule=", schedule)

    // -------------------------------------------------------------------------
    // RETURN UPDATED SCHEDULE 
    // -------------------------------------------------------------------------
    const rows = db.prepare(
      `SELECT date, is_playing
         FROM schedule
        WHERE user_id = ?
          AND date LIKE ?
        ORDER BY date`
    ).all(target_user_id, `${prefix}%`);

    const scheduleObj = {};
    rows.forEach(r => {
      scheduleObj[r.date] = r.is_playing === 1;
      if (r.is_playing === 1) golfingThisMonth = 1;
    });

    // -------------------------------------------------------------------------
    // UPDATE user_play_months.in_town
    // -------------------------------------------------------------------------
    if (golfingThisMonth === 1) {
      db.prepare(`
        UPDATE user_play_months
           SET in_town = 1
         WHERE user_id = ?
           AND month = ?
      `).run(target_user_id, month);
    } else {
      db.prepare(`
        UPDATE user_play_months
           SET in_town = ?
         WHERE user_id = ?
           AND month = ?
      `).run(origInTownStatus, target_user_id, month);
    }

    return res.json({
      status: "saved",
      schedule: scheduleObj
    });

  } catch (err) {
    console.error("Admin override save error:", err);
    return res.status(500).json({ error: "Server error saving schedule." });
  }
});

// ===========================================
// ADMIN OVERRIDE: GENERATE DEFAULT SCHEDULE
// ===========================================
app.post("/admin/schedule/default/", async (req, res) => {
  try {
    const target_user_id = req.body.target_user_id ?? req.query.target_user_id;
    const year  = Number(req.body.year  ?? req.query.year);
    const month = Number(req.body.month ?? req.query.month);
    const adminUserId = req.session.user?.id;

    console.log(`>>> DEBUG: /admin/schedule/default/ - target_user_id: ${target_user_id},
       adminUserId: ${adminUserId}, year: ${year}, month: ${month}`);

    if (!target_user_id || !year || !month) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const adminRow = db.prepare(
      "SELECT is_admin FROM users WHERE id = ?"
    ).get(adminUserId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Build default schedule (no DB writes) ---
    const dayRows = await dbAll(
      `SELECT day_of_week
         FROM user_play_days
        WHERE user_id = ? 
          AND is_play_day = 1`,
      [target_user_id]
    );

    const allowedDays = dayRows.map(r => r.day_of_week);

    const endDate = new Date(year, month, 0).getDate();
    const schedule = {};

    for (let d = 1; d <= endDate; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const fullDate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      schedule[fullDate] = allowedDays.includes(dow);
    }

    return res.json({
      status: "default",
      schedule
    });

  } catch (err) {
    console.error("Admin override default error:", err);
    return res.status(500).json({ error: "Server error generating default schedule." });
  }
});

// **********************************************************************************************************
// Schedule - CLEAR - but without saving schedule nor saving schedule_history
//***********************************************************************************************************
app.post("/admin/schedule/clear/", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const { target_user_id, year, month } = req.body;

    const source = "ADMIN";

    console.log(`>>> DEBUG: /admin/schedule/clear/ - 
       target_user_id: ${target_user_id},
       adminUserId: ${adminUserId}, year: ${year}, month: ${month}`);

    // --- Validate input ---
    if (!target_user_id || !year || !month) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // --- Verify admin privileges ---
    const adminRow = db.prepare(
      "SELECT is_admin, email FROM users WHERE id = ?"
    ).get(adminUserId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Verify target user exists ---
    const userRow = db.prepare(
      "SELECT id FROM users WHERE id = ?"
    ).get(target_user_id);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    // --- Return empty schedule to frontend ---
    return res.json({
      status: "CLEARED",
      schedule: {}   // empty month
    });

  } catch (err) {
    console.error("Admin override clear error:", err);
    return res.status(500).json({ error: "Server error clearing schedule." });
  }
});

// ADMIN OVERRIDE ENTRY POINT — serve schedule.html
app.get("/admin/schedule/:targetUserId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "schedule.html"));
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
           WHERE league_id = ? 
           ORDER BY day_of_week ASC`,
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
    console.log("put /admin/golfers/api/:id📌 leagueId =", leagueId);
    console.log("id =", id);
    console.log("req.params.id =", req.params.id);

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
        console.log("existing =", existing, "existing.league_id =", existing?.league_id,
                    "leagueId =", leagueId);
        const eleagueIdStr = String(existing?.league_id);
        const leagueIdStr = String(leagueId);
        console.log("eleagueIdStr =", eleagueIdStr, "leagueIdStr =", leagueIdStr);
        if (!existing || eleagueIdStr !== leagueIdStr) {
            return res.status(404).json({ error: "Golfer not found" });
        }
        console.log("Updating golfer with id =", id, "first_name =", first_name, "last_name =", last_name, "email =", email,
                    "is_admin =", is_admin, "is_member =", is_member, "subgroup =", subgroup, "subgroup_number =", subgroup_number);
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
        console.log("put route - Golfer updated successfully");
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

        const eleagueIdStr = String(existing?.league_id);
        const leagueIdStr = String(leagueId);

        if (!existing || eleagueIdStr !== leagueIdStr) {
            return res.status(404).json({ error: "Golfer not found. user id: " + id });
        }

        await dbRun("DELETE FROM users WHERE id = ?", [id]);

        res.json({ success: true });

    } catch (err) {
        console.error("DELETE golfer error:", err);

        // ⭐ Detect FK constraint failure
        if (err.code === "SQLITE_CONSTRAINT" || err.code === "SQLITE_CONSTRAINT_TRIGGER") {
            return res.status(409).json({
                error:
                    "This golfer cannot be deleted because they have existing play history " +
                    "(user_play_days or user_play_months). Please contact the DBA to remove " +
                    "all dependent records before deleting this golfer."
            });
        }

        // Generic fallback
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
    const password = req.body.password;
    console.log("put /admin/golfers/api/:id/password📌 leagueId =", leagueId);
    console.log("id =", id);
    console.log("password:", password, "req.body.password:",  req.body.password);

    if (password === null || password === undefined) {
        return res.status(400).json({ error: "Password required" });
    }

    try {
        const existing = await dbGet("SELECT league_id FROM users WHERE id = ?", [id]);
        console.log("put /admin/golfers/api/:id/password📌 existing =", existing);
        console.log("existing.league_id =", existing.league_id);
        if (!existing || String(existing.league_id) !== String(leagueId)) {
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
// =============================================================
// call to async function emailToSuperAdmins(subject, emailText)
//      to send email to superadmins.  can use on any cron job.
// =============================================================
// -------------------------

const cron = require("node-cron");
const { optimizeDatabase, vacuumDatabase } = require("./db/maintenance");
const { generateTeeSheet } = require("./services/generateTeeSheet");

// TEMP: Run nightly generator immediately on server startup (for testing)
//generateTeeSheet();  // comment out to stop running 8pm cron job to load tee sheet for 2 days hence

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
  console.log("⏰ nightly running tee-sheet cron job (8 PM Eastern)...");
  await generateTeeSheet();   // nightly job for all leagues
}, {
  timezone: "America/New_York"
});

// Tee sheet REBUILD REBUILD REBUILD - this should be commented out except
// for testing purposes.  It will rebuild the tee sheet based on the teeDate
// the editor places in the second argument of 
// generateTeeSheet(leagueId, teeDate, emailid)
// COMMENT below code OUT AFTER RUNNING!!!
//
//    cron.schedule("59 15 * * *", async () => {
//    console.log("⏰ tee sheet rebuild cron job to run based on editing");
//    const uid = 1;  // leagueId
//    const teeDate = "2026-09-11";  // date to rebuild
//    const emailId = "rlhayner@verizon.net"; 
//    await generateTeeSheet({
//          leagueId: Number(uid),
//          playDate: teeDate,
//          generatedBy: emailId}); 
//    }, {
//    timezone: "America/New_York"
//    });

// -----------------------------------------------------------------
// run job to extend dates on the calendar_dates table for 14 months
// from today.
// -----------------------------------------------------------------
const { runExtendCalendarJob } = require("./jobs/runExtendCalendarJob");

// ----------------------------------------------------------
//  NEW: Extend calendar_dates table (4:25 AM Eastern)
//  Runs on the 1st of each month BEFORE default playdates
// ----------------------------------------------------------

cron.schedule("25 4 1 * *", async () => {
  console.log("⏰ Running extendCalendarDates job (4:25 AM Eastern)...");
  await runExtendCalendarJob();
}, {
  timezone: "America/New_York"
});

// ----------------------------------------------------------
//  NEW: Default next-month playdates (5:30 AM Eastern)
//  Runs on: 1st, 14th, and last day of the month
// ----------------------------------------------------------
const { runDefaultPlaydatesJob } = require("./jobs/runDefaultPlaydatesJob");

cron.schedule("30 5 1,14 * *", async () => {
  runDefaultPlaydatesJob();
}, {
  timezone: "America/New_York"
});

// Last day of month at 5:30 AM Eastern
cron.schedule("30 5 * * *", async () => {
  const nowET = easternNow();                 // use the imported function
  const tomorrowET = new Date(nowET);         // clone
  tomorrowET.setDate(tomorrowET.getDate() + 1);

  if (tomorrowET.getDate() === 1) {
    runDefaultPlaydatesJob();
  }
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
