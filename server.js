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
const bcrypt = require("bcrypt");
const { easternNow } = require("./utils/easternTime");
const latestApplyResultMap = {};
const { sendEmail } = require("./services/mailer");
const { requireLogin, requireAdmin, requireLeagueAdmin,
        requireSuperAdmin, requireAdminLoginOnly } = require("./middleware/auth");

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
    console.dir(req.session.user?.leagues, { depth: null });
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
    const league = db.prepare(
      `SELECT email, coordinator_controls_editing
         FROM leagues
        WHERE id = ?`
    ).get(leagueId);

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
function emailToSuperAdmins(subject, emailText) {
  const superAdmins = db.prepare(`
    SELECT email 
      FROM super_admins 
  `).all();

  return sendEmail({
    to: superAdmins.map(a => a.email),
    subject,
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
function autoPlaceGolfers(leagueId, teeDate, addedGolfers) {
  const rows = db.prepare(`
    SELECT *
      FROM tee_sheet_working
     WHERE league_id = ?
       AND tee_date = ?
     ORDER BY tee_time ASC, starting_nine
  `).all(leagueId, teeDate);

  const placed = [];
  const unplaced = [];

  const updateStmt = db.prepare(`
    UPDATE tee_sheet_working
       SET user_id1 = ?
         , first_name1 = ?
         , last_name1 = ?
     WHERE id = ?
  `);

  for (const golfer of addedGolfers) {
    let placedThisGolfer = false;

    for (const row of rows) {
      const slots = [row.user_id1, row.user_id2, row.user_id3, row.user_id4];
      const emptyIndex = slots.findIndex(s => !Number.isInteger(s));

      if (emptyIndex !== -1) {
        const slotNum = emptyIndex + 1;
        const colUser  = `user_id${slotNum}`;
        const colFirst = `first_name${slotNum}`;
        const colLast  = `last_name${slotNum}`;

        db.prepare(`
          UPDATE tee_sheet_working
             SET ${colUser} = ?, ${colFirst} = ?, ${colLast} = ?
           WHERE id = ?
        `).run(golfer.user_id, golfer.first_name, golfer.last_name, row.id);

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

  const updatedRows = db.prepare(`
    SELECT *
    FROM tee_sheet_working
    WHERE league_id = ?
      AND tee_date = ?
    ORDER BY tee_time, starting_nine
  `).all(leagueId, teeDate);

  return { placed, unplaced, rows: updatedRows };
}

// get the unplaced golfers and return it to the frontend
// 1. Get the unplaced golfers for the upcoming play_date and for the league by
// getting all players playing today based on schedule but do not exist
// on the tee_sheet table for today.
  app.get("/admin/api/tee-sheet/:leagueId/:teeDate/unplaced", requireTeeSheetEditor,
  (req, res) => {
    const { leagueId, teeDate } = req.params;

    try {
      const updateSchedHistTx = db.transaction(() => {

        const scheduled = db.prepare(`
          SELECT DISTINCT id
              , first_name
              , last_name
            FROM schedule
            JOIN users ON users.id = schedule.user_id
                      AND users.league_id = schedule.league_id
          WHERE schedule.date = ?
            AND schedule.is_playing = 1
            AND schedule.league_id = ?
        `).all(teeDate, leagueId);

        const rows = db.prepare(`
          SELECT *
            FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
        `).all(leagueId, teeDate);

        const placedIds = new Set();
        for (const row of rows) {
          [row.user_id1, row.user_id2, row.user_id3, row.user_id4]
            .filter(id => Number.isInteger(id))
            .forEach(id => placedIds.add(id));
        }

        const unplaced = scheduled.filter(g => !placedIds.has(g.id));

        const updateStmt = db.prepare(`
          UPDATE schedule_history
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
            )
        `);

        for (const g of unplaced) {
          updateStmt.run(teeDate, leagueId, g.id, teeDate, leagueId, g.id);
        }
      });

      // ⭐ Execute the transaction
      updateSchedHistTx();

      res.json({ unplaced });

    } catch (err) {
      console.error("Error loading unplaced golfers:", err);
      res.status(500).json({ error: "Server error loading unplaced golfers." });
    }
  }
);

app.get("/auth/leagues", requireSuperAdmin, (req, res) => {
    console.log("→ HANDLER: GET /auth/leagues");
    console.log("  session.user =", req.session.user);

    try {
        const rows = db.prepare(`
            SELECT id
                 , league_name
              FROM leagues
             ORDER BY league_name
        `).all();

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error loading Super Admin leagues" });
    }
});

app.get("/auth/leagues2", requireAdminLoginOnly, (req, res) => {
    console.log("→ HANDLER: GET /auth/leagues2");
    console.log("  session.user =", req.session.user);

    try {
        const rows = db.prepare(`
            SELECT leagues.id
                 , leagues.league_name
              FROM users
              JOIN leagues 
                ON leagues.id = users.league_id
             WHERE users.email = ?
               AND users.is_admin = 1
             ORDER BY leagues.league_name
        `).all(req.session.user.email);

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
  (req, res) => {

    try {
      const { leagueId, teeDate } = req.params;
      console.log("GET /admin/api/tee-sheet/:leagueId/:teeDate/changes - route start -",
        " leagueId=", leagueId, " teeDate=", teeDate);

      // -----------------------------------------------------------------------
      // 1. Find golfers who SHOULD be on tee_sheet_working but are missing
      // -----------------------------------------------------------------------
      const missingRows = db.prepare(`
        SELECT missing.userId
             , missing.firstName
             , missing.lastName
             , missing.updatedAt
        FROM (
            SELECT LFT.user_id as userId
                 , LFT.first_name AS firstName
                 , LFT.last_name as lastName
                 , LFT.updated_at AS updatedAt
                 , RGHT.user_id
            FROM (
                SELECT user_id, first_name, last_name, updated_at
                FROM (
                    SELECT users.id AS user_id, first_name, last_name, updated_at
                    FROM schedule, users
                    WHERE schedule.date = ?
                      AND is_playing = 1
                      AND users.id = schedule.user_id
                      AND users.league_id = schedule.league_id
                      AND schedule.league_id = ?
                    UNION
                    SELECT DISTINCT guests.id as user_id,
                           guest_first_name as first_name,
                           guest_last_name as last_name,
                           updated_at
                    FROM guests, users
                    WHERE guests.sponsor_user_id = users.id
                      AND guests.league_id = users.league_id
                      AND users.league_id = ?
                      AND ? IN (guests.date1, guests.date2, guests.date3,
                                guests.date4, guests.date5)
                )
            ) AS LFT
            LEFT JOIN (
                SELECT user_id, first_name, last_name
                FROM (
                    SELECT user_id1 as user_id, first_name1 as first_name, last_name1 as last_name
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id1 <> ''
                    UNION
                    SELECT user_id2, first_name2, last_name2
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id2 <> ''
                    UNION
                    SELECT user_id3, first_name3, last_name3
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id3 <> ''
                    UNION
                    SELECT user_id4, first_name4, last_name4
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id4 <> ''
                )
            ) AS RGHT
            ON RGHT.user_id = LFT.user_id
            WHERE RGHT.user_id IS NULL
        ) AS missing
        ORDER BY updatedAt ASC
      `).all(
        teeDate, leagueId, leagueId, teeDate,
        leagueId, teeDate, leagueId, teeDate,
        leagueId, teeDate, leagueId, teeDate
      );

      const added = missingRows.map(row => ({
        user_id: row.userId,
        first_name: row.firstName,
        last_name: row.lastName,
        requested_at: row.updatedAt
      }));

      console.log("/CHANGES route - added=", added);

      // -----------------------------------------------------------------------
      // 2. Find golfers who ARE on tee_sheet_working but should NOT be
      // -----------------------------------------------------------------------
      const extraRows = db.prepare(`
        SELECT extra.userId
             , extra.firstName
             , extra.lastName
             , extra.editedAt
        FROM (
            SELECT LFT.user_id AS userId
                 , LFT.first_name AS firstName
                 , LFT.last_name AS lastName
                 , LFT.edited_at AS editedAt
                 , RGHT.user_id
            FROM (
                SELECT user_id, first_name, last_name, edited_at
                FROM (
                    SELECT user_id1 as user_id, first_name1, last_name1, edited_at
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id1 <> ''
                    UNION
                    SELECT user_id2, first_name2, last_name2, edited_at
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id2 <> ''
                    UNION
                    SELECT user_id3, first_name3, last_name3, edited_at
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id3 <> ''
                    UNION
                    SELECT user_id4, first_name4, last_name4, edited_at
                    FROM tee_sheet_working
                    WHERE league_id = ?
                      AND tee_date = ?
                      AND user_id4 <> ''
                )
            ) AS LFT
            LEFT JOIN (
                SELECT user_id, first_name, last_name
                FROM (
                    SELECT users.id AS user_id, first_name, last_name
                      FROM schedule                     
                      JOIN users
                        ON users.id = schedule.user_id
                       AND users.league_id = schedule.league_id
                     WHERE schedule.date = ?
                       AND is_playing = 1
                       AND schedule.league_id = ?
                    UNION
                    SELECT DISTINCT guests.id, guest_first_name, guest_last_name
                      FROM guests
                      JOIN users
                        ON guests.sponsor_user_id = users.id
                       AND guests.league_id = users.league_id
                     WHERE guests.league_id = ?
                       AND ? IN (guests.date1, guests.date2, guests.date3,
                                 guests.date4, guests.date5)
                )
            ) AS RGHT
            ON RGHT.user_id = LFT.user_id
            WHERE RGHT.user_id IS NULL
        ) AS extra
        ORDER BY editedAt ASC
      `).all(
        leagueId, teeDate, leagueId, teeDate,
        leagueId, teeDate, leagueId, teeDate,
        teeDate, leagueId, leagueId, teeDate
      );

      const removed = extraRows.map(row => ({
        user_id: row.userId,
        first_name: row.firstName,
        last_name: row.lastName,
        requested_at: row.editedAt
      }));

      console.log("/CHANGES route - removed=", removed);

      res.json({ added, removed });

    } catch (err) {
      console.error("Error in tee-sheet /changes route:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

function deleteFirstDupUserSlot(leagueId, teeDate, dupUserId) {
  try {
    const dupFoundRow = db.prepare(`
      SELECT *
        FROM tee_sheet_working
       WHERE league_id = ?
         AND tee_date = ?
         AND ? IN (user_id1, user_id2, user_id3, user_id4)
       LIMIT 1
    `).get(leagueId, teeDate, dupUserId);

    if (!dupFoundRow) {
      console.log("No duplicate slot found for user:", dupUserId);
      return;
    }

    const teeTime = dupFoundRow.tee_time;

    let slotNum = null;

    if (dupFoundRow.user_id1 === dupUserId) slotNum = 1;
    else if (dupFoundRow.user_id2 === dupUserId) slotNum = 2;
    else if (dupFoundRow.user_id3 === dupUserId) slotNum = 3;
    else if (dupFoundRow.user_id4 === dupUserId) slotNum = 4;

    if (!slotNum) {
      console.log("Duplicate user not found in any slot:", dupUserId);
      return;
    }

    const colUser  = `user_id${slotNum}`;
    const colFirst = `first_name${slotNum}`;
    const colLast  = `last_name${slotNum}`;

    const info = db.prepare(`
      UPDATE tee_sheet_working
         SET ${colUser} = '',
             ${colFirst} = '',
             ${colLast} = ''
       WHERE league_id = ?
         AND tee_date = ?
         AND tee_time = ?
    `).run(leagueId, teeDate, teeTime);

    if (info.changes === 0) {
      console.log("Failed to remove duplicate user:", dupUserId);
    } else {
      console.log(`Removed duplicate user ${dupUserId} from slot ${slotNum} at tee time ${teeTime}`);
    }

  } catch (err) {
    console.error("deleteFirstDupUserSlot() error:", err);
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
app.get("/admin/api/tee-sheet/:leagueId/:teeDate/validate2",
  requireTeeSheetEditor,
  (req, res) => {

    const { leagueId, teeDate } = req.params;

    try {
      const duplicateRows = db.prepare(`
        SELECT A.user_id, COUNT(*) AS slots_count
        FROM (
          SELECT user_id1 AS user_id
          FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
            AND user_id1 <> ''
          UNION ALL
          SELECT user_id2
          FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
            AND user_id2 <> ''
          UNION ALL
          SELECT user_id3
          FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
            AND user_id3 <> ''
          UNION ALL
          SELECT user_id4
          FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
            AND user_id4 <> ''
        ) AS A
        GROUP BY user_id
        HAVING COUNT(*) > 1
      `).all(
        leagueId, teeDate,
        leagueId, teeDate,
        leagueId, teeDate,
        leagueId, teeDate
      );

      console.log("Duplicate users found:", duplicateRows.length);

      for (const d of duplicateRows) {
        const dupUserId = d.user_id;
        const dupCount = d.slots_count - 1;

        for (let i = 0; i < dupCount; i++) {
          deleteFirstDupUserSlot(leagueId, teeDate, dupUserId);
        }
      }

      const workingRows = db.prepare(`
        SELECT *
          FROM tee_sheet_working
         WHERE league_id = ?
           AND tee_date = ?
         ORDER BY tee_time ASC
      `).all(leagueId, teeDate);

      if (workingRows.length === 0) {
        return res.status(404).send(`No rows found on tee_sheet_working.`);
      }

      res.json(workingRows);

    } catch (err) {
      console.error("Load tee sheet error:", err);
      res.status(500).send("Server error");
    }
  }
);

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
app.get("/admin/api/tee-sheet/:leagueId/:teeDate/validate1",
  requireTeeSheetEditor,
  (req, res) => {

    const { leagueId, teeDate } = req.params;
    const userEmail = req.session.user.email;

    console.log("GET /validate1 – user:", userEmail);
    console.log("TEE SHEET ROUTE SESSION:", req.session);

    try {
      //
      // 1. Check if working copy exists
      //
      const workingRows = db.prepare(`
        SELECT *
          FROM tee_sheet_working
         WHERE league_id = ?
           AND tee_date = ?
         ORDER BY tee_time ASC
      `).all(leagueId, teeDate);

      console.log("### tee_sheet_working row count =", workingRows.length);

      //
      // CASE A — working rows exist
      //
      if (workingRows.length > 0) {

        const allocatedRows = db.prepare(`
          SELECT tee_time_number
               , tee_time
               , tee_interval_minutes
               , league_name
            FROM allocated_tee_times
            JOIN leagues  
              ON leagues.id = allocated_tee_times.league_id
           WHERE play_date = ?
             AND allocated_tee_times.league_id = ?
           ORDER BY tee_time_number ASC
        `).all(teeDate, leagueId);

        // b. No allocated tee times
        if (allocatedRows.length === 0) {
          console.log("### No allocated tee times exist for league on", teeDate);
          return res.status(404).send(
            `No allocated tee times exist for league on ${teeDate}. `
            + `Click back, then go to "Allocate Tee Times" and enter tee times.`
          );
        }

        //
        // c. More allocated rows than working rows → add rows
        //
        if (allocatedRows.length > workingRows.length) {

          const allocatedRowCount = allocatedRows.length;
          const workingRowCount = workingRows.length;
          const missingRows = allocatedRowCount - workingRowCount;

          const teeIntervalMinutes = allocatedRows[0].tee_interval_minutes;
          const lastTeeTime = workingRows[workingRowCount - 1].tee_time;
          let newTeeTime = getNextTeeTime(lastTeeTime, teeIntervalMinutes);

          const startingNine = workingRows[0].starting_nine;
          const leagueName = workingRows[0].league_name;

          console.log(
            `Adding ${missingRows} rows to tee_sheet_working (allocated=${allocatedRowCount}, working=${workingRowCount})`
          );

          const insertStmt = db.prepare(`
            INSERT INTO tee_sheet_working (
              tee_date, tee_time, starting_nine, league_id, league_name,
              user_id1, last_name1, first_name1,
              user_id2, last_name2, first_name2,
              user_id3, last_name3, first_name3,
              user_id4, last_name4, first_name4,
              edited_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (let i = workingRowCount; i < allocatedRowCount; i++) {
            insertStmt.run(
              teeDate,
              newTeeTime,
              startingNine,
              leagueId,
              leagueName,
              '', '', '',
              '', '', '',
              '', '', '',
              '', '', '',
              userEmail
            );

            newTeeTime = getNextTeeTime(newTeeTime, teeIntervalMinutes);
          }
        }

        //
        // d. Fewer allocated rows than working rows → delete extra rows
        //
        else if (allocatedRows.length < workingRows.length) {

          let extraRows = workingRows.length - allocatedRows.length;

          console.log(`Deleting ${extraRows} extra rows from tee_sheet_working`);

          const selectLastRow = db.prepare(`
            SELECT id
              FROM tee_sheet_working
             WHERE league_id = ?
               AND tee_date = ?
             ORDER BY tee_time DESC
                    , starting_nine DESC
             LIMIT 1
          `).get(leagueId, teeDate);
          teeSheetWorkingId = selectLastRow.id;

          const deleteById = db.prepare(`
            DELETE 
              FROM tee_sheet_working
             WHERE id = ?
          `);

          while (extraRows > 0) {
            const lastRow = selectLastRow.get(leagueId, teeDate);
            if (lastRow) {
              deleteById.run(teeSheetWorkingId);
            }
            extraRows--;
          }
        }

        //
        // e. Equal rows → return workingRows immediately
        //
        else {
          return res.json(workingRows);
        }
      }

      //
      // CASE B — No working rows exist → copy from tee_sheet
      //
      else {

        const liveRows = db.prepare(`
          SELECT *
            FROM tee_sheet
           WHERE league_id = ?
             AND tee_date = ?
           ORDER BY tee_time ASC
        `).all(leagueId, teeDate);

        if (liveRows.length === 0) {
          return res.status(404).send(
            `No tee sheet exists for league on ${teeDate}. `
            + `Wait for the tee sheet deadline (typically 8pm two days prior). `
            + `Check with the League Coordinator for availability.`
          );
        }

        const insertStmt = db.prepare(`
          INSERT INTO tee_sheet_working (
            tee_date, tee_time, starting_nine, league_id, league_name,
            user_id1, last_name1, first_name1,
            user_id2, last_name2, first_name2,
            user_id3, last_name3, first_name3,
            user_id4, last_name4, first_name4,
            edited_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of liveRows) {
          insertStmt.run(
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
          );
        }
      }

      //
      // 3. Return fresh working rows
      //
      const fresh = db.prepare(`
        SELECT *
          FROM tee_sheet_working
         WHERE league_id = ?
           AND tee_date = ?
         ORDER BY tee_time ASC
      `).all(leagueId, teeDate);

      res.json(fresh);

    } catch (err) {
      console.error("Load tee sheet error:", err);
      res.status(500).send("Server error");
    }
  }
);

// ----------------------------------------------------
// SERVE THE TEE SHEET EDITOR HTML PAGE
// ----------------------------------------------------
const fs = require("fs");

// =====================================================
// SERVE ADMIN TEE SHEET EDITOR PAGE
// =====================================================
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


// =====================================================
// ADMIN: FIND MOST RECENT TEE SHEET DATE
// =====================================================
app.get("/admin/tee-sheet", requireAdmin, (req, res) => {
  console.log("admin/tee-sheet get route - SESSION:", req.session);

  const leagueId = req.session.user?.league_id;

  if (!leagueId) {
    return res.status(400).send("No league selected. Please log in again.");
  }

  try {
    const row = db.prepare(`
      SELECT MAX(tee_date) AS max_date
        FROM tee_sheet
       WHERE league_id = ?
    `).get(leagueId);

    if (!row || !row.max_date) {
      return res.send(`
        <h2>No tee sheet found</h2>
        <p>The upcoming tee sheet has not been generated yet.</p>
      `);
    }

    const maxDate = row.max_date;
    const today = new Date().toISOString().slice(0, 10);

    const max = new Date(maxDate);
    const now = new Date(today);

    if (isNaN(max.getTime())) {
      return res.send(`
        <h2>Upcoming tee sheet is not available, yet.</h2>
        <p>The tee sheet date is invalid.<br>
        The upcoming tee sheet has not been generated yet.</p>
      `);
    }

    if (max < now) {
      return res.send(`
        <h2>Upcoming tee sheet is not available, yet.</h2>
        <p>The most recent tee sheet (${maxDate}) is in the past.<br>
        The upcoming tee sheet has not been generated yet.<br>
        The upcoming tee sheet is typically produced at 8pm 2 days in advance.<br>
        Click on the browser's back arrow to return to the website.</p>
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
// ADMIN OVERRIDE: INITIAL MONTH LOAD
// =====================================================
app.get("/admin/schedule/init/:targetUserId/:month", (req, res) => {
  console.log("🔥 ADMIN INIT ROUTE HIT");
  console.log("🔥 SESSION =", req.session);

  try {
    const adminUserId = req.session.user?.id;
    const leagueId = req.session.user?.league_id;
    const targetUserId = req.params.targetUserId;
    const month = req.params.month;
    const easternTS = easternNow();

    // --- Verify admin privileges ---
    const adminRow = db.prepare(`
      SELECT id
           , is_admin
        FROM users
       WHERE id = ?
         AND league_id = ?
    `).get(adminUserId, leagueId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Verify target user exists ---
    const userRow = db.prepare(`
      SELECT users.id, first_name, last_name, in_town, users.league_id
        FROM users
        JOIN user_play_months 
          ON user_play_months.user_id = users.id
         AND user_play_months.league_id = users.league_id
       WHERE user_play_months.month = ?
         AND users.id = ?
         AND users.league_id = ?
    `).get(month, targetUserId, leagueId);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    // --- Load league play days ---
    const leaguePlayDays = db.prepare(`
      SELECT day_of_week
       FROM league_play_days
      WHERE league_id = ?
        AND is_play_day = 1
    `).all(userRow.league_id).map(r => r.day_of_week);

    // --- Determine current year ---
    const now = new Date();
    const year = now.getFullYear();

    // --- Load schedule for the month ---
    const rows = db.prepare(`
      SELECT date
           , is_playing
        FROM schedule
       WHERE user_id = ?
         AND league_id = ?
         AND strftime('%Y', date) = ?
         AND strftime('%m', date) = ?
       ORDER BY date
    `).all(targetUserId, leagueId, String(year), String(month).padStart(2, "0"));

    const scheduleObj = {};
    rows.forEach(r => {
      scheduleObj[r.date] = r.is_playing === 1;
    });

    return res.json({
      status: "ok",
      user: userRow,
      year,
      month,
      schedule: scheduleObj,
      leaguePlayDays,
      origInTown: userRow.in_town,
      easternTS
    });

  } catch (err) {
    console.error("🔥 ADMIN INIT ERROR:", err);
    return res.status(500).json({ error: "Server error loading initial schedule." });
  }
});


// =====================================================
// ADMIN OVERRIDE: LOAD TARGET USER SCHEDULE
// =====================================================
app.get("/admin/schedule/:targetUserId/:leagueId/:year/:month", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const { targetUserId, leagueId, year, month } = req.params;

    if (!targetUserId || !leagueId || !year || !month) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // --- Verify admin privileges ---
    const adminRow = db.prepare(`
      SELECT id
           , is_admin
        FROM users
       WHERE id = ?
         AND league_id = ?
    `).get(adminUserId, leagueId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Verify target user exists ---
    const userRow = db.prepare(`
      SELECT DISTINCT users.id, first_name, last_name, in_town, users.league_id
        FROM users
        JOIN user_play_months 
          ON user_play_months.user_id = users.id
         AND user_play_months.league_id = users.league_id
       WHERE users.id = ?
         AND users.league_id = ?
    `).get(targetUserId, leagueId);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    // --- Load league play days ---
    const leaguePlayDays = db.prepare(`
      SELECT day_of_week
        FROM league_play_days
       WHERE league_id = ?
         AND is_play_day = 1
    `).all(userRow.league_id).map(r => r.day_of_week);

    // --- Load schedule ---
    const rows = db.prepare(`
      SELECT date
           , is_playing
        FROM schedule
       WHERE user_id = ?
         AND league_id = ?
         AND strftime('%Y', date) = ?
         AND strftime('%m', date) = ?
       ORDER BY date
    `).all(targetUserId, leagueId, String(year), String(month).padStart(2, "0"));

    const scheduleObj = {};
    rows.forEach(r => {
      scheduleObj[r.date] = r.is_playing === 1;
    });

    return res.json({
      status: "ok",
      user: {
        id: userRow.id,
        first_name: userRow.first_name,
        last_name: userRow.last_name,
        in_town: userRow.in_town
      },
      schedule: scheduleObj,
      leaguePlayDays
    });

  } catch (err) {
    console.error("Admin override GET error:", err);
    return res.status(500).json({ error: "Server error loading schedule." });
  }
});

// ----------------------------------------------------------------------------------
// SAVE
// ----------------------------------------------------------------------------------
// =====================================================
// SAVE TEE SHEET
// =====================================================
app.post("/admin/api/tee-sheet/:leagueId/:teeDate/save",
  requireTeeSheetEditor,
  (req, res) => {

    const { leagueId, teeDate } = req.params;
    const newRows = req.body.rows;
    const userEmail = req.session.user.email;
    const easternTimestamp = easternNow();

    console.log("=== SAVE START ===");

    try {
      const insertTransaction = db.transaction(() => {

        // 1. Load old tee_sheet rows
        const oldRows = db.prepare(`
          SELECT *
            FROM tee_sheet
          WHERE league_id = ?
            AND tee_date = ?
          ORDER BY tee_time ASC
        `).all(leagueId, teeDate);

        // 2. Audit log
        db.prepare(`
          INSERT INTO tee_sheet_audit_log (
            tee_date, league_id, user_email, action, change_summary,
            before_state, after_state, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          teeDate,
          leagueId,
          userEmail,
          "SAVE",
          "Full save (no diff)",
          JSON.stringify(oldRows),
          JSON.stringify(newRows),
          easternTimestamp
        );

        // 3. Load existing working rows so we can PRESERVE edited_at
        const oldWorking = db.prepare(`
          SELECT tee_time, starting_nine, edited_at
            FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
        `).all(leagueId, teeDate);

        function findEditedAt(row) {
          const match = oldWorking.find(
            r =>
              r.tee_time === row.tee_time &&
              r.starting_nine === row.starting_nine
          );
          return match ? match.edited_at : easternTimestamp;
        }

        // 4. Replace tee_sheet with newRows
        db.prepare(`
          DELETE 
            FROM tee_sheet
          WHERE league_id = ?
            AND tee_date = ?
        `).run(leagueId, teeDate);

        const insertStmt = db.prepare(`
          INSERT INTO tee_sheet (
            tee_date, tee_time, starting_nine, league_id, league_name,
            user_id1, last_name1, first_name1,
            user_id2, last_name2, first_name2,
            user_id3, last_name3, first_name3,
            user_id4, last_name4, first_name4,
            is_locked, generated_by, generated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of newRows) {
          insertStmt.run(
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
          );
        }

        // 5. Sync working copy — PRESERVE edited_at
        db.prepare(`
          DELETE 
            FROM tee_sheet_working
           WHERE league_id = ?
             AND tee_date = ?
        `).run(leagueId, teeDate);

        const insertWorking = db.prepare(`
          INSERT INTO tee_sheet_working (
            tee_date, tee_time, starting_nine, league_id, league_name,
            user_id1, last_name1, first_name1,
            user_id2, last_name2, first_name2,
            user_id3, last_name3, first_name3,
            user_id4, last_name4, first_name4,
            edited_by, edited_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of newRows) {
          insertWorking.run(
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
            findEditedAt(row)
          );
        }
      });

      // 6. Commit transaction
      insertTransaction();

      res.json({ status: "SUCCESS" });

    } catch (err) {
      console.error("Save tee sheet error:", err);
      res.status(500).send("Server error");
    }
  }
);


// =====================================================
// REVERT TEE SHEET
// =====================================================
app.post("/admin/api/tee-sheet/:leagueId/:teeDate/revert",
  requireTeeSheetEditor,
  (req, res) => {

    const { leagueId, teeDate } = req.params;
    const userEmail = req.session.user.email;
    const easternTimestamp = easternNow();

    try {
      // 1. Delete working copy
      db.prepare(`
        DELETE FROM tee_sheet_working
         WHERE league_id = ?
           AND tee_date = ?
      `).run(leagueId, teeDate);

      // 2. Copy from tee_sheet
      const liveRows = db.prepare(`
        SELECT *
          FROM tee_sheet
         WHERE league_id = ?
           AND tee_date = ?
         ORDER BY tee_time ASC
      `).all(leagueId, teeDate);

      const insertStmt = db.prepare(`
        INSERT INTO tee_sheet_working (
          tee_date, tee_time, starting_nine, league_id, league_name,
          user_id1, last_name1, first_name1,
          user_id2, last_name2, first_name2,
          user_id3, last_name3, first_name3,
          user_id4, last_name4, first_name4,
          edited_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of liveRows) {
        insertStmt.run(
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
        );
      }

      // 3. Log revert
      db.prepare(`
        INSERT INTO tee_sheet_audit_log (
          tee_date, league_id, user_email, action, change_summary,
          before_state, after_state, created_at
        ) VALUES (?, ?, ?, 'REVERT', 'Reverted working copy', '[]', '[]', ?)
      `).run(
        teeDate,
        leagueId,
        userEmail,
        easternTimestamp
      );

      res.json(liveRows);

    } catch (err) {
      console.error("Revert error:", err);
      res.status(500).send("Server error");
    }
  }
);


// =====================================================
// REBUILD TEE SHEET (calls async generator)
// =====================================================
app.post(
  "/admin/api/tee-sheet/:leagueId/:teeDate/rebuild",
  requireTeeSheetEditor,
  async (req, res) => {

    const { leagueId, teeDate } = req.params;
    const adminEmail = req.session.user.email;

    console.log("🔥 REBUILD REQUEST:", leagueId, teeDate, "by", adminEmail);

    try {
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
function applyDropsInternal(leagueId, teeDate, removedUserIds) {
  if (!Array.isArray(removedUserIds) || removedUserIds.length === 0) return;

  console.log("applyDropsInternal: removing", removedUserIds);

  for (const item of removedUserIds) {
    const uid = Number(item.user_id);

    // 1. Find the row where this golfer is currently placed
    const row = db.prepare(`
      SELECT *
        FROM tee_sheet_working
       WHERE league_id = ?
         AND tee_date = ?
         AND (
              CAST(user_id1 AS INTEGER) = ?
          OR  CAST(user_id2 AS INTEGER) = ?
          OR  CAST(user_id3 AS INTEGER) = ?
          OR  CAST(user_id4 AS INTEGER) = ?
        )
       ORDER BY tee_time ASC
       LIMIT 1
    `).get(leagueId, teeDate, uid, uid, uid, uid);

    if (!row) {
      console.log(`🔥 applyDropsInternal: user ${uid} not found on tee sheet`);
      continue;
    }

    // 2. Determine which slot they occupy
    let slot = null;
    if (Number(row.user_id1) === uid) slot = 1;
    else if (Number(row.user_id2) === uid) slot = 2;
    else if (Number(row.user_id3) === uid) slot = 3;
    else if (Number(row.user_id4) === uid) slot = 4;

    if (!slot) {
      console.log(`🔥 applyDropsInternal: user ${uid} found but slot unknown`);
      continue;
    }

    const colUser  = `user_id${slot}`;
    const colFirst = `first_name${slot}`;
    const colLast  = `last_name${slot}`;

    // 3. Clear the slot
    db.prepare(`
      UPDATE tee_sheet_working
      SET ${colUser} = NULL,
          ${colFirst} = '',
          ${colLast} = ''
      WHERE id = ?
    `).run(row.id);

    console.log(
      `applyDropsInternal: cleared slot ${slot} for user ${uid} at tee time ${row.tee_time}`
    );
  }
}

// -------------------------------------------------------------------------------------------
// APPLY CHANGES (Simplified Model: Drops → Adds Chronologically)
// -------------------------------------------------------------------------------------------
app.post(
  "/admin/api/tee-sheet/:leagueId/:teeDate/apply-changes",
  requireTeeSheetEditor,
  (req, res) => {

    const { leagueId, teeDate } = req.params;
    const { removed, added } = req.body;
    const adminEmail = req.session.user.email;
    const ts = easternNow();

    if (!Array.isArray(removed) || !Array.isArray(added)) {
      return res.status(400).json({
        error: "/Apply-Changes error: request body missing valid added and removed arrays."
      });
    }

    try {
      // ---------------------------------------------------------
      // 1. APPLY DROPS FIRST
      // ---------------------------------------------------------
      if (removed.length > 0) {
        console.log("Applying DROPS...");
        applyDropsInternal(leagueId, teeDate, removed);
      }

      // ---------------------------------------------------------
      // 2. APPLY ADDS (chronologically)
      // ---------------------------------------------------------
      let placed = [];
      let unplaced = [];

      if (added.length > 0) {
        const placementResult = autoPlaceGolfers(
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
      db.prepare(`
        UPDATE tee_sheet_working
           SET edited_at = ?
             , edited_by = ?
         WHERE league_id = ?
           AND tee_date = ?
      `).run(ts, adminEmail, leagueId, teeDate);

      // ---------------------------------------------------------
      // 4. RETURN UPDATED TEE SHEET
      // ---------------------------------------------------------
      const rows = db.prepare(`
        SELECT *
          FROM tee_sheet_working
         WHERE league_id = ?
           AND tee_date = ?
         ORDER BY tee_time, starting_nine
      `).all(leagueId, teeDate);

      console.log("=== APPLY CHANGES COMPLETE ===");

      res.json({
        status: "SUCCESS",
        placed,
        unplaced,
        rows
      });

    } catch (err) {
      console.error("Apply Changes Error:", err);
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
      // 1. Load tee sheet WITH golfer emails
      // ---------------------------------------------------------
      const teeRows = db.prepare(`
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
      `).all(leagueId, teeDate);

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
        const admins = db.prepare(`
          SELECT email
            FROM users
           WHERE league_id = ?
             AND is_admin = 1
        `).all(leagueId);

        admins.forEach(a => {
          if (a.email) recipients.add(a.email);
        });
      }

      if (recipientGroups.clubStaff) {
        const staff = db.prepare(`
          SELECT email
            FROM club_staff
           WHERE league_id = ?
             AND is_active = 1
        `).all(leagueId);

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
        const longDateStr =
          `${dateObj.toLocaleDateString("en-US", { weekday: "long" })}, ` +
          dateObj.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
          });

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
      // 5. Send ONE email per recipient
      // ---------------------------------------------------------
      const subject = `Tee Sheet – ${teeDate}`;

      for (const recipient of recipientList) {
        await sendEmail({
          to: recipient,
          subject,
          html
        });
      }

      console.log(
        `Sent notifications to ${recipientList.join(", ")} for league ${leagueId} on ${teeDate}`
      );

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

app.post(
  "/admin/api/tee-sheet/:leagueId/:teeDate/reset-working",
  requireTeeSheetEditor,
  (req, res) => {

    const { leagueId, teeDate } = req.params;
    const userEmail = req.session.user.email;
    const easternTimestamp = easternNow();

    try {
      const insertTransaction = db.transaction(() => {

        // 1. Delete working rows
        db.prepare(`
          DELETE 
            FROM tee_sheet_working
          WHERE league_id = ?
            AND tee_date = ?
        `).run(leagueId, teeDate);

        // 2. Load saved tee_sheet rows
        const savedRows = db.prepare(`
          SELECT *
            FROM tee_sheet
          WHERE league_id = ?
            AND tee_date = ?
          ORDER BY tee_time ASC
        `).all(leagueId, teeDate);

        // 3. Insert into working copy
        const insertWorking = db.prepare(`
          INSERT INTO tee_sheet_working (
            tee_date, tee_time, starting_nine, league_id, league_name,
            user_id1, last_name1, first_name1,
            user_id2, last_name2, first_name2,
            user_id3, last_name3, first_name3,
            user_id4, last_name4, first_name4,
            edited_by, edited_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of savedRows) {
          insertWorking.run(
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
          );
        }
      });

      // 4. Commit transaction
      insertTransaction();

      res.json({ status: "RESET" });

    } catch (err) {
      console.error("RESET WORKING ERROR:", err);
      res.status(500).send("Server error");
    }
  }
);

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

app.get("/admin/session-info", requireLogin, (req, res) => {
  try {
    const user = req.session.user;

    let leagueName = null;

    if (user.league_id) {
      const row = db.prepare(`
        SELECT league_name
          FROM leagues
         WHERE id = ?
      `).get(user.league_id);

      leagueName = row ? row.league_name : null;
    }

    res.json({
      id: user.id,
      email: user.email,

      is_super_admin: user.is_super_admin === true || user.is_super_admin === 1,
      is_admin: user.is_admin === true || user.is_admin === 1,

      league_id: user.league_id ? Number(user.league_id) : null,

      first_name: user.first_name,
      last_name: user.last_name,
      league_name: leagueName,
      user_mode: user.user_mode
    });

  } catch (err) {
    console.error("SESSION INFO ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ------------------------------
// LEAGUE APIs
// ------------------------------

app.get("/admin/leagues/api/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  console.log("/admin/leagues/api/:id   id=", id);

  try {
    const league = db.prepare(`
      SELECT id, league_name, first_name, last_name, email, description
        FROM leagues
       WHERE id = ?
    `).get(id);

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

app.get("/admin/leagues/api", requireSuperAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, league_name, last_name, first_name, email, description
        FROM leagues
       ORDER BY league_name
    `).all();

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error loading leagues" });
  }
});
app.get("/admin/leagues/tee-interval", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;

  try {
    const row = db.prepare(`
      SELECT tee_interval_minutes
        FROM leagues
       WHERE id = ?
    `).get(leagueId);

    res.json({ tee_interval_minutes: row.tee_interval_minutes });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/admin/allocated-tee-times/:play_date", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;
  const { play_date } = req.params;

  try {
    const rows = db.prepare(`
      SELECT id, play_date, tee_time_number, tee_time
        FROM allocated_tee_times
       WHERE league_id = ?
         AND play_date = ?
       ORDER BY tee_time_number ASC
    `).all(leagueId, play_date);

    res.json({ teeTimes: rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/user/selected-league", requireLogin, (req, res) => {
  try {
    const leagueId = req.session.user.league_id;

    if (!leagueId) {
      return res.json({ league: null });
    }

    const row = db.prepare(`
      SELECT id, league_name
        FROM leagues
       WHERE id = ?
    `).get(leagueId);

    res.json({ league: row });

  } catch (err) {
    console.error("Error in /user/selected-league:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/leagues/api/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const { league_name, first_name, last_name, email, description } = req.body;

  try {
    db.prepare(`
      UPDATE leagues
         SET league_name = ?
           , first_name = ?
           , last_name = ?
           , email = ?
           , description = ?
       WHERE id = ?
    `).run(league_name, first_name, last_name, email, description, id);

    res.json({ success: true });

  } catch (err) {
    console.error("PUT /admin/leagues/api/:id ERROR:", err);
    res.json({ error: "Database error" });
  }
});

app.put("/admin/schedule/save/:origInTownStatus/:sessionStartTS", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const leagueId = req.session.user?.league_id;
    const { target_user_id, year, month, schedule } = req.body;
    const { origInTownStatus, sessionStartTS } = req.params;
    const source = "ADMIN";

    let golfingThisMonth = 0;

    // --- Validate input ---
    if (!target_user_id || !year || !month || !schedule) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // --- Verify admin privileges ---
    const adminRow = db.prepare(`
      SELECT is_admin
           , email
           , league_id
        FROM users
       WHERE id = ?
         AND league_id = ?
    `).get(adminUserId, leagueId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    const adminEmail = adminRow.email;

    // --- Verify target user exists ---
    const userRow = db.prepare(`
      SELECT id
        FROM users
       WHERE id = ?
         AND league_id = ?
    `).get(target_user_id, leagueId);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    // -------------------------------------------------------------------------
    // VALIDATION: Ensure user is only selecting days allowed by the league
    // -------------------------------------------------------------------------
    const leagueDaysRows = db.prepare(`
      SELECT day_of_week
        FROM league_play_days
       WHERE league_id = ?
         AND is_play_day = 1
    `).all(leagueId);

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

    const existingRows = db.prepare(`
      SELECT date
           , is_playing
        FROM schedule
       WHERE user_id = ?
         AND league_id = ?
         AND date LIKE ?
    `).all(target_user_id, leagueId, `${prefix}%`);

    const existingMap = {};
    for (const row of existingRows) {
      existingMap[row.date] = row.is_playing;
    }

    // -------------------------------------------------------------------------
    // UPSERT INTO schedule_history AND schedule
    // -------------------------------------------------------------------------
    const historyStmt = db.prepare(`
      INSERT INTO schedule_history (
        user_id, league_id, play_date,
        old_is_playing, new_is_playing,
        changed_by, changed_at, source,
        before_state, after_state
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
      INSERT INTO schedule (user_id, league_id, date, is_playing, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, league_id, date)
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
          leagueId,
          date,
          newInt,
          sessionStartTS
        );
      }
    }

    // -------------------------------------------------------------------------
    // DELETE history rows where no change occurred
    // -------------------------------------------------------------------------
    db.prepare(`
      DELETE 
        FROM schedule_history
       WHERE user_id = ?
         AND league_id = ?
         AND play_date LIKE ?
         AND new_is_playing = old_is_playing
    `).run(target_user_id, leagueId, `${prefix}%`);

    // -------------------------------------------------------------------------
    // RETURN UPDATED SCHEDULE
    // -------------------------------------------------------------------------
    const rows = db.prepare(`
      SELECT date
           , is_playing
        FROM schedule
       WHERE user_id = ?
         AND league_id = ?
         AND date LIKE ?
       ORDER BY date
    `).all(target_user_id, leagueId, `${prefix}%`);

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
           AND league_id = ?
           AND month = ?
      `).run(target_user_id, leagueId, month);
    } else {
      db.prepare(`
        UPDATE user_play_months
           SET in_town = ?
         WHERE user_id = ?
           AND league_id = ?
           AND month = ?
      `).run(origInTownStatus, target_user_id, leagueId, month);
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
app.post("/admin/schedule/default/", (req, res) => {
  try {
    const target_user_id = req.body.target_user_id ?? req.query.target_user_id;
    const year  = Number(req.body.year  ?? req.query.year);
    const month = Number(req.body.month ?? req.query.month);
    const adminUserId = req.session.user?.id;
    const leagueId = req.session.user?.league_id;

    console.log(`>>> DEBUG: /admin/schedule/default/ - target_user_id: ${target_user_id},
       adminUserId: ${adminUserId}, year: ${year}, month: ${month}`);

    if (!target_user_id || !year || !month) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const adminRow = db.prepare(`
      SELECT is_admin
        FROM league_users
       WHERE user_id = ?
         AND league_id = ?
    `).get(adminUserId, leagueId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    // --- Build default schedule (no DB writes) ---
    const dayRows = db.prepare(`
      SELECT day_of_week
        FROM user_play_days
       WHERE user_id = ?
         AND league_id = ?
         AND is_play_day = 1
    `).all(target_user_id, leagueId);

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

app.post("/admin/schedule/clear/", (req, res) => {
  try {
    const adminUserId = req.session.user?.id;
    const leagueId = req.session.user?.league_id;
    const { target_user_id, year, month } = req.body;

    console.log(`>>> DEBUG: /admin/schedule/clear/ - 
       target_user_id: ${target_user_id},
       adminUserId: ${adminUserId}, year: ${year}, month: ${month}`);

    if (!target_user_id || !year || !month) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const adminRow = db.prepare(`
      SELECT is_admin
           , email
        FROM users
       WHERE user_id = ? 
        AND league_id = ?
    `).get(adminUserId, leagueId);

    if (!adminRow || adminRow.is_admin !== 1) {
      return res.status(403).json({ error: "Admin privileges required." });
    }

    const userRow = db.prepare(`
      SELECT id
        FROM logins
       WHERE id = ?
    `).get(target_user_id);

    if (!userRow) {
      return res.status(404).json({ error: "Target user not found." });
    }

    return res.json({
      status: "CLEARED",
      schedule: {}
    });

  } catch (err) {
    console.error("Admin override clear error:", err);
    return res.status(500).json({ error: "Server error clearing schedule." });
  }
});

app.get("/admin/schedule/:targetUserId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "schedule.html"));
});

app.post("/admin/leagues/api", requireSuperAdmin, (req, res) => {
  const { league_name, last_name, first_name, email, description } = req.body;

  if (!league_name) {
    return res.status(400).json({ error: "League name is required" });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO leagues (league_name, last_name, first_name, email, description)
      VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run(league_name, last_name, first_name, email, description);
    const newLeagueId = info.lastInsertRowid;

    req.session.user.league_id = newLeagueId;

    req.session.save(() => {
      res.json({
        success: true,
        newLeagueId,
        coordinator: {
          last_name,
          first_name,
          email,
          description
        }
      });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creating league" });
  }
});

app.post("/admin/allocated-tee-times", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;
  const { play_date, first_nine, tee_times } = req.body;

  if (!play_date || !first_nine || !Array.isArray(tee_times)) {
    return res.status(400).json({ error: "Missing play_date, first_nine, or tee_times array" });
  }

  try {
    // 1. Delete existing rows
    db.prepare(`
      DELETE 
        FROM allocated_tee_times
       WHERE league_id = ? 
         AND play_date = ?
    `).run(leagueId, play_date);

    // 2. Insert new rows
    const stmt = db.prepare(`
      INSERT INTO allocated_tee_times (play_date, league_id, tee_time_number, tee_time, first_nine)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const [index, time] of tee_times.entries()) {
      stmt.run(play_date, leagueId, index + 1, time, first_nine);
    }

    // 3. Verify
    const check = db.prepare(`
      SELECT tee_time_number, tee_time, first_nine
      FROM allocated_tee_times
      WHERE league_id = ? AND play_date = ?
      ORDER BY tee_time_number ASC
    `).all(leagueId, play_date);

    console.log("DB rows AFTER SAVE:", check);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/leagues/api/:id", requireSuperAdmin, (req, res) => {
  const leagueId = Number(req.params.id);

  try {
    const row = db.prepare(`
      SELECT EXISTS (
        SELECT 1
        FROM schedule
        WHERE league_id = ?
      ) AS schedule_data_exists
    `).get(leagueId);

    if (row.schedule_data_exists === 1) {
      return res.status(400).json({
        error: "Cannot delete league with existing schedule data"
      });
    }

    db.prepare(`DELETE FROM leagues WHERE id = ?`).run(leagueId);

    if (req.session.user.league_id === leagueId) {
      delete req.session.user.league_id;
    }

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error deleting league" });
  }
});

app.get("/admin/golfers/api", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;

  try {
    const rows = db.prepare(`
      SELECT id
           , first_name
           , last_name
           , email
           , is_admin
           , is_member
           , subgroup
           , subgroup_number
        FROM users
       WHERE league_id = ?
       ORDER BY last_name
              , first_name
    `).all(leagueId);

    res.json(rows);

  } catch (err) {
    console.error("❌ Error loading users:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

app.get("/admin/nines", requireAdminLoginOnly, (req, res) => {
  const leagueId = req.session.user.league_id;

  try {
    const rows = db.prepare(`
      SELECT id
           , nine
        FROM nines
       WHERE league_id = ?
       ORDER BY nine ASC
    `).all(leagueId);

    res.json({ nines: rows });

  } catch (err) {
    console.error("Error fetching nines:", err);
    res.status(500).json({ error: "Failed to load nines" });
  }
});

// Insert a row into both the logins and league_users tables for the golfer whose data was
// was entered via a modal and whose values come to the route via req.body.
app.post("/admin/golfers/api", requireLeagueAdmin, async (req, res) => {
  const leagueId = req.session.user.league_id;

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
    let newUserId;

    const insertGolferTx = db.transaction(() => {

      // 1. INSERT into logins
      // Does email id already exist? If so and the same league, throw an error.
      // If the email exists in a different league, allow it (since emails can be shared across leagues).
      const existingLogin = db.prepare(`
        SELECT id 
          FROM logins 
        WHERE email = ?
      `).get(email);

      if (existingLogin) {
        // Check if the existing user belongs to the same league.  That would be an error.
        // It is ok for the login to belong to a different league, but to belong to the same
        // league would be an error.
        newUserId = existingLogin.id
        console.log("/admin/golfers/api - email=", email, "existing login=", newUserId);

        const userLeague = db.prepare(`
          SELECT league_id 
            FROM league_users 
            WHERE user_id = ?
              AND league_id = ?
        `).get(newUserId, leagueId);

        console.log("/admin/golfers/api - league_users  leagueId = ", leagueId);

        if (userLeague) {
          return res.status(400).json({ error: "Email already exists for this league" });
        }

      } else {

        // login does not exist yet.  So we will create it.  Then we will query the logins
        // table to get the max login id which should be the one we just created.
        console.log("/admin/golfers/api - we are about to create a new login id for ",
                    "email, hashed, name of ", email, hashed, first_name, last_name);     

        const insertStmt = db.prepare(`
          INSERT INTO logins
            (email, password_hash, last_name, first_name)
          VALUES (?, ?, ?, ?)
          `).run(
            email,
            hashed,
            last_name,
            first_name
          ); 
          // 2. Retrieve the new user_id
          newUserId = db.prepare(`
          SELECT max(id) AS max_user_id
            FROM logins
          `).get().max_user_id;    
      }

      //const insertGolferTx = db.transaction(() => {
      console.log("/admin/golfers/api - the login id for golfer being added is ", newUserId);
      console.log("/admin/golfers/api - now we add a row to league_users");     

      // 3. INSERT into league_users
      const insertLUStmt = db.prepare(`
        INSERT INTO league_users
          (user_id, league_id, is_admin, is_member, subgroup, subgroup_number)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        newUserId,
        leagueId,
        is_admin ? 1 : 0,
        is_member ? 1 : 0,
        subgroup || "",
        subgroup_number ? String(parseInt(subgroup_number, 10)) : "",
      );

      if (insertLUStmt.changes === 1) {
        console.log("/admin/golfers/api - Insert into league_users succeeded");
      }

      // Initialize all 12 months
      const monthStmt = db.prepare(`
        INSERT INTO user_play_months (user_id, league_id, month, in_town)
        VALUES (?, ?, ?, ?)
      `);

      let one = 1;

      for (let m = 1; m <= 12; m++) {
        monthStmt.run(newUserId, leagueId, m, one);
        console.log("/admin/golfers/api - inserted into user_play_months month=", m);
      }

      // Initialize weekly play days
      const leagueDays = db.prepare(`
        SELECT day_of_week
          FROM league_play_days
        WHERE league_id = ?
          AND is_play_day = 1
        ORDER BY day_of_week ASC
      `).all(leagueId);

      const leaguePlayDays = leagueDays.map(r => r.day_of_week);

      const dayStmt = db.prepare(`
        INSERT INTO user_play_days (user_id, league_id, day_of_week, is_play_day)
        VALUES (?, ?, ?, ?)
      `);

      for (let dow = 0; dow <= 6; dow++) {
        dayStmt.run(newUserId, leagueId, dow, leaguePlayDays.includes(dow) ? 1 : 0);
        console.log("/admin/golfers/api - inserted into user_play_days dow=", dow,
                    " is_play_day=", leaguePlayDays.includes(dow) ? 1 : 0);
      }
    });
    
    // ⭐ Execute the transaction
    insertGolferTx();

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error adding golfer" });
  }
});

// ------------------------------
// UPDATE GOLFER
// ------------------------------
app.put("/admin/golfers/api/:id", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;
  const id = Number(req.params.id);

  const {
    first_name, last_name, email,
    is_admin, is_member, subgroup, subgroup_number
  } = req.body;

  if (subgroup && !/^[A-Z]$/.test(subgroup)) {
    return res.status(400).json({ error: "Invalid subgroup" });
  }

  if (subgroup_number && !(Number(subgroup_number) >= 1 && Number(subgroup_number) <= 9)) {
    return res.status(400).json({ error: "Invalid subgroup number" });
  }

  try {
    const updated = db.transaction(() => {
      const existing = db.prepare(`
        SELECT league_id
          FROM users
         WHERE id = ?
           AND league_id = ?
      `).get(id, leagueId);

      if (!existing || String(existing.league_id) !== String(leagueId)) {
        return false;
      }

      const loginUpdate = db.prepare(`
        UPDATE logins
          SET email = ?
            , last_name = ?
            , first_name = ?
        WHERE id = ?
      `).run(
        email,
        last_name,
        first_name,
        id
      );

      const leagueUserUpdate = db.prepare(`
        UPDATE league_users
          SET is_admin = ?
            , subgroup = ?
            , subgroup_number = ?
            , is_member = ?
        WHERE user_id = ?
          AND league_id = ?
      `).run(
        is_admin ? 1 : 0,
        subgroup || "",
        subgroup_number ? String(parseInt(subgroup_number, 10)) : "",
        is_member ? 1 : 0,
        id,
        leagueId
      );

      if (loginUpdate.changes !== 1 || leagueUserUpdate.changes !== 1) {
        throw new Error("Golfer update did not affect exactly one row per table");
      }

      return true;
    });

    if (!updated()) {
      return res.status(404).json({ error: "Golfer not found" });
    }

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating golfer" });
  }
});

app.delete("/admin/golfers/api/:id", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;
  const id = Number(req.params.id);

  try {
    const deleteGolferTx = db.transaction(() => {

      const existing = db.prepare(`
        SELECT league_id
          FROM users
         WHERE id = ? 
           AND league_id = ?
      `).get(id, leagueId);

      if (!existing || String(existing.league_id) !== String(leagueId)) {
        return res.status(404).json({ error: "Golfer not found. user id: " + id });
      }

      db.prepare(`
        DELETE 
          FROM league_users 
         WHERE user_id = ? 
           AND league_id = ?
        `).run(id, leagueId);
      
      db.prepare(`
        DELETE 
          FROM logins 
         WHERE id = ? 
        `).run(id);

    });

    // ⭐ Execute the transaction
    deleteGolferTx();

    res.json({ success: true });

  } catch (err) {
    console.error("DELETE golfer error:", err);

    if (err.code === "SQLITE_CONSTRAINT" || err.code === "SQLITE_CONSTRAINT_TRIGGER") {
      return res.status(409).json({
        error:
          "This golfer cannot be deleted because they have existing play history " +
          "(user_play_days or user_play_months). Please contact the DBA to remove " +
          "all dependent records before deleting this golfer."
      });
    }

    res.status(500).json({ error: "Error deleting golfer" });
  }
});

app.delete("/admin/allocated-tee-times/date/:play_date", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;
  const { play_date } = req.params;

  try {
    db.prepare(`
      DELETE 
        FROM allocated_tee_times
       WHERE league_id = ? 
         AND play_date = ?
    `).run(leagueId, play_date);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/allocated-tee-times/:id", requireLeagueAdmin, (req, res) => {
  const { id } = req.params;

  try {
    db.prepare(`
      DELETE 
        FROM allocated_tee_times
       WHERE id = ?
    `).run(id);
    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/golfers/api/:id/password", requireLeagueAdmin, async (req, res) => {
  const leagueId = req.session.user.league_id;
  const id = Number(req.params.id);
  const password = req.body.password;

  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }

  try {
    const existing = db.prepare(`
      SELECT league_id
        FROM users
       WHERE id = ?
         AND league_id = ?
    `).get(id, leagueId);

    if (!existing || String(existing.league_id) !== String(leagueId)) {
      return res.status(404).json({ error: "Golfer not found" });
    }

    const hashed = await bcrypt.hash(password, 10);

    db.prepare(`
      UPDATE logins
         SET password_hash = ?
       WHERE id = ? 
    `).run(hashed, id);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error resetting password" });
  }
});

app.put("/admin/allocated-tee-times/:id", requireLeagueAdmin, (req, res) => {
  const leagueId = req.session.user.league_id;
  const { id } = req.params;
  const { tee_time } = req.body;

  if (!tee_time) {
    return res.status(400).json({ error: "Missing tee_time" });
  }

  try {
    db.prepare(`
      UPDATE allocated_tee_times
         SET tee_time = ?
       WHERE id = ? 
         AND league_id = ?
    `).run(tee_time, id, leagueId);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/schedule", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "schedule.html"));
});

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
//  Extend calendar_dates table (4:25 AM Eastern) 
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
