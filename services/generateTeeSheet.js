// generateTeeSheet.js
const { generateTeeTimes } = require("./teeTimes");
const express = require("express");
const session = require("express-session");
const path = require("path");
delete require.cache[require.resolve("../db")];
const db = require("../db");
console.log("REQUIRING DB FROM:", require.resolve("../db"));
//const sqlite3 = require("sqlite3").verbose();
//const db = new sqlite3.Database("golf.db");
const app = express();
const { easternNow } = require("../utils/easternTime");
const transporter = require("../services/mailer");

// ------------------------------
// SQLite Promise Helpers
// ------------------------------
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
}
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// -------------------------------------------------------------------------------------------------
// HELPER FUNCTIONS
// -------------------------------------------------------------------------------------------------

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
// -------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------------------------------------------------
//  generate the tee sheet for two days from today (populate table: tee_sheet).
// ------------------------------------------------------------------------------------------------------------------------------------------
//  1)  Find the date that is two days from today. 
//       All data to be retrieved and processed is based on the date two days from today.
//  2)  Pull data from tables, schedule and guests and put into work_tee_sheet table.
//  3)  Get list of all leagues playing two days hence
//  --------------------------------------------
//  For each league playing two days hence ...
//  --------------------------------------------
//      4)  Use data from work_tee_sheet table to get all leagues that play two days from today.
//   4.5)  Create arrays needed to store tee sheet data until it is ready to load into tee_sheet
//            table.  the arrays will be put into a single context array.  It recreated for each league.
//      5)  Pull all guests in work_tee_sheet for league and play date and put into tee slots array
//      6)  Delete guests from work_tee_sheet
//      7)  if sponsors of guest(s) are associated with a subgroup, try to add (if any slots
//           available) other golfers having the same subgroup.
//      8) Subgroup golfers who have no subgroup golfer mates are converted to independent.
//           Similary if any subgroup has more than 4 golfers, those with the highest  subgroup
//           number are converted to independent.  Done thru update sql to work_tee_sheet table.
//      9)  Populate slots arrays with remaining subgroup golfers.
//     10) Populate slots arrays with independent golfers.
//     11) Retrieve starting times and starting nines from allocated_tee_times array and
//            populate the tee_sheet table.
// ------------------------------------------------------------------------------------------------------------------------------------------
async function A0000generateTeeSheetForAllLeagues() {

  const generatedBy = "CRON-8PM";

  const twoDaysHence = await A1000get2DaysHence();

  const pgmReturn = await B2000loadWorkTeeSheetArray(twoDaysHence);
  if (pgmReturn === "noData") return "noGolfTwoDaysHence";
  if (pgmReturn === "ERROR") return "ERROR";

  const leaguesReturn = await C3000getLeaguesPlayingTwoDaysHence(twoDaysHence);
  if (leaguesReturn === "noData") return "noLeaguesPlayingTwoDaysHence";
  if (leaguesReturn === "ERROR") return "ERROR";

  // ---------------------------------------------------------
  // Process each league independently
  // ---------------------------------------------------------
  for (const league of leaguesReturn) {

    // 1. Compute tee slot counts
    const teeSlots = D4000LoadSlotsPerTeeTimeArray(
      league.league_id,
      league.golfer_count
    );

    // 2. Create context object for this league
    const ctx = D4500createContext(teeSlots);

    // 3. Load guests into tee slots
    const rcE = await E5000LoadTeeSheetWithGuests(
      league.league_id,
      twoDaysHence,
      ctx
    );
    if (rcE === "ERROR") return "ERROR";

    // 4. Delete guests from work_tee_sheet
    const rcF = await F6000DeleteGuestsFromWorkTeeSheetTable(
      league.league_id,
      twoDaysHence
    );
    if (rcF === "ERROR") return "ERROR";

    // 5. Add subgroup golfers (if any)
    const rcG = await G7000LoadAnySubgroupGolfers(
      league.league_id,
      twoDaysHence,
      ctx
    );
    if (rcG === "ERROR") return "ERROR";

    // 6. Update subgroup values (convert overflow to independent)
    const rcH = await H8000UpdateSubgroupValues(
      league.league_id,
      twoDaysHence
    );
    if (rcH === "ERROR") return "ERROR";

    // 7. Load subgroup golfers into tee slots
    const rcI = await I9000getSubgroupGolfers(
      league.league_id,
      twoDaysHence,
      ctx
    );
    if (rcI === "ERROR") return "ERROR";

    // 8. Load independent golfers into tee slots
    const rcJ = await J10000populateIndependentGolfers(
      league.league_id,
      twoDaysHence,
      ctx
    );
    if (rcJ === "ERROR") return "ERROR";

    // 9. Delete tee_sheet table data for current league and play date.
    const rcK = await K10500DeleteLeagueDataFromTeeSheetTable(
      league.league_id,
      twoDaysHence,
    ); 
    if (rcK === "ERROR") return "ERROR";

    // 10. Populate tee_sheet table
    const rcL = await L11000populateTeeSheetTable(
      league.league_id,
      twoDaysHence,
      ctx,
      generatedBy
    );
      if (rcL === "ERROR") return "ERROR";

    // 11. Delete from tee_sheet_working table for league & play date
    const rcM = await M12000DeleteLeagueDataFromTeeSheetWorking(
      league.league_id,
      twoDaysHence,
    ); 
      if (rcM === "ERROR") return "ERROR";

    // 12. Populate tee_sheet_working table for league & play date
    const rcN = await N13000LoadTeeSheetWorking(
      league.league_id,
      twoDaysHence,
      generatedBy
    ); 
      if (rcN === "ERROR") return "ERROR";

    // 13. Populate tee_sheet_working table for league & play date
    // uncomment 5 lines immediately below to automatically send tee sheet email
//    const rcO = await O14000SendTeeSheetEmail(
//      league.league_id,
//      twoDaysHence
//    ); 
//if (rcO === "ERROR") return "ERROR";

 }

  return "SUCCESS";
}
   
// ---------------------------------------------------------------------------------------------------
// generate the TeeSheet for a specific league and specific playDate
// At the end we must also populate table, tee_sheet_working, too.
// ---------------------------------------------------------------------------------------------------
async function A0500generateTeeSheetForLeagueAndDate(leagueId, playDate, generatedBy) {

  await A0550validateLeagueAndDate(leagueId, playDate);

  // - reload work_tee_sheet for the passed league and playdate
  const rcWork25 = await B2500loadWorkTeeSheetArray(leagueId, playDate);
  if (rcWork25 === "noData") {
    throw new Error("No golfers found for that date");
  }
  if (rcWork25 === "ERROR") {
    throw new Error("Error loading work_tee_sheet");
  }
  // if there was data successfully loaded into the work_tee_sheet table,
  // then the number of players inserted into work_tee_sheet table is in rcWork25
  // The number of golfers is needed when calling D4000.
  const golfersCount = rcWork25;

  // 1. Compute tee slot counts  
      const teeSlots = D4000LoadSlotsPerTeeTimeArray(
      leagueId,
      golfersCount
    );

  const ctx = D4500createContext(teeSlots);

  const rcE = await E5000LoadTeeSheetWithGuests(leagueId, playDate, ctx);
  if (rcE === "ERROR") return "ERROR";

  const rcF = await F6000DeleteGuestsFromWorkTeeSheetTable(leagueId, playDate);
  if (rcF === "ERROR") return "ERROR";

  const rcG = await G7000LoadAnySubgroupGolfers(leagueId, playDate, ctx);
  if (rcG === "ERROR") return "ERROR";

  const rcH = await H8000UpdateSubgroupValues(leagueId, playDate);
  if (rcH === "ERROR") return "ERROR";

  const rcI = await I9000getSubgroupGolfers(leagueId, playDate, ctx);
  if (rcI === "ERROR") return "ERROR";

  const rcJ = await J10000populateIndependentGolfers(leagueId, playDate, ctx);
  if (rcJ === "ERROR") return "ERROR";

  const rcK = await K10500DeleteLeagueDataFromTeeSheetTable(leagueId, playDate);
  if (rcK === "ERROR") return "ERROR";

  const rcL = await L11000populateTeeSheetTable(leagueId, playDate, ctx, generatedBy);
  if (rcL === "ERROR") return "ERROR";

  const rcM = await M12000DeleteLeagueDataFromTeeSheetWorking(leagueId, playDate) ;
  if (rcM === "ERROR") return "ERROR";

  const rcN = await N13000LoadTeeSheetWorking(leagueId, playDate, generatedBy);
  if (rcN === "ERROR") return "ERROR";

  return "SUCCESS";
}

// ------------------------------------------------------------------------------------------------------------------------------------------
//  validate the passed leagueId and the passed playDate
// ------------------------------------------------------------------------------------------------------------------------------------------
async function A0550validateLeagueAndDate(leagueId, playDate) {
  const league = await dbAll(
    `SELECT * FROM leagues WHERE id = ?`,
    [leagueId]
  );
  if (!league || league.length === 0) {
    throw new Error(`League ${leagueId} not found`);
  }

  const leagueRow = league[0];

  const playDateObj = parseLocalDate(playDate);
  const today = new Date();
  const diffDays = Math.floor(
    (stripTime(playDateObj) - stripTime(today)) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 0) {
    throw new Error("Play date must be in the future");
  }
  if (diffDays > 7) {
    throw new Error("Play date must be within 7 days");
  }
}

// -------------------------------------------------------------------
// determine what the yyyy-mm-dd date is two
// days from now and return it to the caller.
// -------------------------------------------------------------------
async function A1000get2DaysHence() {
  try {
    const ts = easternNow();   // already Eastern, already SQLite format

    const row = await dbGet(
      `SELECT date(datetime(?, '+2 days')) AS two_days_hence`,
      [ts]
    );
    console.log("A1000 - row.two_days_hence = ", row.two_days_hence);
    return row?.two_days_hence || "ERROR";

  } catch (err) {
    console.error("A1000 error:", err);
    return "Server error";
  }
}

  // --------------------------------------------------------------------------------------------------
  //        Using Schedule data and guest data, load the data
  //       of golfers playing on a specified date.  Load the
  //       data into a table:  work_tee_sheet.
  //       1)  delete all data from work_tee_sheet for the passedPlayDate
  //       2)  Using data from tables:  schedule and guests, INSERT
  //            golfer data into work_tee_sheet table
  // ---------------------------------------------------------------------------------------------------
  async function B2000loadWorkTeeSheetArray(passedPlayDate) {
    
  // 1) delete all data in the work_tee_sheet table for the passedPlayDate

  try {
     const delResult = await dbRun(
          `DELETE FROM WORK_TEE_SHEET
           WHERE play_date = ?`,
           [ passedPlayDate ]
     );
     console.log("B2000 ", delResult.changes, "rows deleted from table work_tee_sheet ", 
                            "for play_date = ", passedPlayDate );

    // 2. Insert new rows into table, work_tee_sheet, for the selected play_date
     insertResult = await dbRun(
      `WITH 
          member_players AS (
              SELECT 
                   ? as play_date
                  , email
                  , users.league_id
                  , users.email
                  , subgroup 
                  , subgroup_number
                  , users.id as user_id
                  , users.last_name
                  , users.first_name
                  , CASE WHEN users.is_member = 0 THEN ' *' ELSE '' END AS asterisk_suffix
                  , users.id as sponsor_id
              FROM schedule
              JOIN users ON users.id = schedule.user_id
              WHERE schedule.date = ?
                    AND schedule.is_playing = 1
            ),

            guest_players AS (
              SELECT
                 ? as play_date
                , email
                , users.league_id
                , CASE WHEN guest_email IS NULL THEN users.email ELSE guest_email END AS email
                , subgroup 
                , subgroup_number
                , guests.id as user_id
                , guest_last_name  as last_name
                , guest_first_name as first_name
                , ' **' as asterisk_suffix
                , sponsor_user_id as sponsor_id
              FROM guests
              JOIN users ON users.id = guests.sponsor_user_id
              WHERE (
              guests.date1 = ? OR
                    guests.date2 = ? OR
                    guests.date3 = ? OR
                    guests.date4 = ? OR
                    guests.date5 = ? 
                    )
            )
      INSERT INTO work_tee_sheet (
                  play_date
                , league_id
                , email
                , subgroup 
                , subgroup_number
                , user_id
                , last_name
                , first_name
                , asterisk_suffix
                , sponsor_id
      )

      SELECT
                  play_date
                , league_id
                , email
                , subgroup 
                , subgroup_number
                , user_id
                , last_name
                , first_name
                , asterisk_suffix
                , sponsor_id
      FROM member_players
      UNION ALL
      SELECT
                  play_date
                , league_id
                , email
                , subgroup 
                , subgroup_number
                , user_id
                , last_name
                , first_name
                , asterisk_suffix
                , sponsor_id
      FROM guest_players`,
      [ passedPlayDate, passedPlayDate, passedPlayDate, passedPlayDate, 
        passedPlayDate, passedPlayDate, passedPlayDate, passedPlayDate ]
    );

    if (insertResult.changes === 0) {
        console.log("⏰ Service, generateTeeSheet did not find any golfers playing twoDaysFromNow=",
                    passedPlayDate); 
        return "noData";        
      }
    console.log("⏰ B2000 - Service, generateTeeSheet successfully loaded work_tee_sheet table",
                " for play_date = ", passedPlayDate, "players added count = ", insertResult.changes);
    return "Success";

  } catch (err) {
    console.error(err);
    return "ERROR";
  }
}

  // --------------------------------------------------------------------------------------------------
  //       Using Schedule data and guest data, load the data of golfers
  //       playing in a specified league and on a specified date.  Load the
  //       data into the table:  work_tee_sheet.
  //       1)  delete all data from work_tee_sheet for the
  //            passed league and passedPlayDate
  //       2)  Using data from tables:  schedule and guests, INSERT
  //            golfer data into work_tee_sheet table
  // ---------------------------------------------------------------------------------------------------
  async function B2500loadWorkTeeSheetArray(passedLeague, passedPlayDate) {
    
  // 1) delete all data in the work_tee_sheet table for the passedPlayDate

  try {
     const delResult = await dbRun(
          `DELETE FROM WORK_TEE_SHEET
           WHERE play_date = ?
                  AND league_id = ?`,
           [ passedPlayDate, passedLeague  ]
     );
     console.log("B2500 ", delResult.changes, "rows deleted from table work_tee_sheet ", 
                            "for league = ", passedLeague, " and play_date = ", passedPlayDate );

    // 2. Insert new rows into table, work_tee_sheet, for the selected play_date
     const insertPlayers = await dbRun(
      `WITH 
          member_players AS (
              SELECT 
                   ? as play_date
                  , email
                  , users.league_id
                  , users.email
                  , subgroup 
                  , subgroup_number
                  , users.id as user_id
                  , users.last_name
                  , users.first_name
                  , CASE WHEN users.is_member = 0 THEN ' *' ELSE '' END AS asterisk_suffix
                  , users.id as sponsor_id
              FROM schedule
              JOIN users ON users.id = schedule.user_id
              WHERE schedule.date = ?
                    AND users.league_id = ?
                    AND schedule.is_playing = 1
            ),

            guest_players AS (
              SELECT
                 ? as play_date
                , email
                , users.league_id
                , CASE WHEN guest_email IS NULL THEN users.email ELSE guest_email END AS email
                , subgroup 
                , subgroup_number
                , guests.id as user_id
                , guest_last_name  as last_name
                , guest_first_name as first_name
          , ' **' as asterisk_suffix
          , sponsor_user_id as sponsor_id
              FROM guests
              JOIN users ON users.id = guests.sponsor_user_id
                 AND users.league_id = ?
              WHERE (
              guests.date1 = ? OR
                    guests.date2 = ? OR
                    guests.date3 = ? OR
                    guests.date4 = ? OR
                    guests.date5 = ? 
                    )
            )
      INSERT INTO work_tee_sheet (
                  play_date
                , league_id
                , email
                , subgroup 
                , subgroup_number
                , user_id
                , last_name
                , first_name
                , asterisk_suffix
                , sponsor_id
      )

      SELECT
                  play_date
                , league_id
                , email
                , subgroup 
                , subgroup_number
                , user_id
                , last_name
                , first_name
                , asterisk_suffix
                , sponsor_id
      FROM member_players
      UNION ALL
      SELECT
                  play_date
                , league_id
                , email
                , subgroup 
                , subgroup_number
                , user_id
                , last_name
                , first_name
                , asterisk_suffix
                , sponsor_id
      FROM guest_players`,
      [ passedPlayDate, passedPlayDate, passedLeague, passedPlayDate,  passedLeague,
        passedPlayDate, passedPlayDate, passedPlayDate, passedPlayDate, passedPlayDate ]
    );

    if (insertPlayers.changes === 0) {
        console.log("⏰ Service, generateTeeSheet did not find any golfers playing in league=",
                    passedLeague, " and on playDate=", passedPlayDate); 
        return "noData";        
      }

    console.log("⏰ B2500 - Service, generateTeeSheet successfully loaded work_tee_sheet table",
                " for league = ", passedLeague, " and for play_date = ", passedPlayDate,
                "players added count = ", insertPlayers.changes);
    const golfersCount = insertPlayers.changes
    return golfersCount;

  } catch (err) {
    console.error(err);
    return "ERROR";
  }
}

// ----------------------------------------------------------------------------------
// get array of leagues playing two days hence from work_tee_sheet table.
// For each league, get count of golfers playing two days hence. 
// Return array of league_id and golfer_count to calling function.  
// If no leagues are playing two days hence, return code of "noData" to calling function.
// --------------------------------------------------------------------------------
async function C3000getLeaguesPlayingTwoDaysHence(twoDaysHence) {

try {
  const rows = await dbAll(
    `SELECT league_id
          , count(*) as golfer_count
       FROM work_tee_sheet
      WHERE play_date = ?
      GROUP BY league_id`,
    [twoDaysHence]
  );

  if (rows.length === 0) {
    console.log("⏰ Service, generateTeeSheet did not return any leagues golfing twoDaysFromNow=", twoDaysHence);
    return "noData";    // return code of "noData" means no leagues are playing two days from today.        
  }
  console.log("C3000 - league id(s) and counts of golfers playing on ", twoDaysHence, " = ", rows)
  return rows;  // return array of league_id and golfer_count to calling function.
    } catch (err) {
      console.error("❌ Error Service, generateTeeSheet failed to get leagues for date = ",
         twoDaysHence, " Error:", err);
      return "ERROR";
    }
}
// ---------------------------------------------------------------------------------------
//    Divide the number of golfers (for current play date and league) by 4 and keep remainder.
//    If remainder is zero, then tee count = quotient else tee_count = quotient + 1.  If total players = 5,
//    then slot-count(1) = 2  and slot-count(2) = 3.  If total players > 5, then if remainder = 1
//    then slot-count(1 2 3)= (3 3 3). if remainder = 2, then slot-count (1 2) = (3 3).
//    if remainder = 3, then slot-count(1) = 3. All other slot-count values should be 4.
// ---------------------------------------------------------------------------------
function D4000LoadSlotsPerTeeTimeArray(leagueId, golferCount) {

  let quotient = Math.floor(golferCount / 4);
  let remainder = golferCount % 4;
  let teeCount = (remainder === 0) ? quotient : quotient + 1;
  let slotCounts = new Array(teeCount + 1).fill(4);
  slotCounts[0] = 0;  
  //  slotCounts(0) is not used because tee times are numbered starting with 1. 
  //  This makes it easier to understand the code that assigns slot counts to tee times because the
  //  tee time number will match the slot count array index.  For example, if tee time 1 has a
  //  slot count of 3, then slotCounts(1) will be 3.
  let prevSponsorId = "";
  if (golferCount < 5) {
      teeCount = 1;
      slotCounts[1] = golferCount;
    } else 
  if (golferCount === 5) {
      slotCounts[1] = 2;
      slotCounts[2] = 3;
    } else
  if (remainder === 1) {
      slotCounts[1] = 3;
      slotCounts[2] = 3;
      slotCounts[3] = 3;
    } else 
  if (remainder === 2) {
      slotCounts[1] = 3;
      slotCounts[2] = 3;
    } else
  if (remainder === 3) {
        slotCounts[1] = 3;
    }
  console.log("D4000 - slotCount array = ", slotCounts);

  return slotCounts;  // return array of slot counts per tee time to calling function.
}

// -------------------------------------------------------------------------------------------------------------------------------------------
//  We have to pull data from multiple tables and store it in javascript arrays.  In this function,
//  we create all of the arrays to store the data needed to create INSERT sql to load the
//  the tee_sheet table (which will occur in the L11000- function).
// -------------------------------------------------------------------------------------------------------------------------------------------
function D4500createContext(teeSlots) {
  const n = teeSlots.length;
  

  return {
    teeSlots,
    calcTeeTimeCount: n - 1,
    currTeeTimeCount: n - 1,

    userId1: new Array(n),
    lastName1: new Array(n),
    firstName1: new Array(n),
    userId2: new Array(n),
    lastName2: new Array(n),
    firstName2: new Array(n),
    userId3: new Array(n),
    lastName3: new Array(n),
    firstName3: new Array(n),
    userId4: new Array(n),
    lastName4: new Array(n),
    firstName4: new Array(n),

    subgroup1: new Array(n),
    openSlot: new Array(n).fill(1),

    prevSponsorId: null,
    rowNum: 1,

    // optional: a place to store return codes
    rc: {}
  };
}

// -----------------------------------------------------------------------------
// E5000 - Load guests into tee slots (ctx)
// -----------------------------------------------------------------------------
// This function:
//   • Reads guest/sponsor pairs from work_tee_sheet
//   • Places them into the tee-slot arrays inside ctx
//   • Updates ctx.currTeeTimeCount, ctx.openSlot, ctx.subgroup1, etc.
//   • Returns "SUCCESS" or "ERROR"
// -----------------------------------------------------------------------------
async function E5000LoadTeeSheetWithGuests(leagueId, playDate, ctx) {

  try {
    // -------------------------------------------------------------
    // 1. Query guest/sponsor pairs
    // -------------------------------------------------------------
    const guestResults = await dbAll(
      `SELECT 
          W2.last_name       AS sponsor_last_name,
          W2.first_name      AS sponsor_first_name,
          W1.user_id         AS guest_id,
          W1.last_name       AS guest_last_name,
          W1.first_name      AS guest_first_name,
          W1.asterisk_suffix AS guest_asterisk_suffix,
          W2.asterisk_suffix AS sponsor_asterisk_suffix,
          W2.sponsor_id      AS sponsor_id,
          W1.sponsor_id      AS guest_sponsor_id,
          W1.subgroup        AS guest_subgroup
       FROM work_tee_sheet W1
       JOIN work_tee_sheet W2
         ON W2.sponsor_id = W1.sponsor_id
        AND W2.play_date = W1.play_date
        AND W2.league_id = W1.league_id
       WHERE W1.asterisk_suffix LIKE '%**%'      -- guest
         AND W2.asterisk_suffix NOT LIKE '%**%'  -- sponsor
         AND W1.play_date = ?
         AND W1.league_id = ?
         AND (W1.first_name || W1.last_name) <> (W2.first_name || W2.last_name)
       ORDER BY sponsor_last_name, sponsor_first_name`,
      [playDate, leagueId]
    );

    // -------------------------------------------------------------
    // 2. No guests? That's fine — mark ctx and return success
    // -------------------------------------------------------------
    if (guestResults.length === 0) {
      console.log(`No guests found for league ${leagueId} on ${playDate}`);
      ctx.lastName1[0] = "No Guests Found";
      return "SUCCESS";
    }

    console.log(
      `E5000 - ${guestResults.length} guest rows returned for league ${leagueId} on ${playDate}`
    );

    // -------------------------------------------------------------
    // 3. Process guest rows
    // -------------------------------------------------------------
    let prevSponsorId = null;
    let rowNum = 1;

    for (const row of guestResults) {

      const i = ctx.currTeeTimeCount;   // current tee time index

      // ---------------------------------------------------------
      // FIRST guest/sponsor pair
      // ---------------------------------------------------------
      if (rowNum === 1) {

        ctx.userId1[i] = row.sponsor_id;
        ctx.lastName1[i]  = row.sponsor_last_name + row.sponsor_asterisk_suffix;
        ctx.firstName1[i] = row.sponsor_first_name;

        ctx.userId2[i] =    row.guest_id;
        ctx.lastName2[i]  = row.guest_last_name + row.guest_asterisk_suffix;
        ctx.firstName2[i] = row.guest_first_name;

        ctx.openSlot[i] = 3;   // next open slot is #3
        rowNum++;
        prevSponsorId = row.sponsor_id;
        continue;
      }

      // ---------------------------------------------------------
      // SAME sponsor as previous row
      // ---------------------------------------------------------
      if (row.sponsor_id === prevSponsorId) {

        const slot = ctx.openSlot[i];

        if (slot === 3) {
          // fill slot #3
          ctx.userId3[i]    = row.guest_id;
          ctx.lastName3[i]  = row.guest_last_name + row.guest_asterisk_suffix;
          ctx.firstName3[i] = row.guest_first_name;
          ctx.openSlot[i]   = 4;

          // if teeSlots[i] == 3, this tee time is now full → move to next tee time
          if (ctx.teeSlots[i] === 3) {
            ctx.currTeeTimeCount--;
            ctx.openSlot[ctx.currTeeTimeCount] = 1;
          }

        } else if (slot === 4) {
          // fill slot #4
          ctx.userId4[i]    = row.guest_id;
          ctx.lastName4[i]  = row.guest_last_name + row.guest_asterisk_suffix;
          ctx.firstName4[i] = row.guest_first_name;
          ctx.openSlot[i]   = 5;

          ctx.currTeeTimeCount--;
          ctx.openSlot[ctx.currTeeTimeCount] = 1;

        } else if (slot === 1) {
          // fill slot #1
          ctx.userId1[i]    = row.guest_id;
          ctx.lastName1[i]  = row.guest_last_name + row.guest_asterisk_suffix;
          ctx.firstName1[i] = row.guest_first_name;
          ctx.subgroup1[i]  = row.guest_subgroup;
          ctx.openSlot[i]   = 2;

        } else {
          // fill slot #2
          ctx.userId2[i]    = row.guest_id;
          ctx.lastName2[i]  = row.guest_last_name + row.guest_asterisk_suffix;
          ctx.firstName2[i] = row.guest_first_name;
          ctx.openSlot[i]   = 3;
        }

        continue;
      }

      // ---------------------------------------------------------
      // NEW sponsor → move to next tee time
      // ---------------------------------------------------------
      if (ctx.openSlot[i] !== 1) {
        ctx.currTeeTimeCount++;
      }

      const j = ctx.currTeeTimeCount;
      ctx.userId1[j]    = row.guest_id;
      ctx.lastName1[j]  = row.sponsor_last_name + row.sponsor_asterisk_suffix;
      ctx.firstName1[j] = row.sponsor_first_name;
      
      ctx.subgroup1[j]  = row.guest_subgroup;

      ctx.userId2[j]    = row.guest_id;
      ctx.lastName2[j]  = row.guest_last_name + row.guest_asterisk_suffix;
      ctx.firstName2[j] = row.guest_first_name;

      ctx.openSlot[j]   = 3;
      prevSponsorId     = row.sponsor_id;
    }

    // -------------------------------------------------------------
    // 4. Mark success
    // -------------------------------------------------------------
    ctx.lastName1[0] = "Success";
    return "SUCCESS";

  } catch (err) {
    console.error("E5000 error:", err);
    ctx.lastName1[0] = "ERROR";
    return "ERROR";
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------------------
// F6000 - Delete guests from work_tee_sheet for this league & play_date
// -----------------------------------------------------------------------------
// Guests are identified by asterisk_suffix = '**'.
// After E5000 loads guests into ctx, we remove them from work_tee_sheet so they
// are not double-counted when subgroup and independent golfers are processed.
// -----------------------------------------------------------------------------
async function F6000DeleteGuestsFromWorkTeeSheetTable(leagueId, playDate) {
  try {
       const delResultSponsor = await dbRun(
       `DELETE FROM work_tee_sheet
         WHERE play_date = ?
           AND league_id = ?
           AND asterisk_suffix NOT LIKE '%**%'
           AND EXISTS (SELECT 1
                         FROM work_tee_sheet E
                        WHERE E.play_date = ?
                          AND E.league_id = ?
                          AND E.asterisk_suffix LIKE '%**%'
                          AND work_tee_sheet.sponsor_id = E.sponsor_id)`,
       [playDate, leagueId, playDate, leagueId]
       );
      console.log(
      `F6000 - ${delResultSponsor.changes} sponsor rows deleted from work_tee_sheet for
       league_id=${leagueId}, play_date=${playDate}`
      );

       const delResult = await dbRun(
       `DELETE FROM work_tee_sheet
         WHERE play_date = ?
           AND league_id = ?
           AND asterisk_suffix LIKE '%**%'`,
        [playDate, leagueId]
      );

      console.log(
        `F6000 - ${delResult.changes} guest rows deleted from work_tee_sheet for league_id=${leagueId},
         play_date=${playDate}`
      );

      return "SUCCESS";

  } catch (err) {
    console.error("F6000 error deleting sponsor(s) or guest(s):", err);
    return "ERROR";
  }
}

// -----------------------------------------------------------------------------
// G7000 - Load subgroup golfers into tee slots (ctx)
// -----------------------------------------------------------------------------
// For each subgroup used by guests (ctx.subgroup1), retrieve golfers from
// work_tee_sheet who share that subgroup. Insert them into the tee-slot arrays
// (ctx.lastName1..4, ctx.firstName1..4) and delete them from work_tee_sheet.
// -----------------------------------------------------------------------------
async function G7000LoadAnySubgroupGolfers(leagueId, playDate, ctx) {
  try {
    // -------------------------------------------------------------
    // Identify all subgroups referenced by guests
    // (ctx.subgroup1[i] contains subgroup letters)
    // -------------------------------------------------------------
    const subgroups = new Set();

    for (let i = 1; i <= ctx.calcTeeTimeCount; i++) {
      const sg = ctx.subgroup1[i];
      if (sg && sg >= "A" && sg <= "Z") {
        subgroups.add(sg);
      }
    }

    if (subgroups.size === 0) {
      console.log(`No subgroup golfers needed for league ${leagueId}`);
      return "SUCCESS";
    }

    // -------------------------------------------------------------
    // Process each subgroup independently
    // -------------------------------------------------------------
    for (const subgroup of subgroups) {

      const subgroupResults = await dbAll(
        `SELECT user_id, last_name, first_name, subgroup,
                subgroup_number, asterisk_suffix
           FROM work_tee_sheet
          WHERE play_date = ?
            AND league_id = ?
            AND subgroup = ?
          ORDER BY subgroup_number ASC`,
        [playDate, leagueId, subgroup]
      );

      if (subgroupResults.length === 0) {
        console.log(`G7000 - No subgroup golfers found for subgroup ${subgroup}`);
        continue;
      }

      console.log(
        `G7000 - ${subgroupResults.length} subgroup golfers found for subgroup ${subgroup}`
      );

      // ---------------------------------------------------------
      // Insert subgroup golfers into tee slots
      // ---------------------------------------------------------
      for (const row of subgroupResults) {

        const i = ctx.currTeeTimeCount;
        const slot = ctx.openSlot[i];

        console.log(
          `Placing subgroup golfer ${row.first_name} ${row.last_name}${row.asterisk_suffix} into tee time ${i}, slot ${slot}`
        );

        if (slot === 3) {
          ctx.userId3[i]    = row.user_id;
          ctx.lastName3[i]  = row.last_name + row.asterisk_suffix;
          ctx.firstName3[i] = row.first_name;
          ctx.openSlot[i]   = 4;

        } else if (slot === 4 && ctx.teeSlots[i] === 4) {
          ctx.userId4[1]    = row.user_id;
          ctx.lastName4[i]  = row.last_name + row.asterisk_suffix;
          ctx.firstName4[i] = row.first_name;
          ctx.openSlot[i]   = 5;  // full

        } else {
          // No valid slot → skip
          console.log(`No open slot for subgroup golfer at tee time ${i}`);
          continue;
        }

        // -----------------------------------------------------
        // Delete golfer from work_tee_sheet
        // -----------------------------------------------------
        const rcDel = await G7100DeleteGolferFromWorkTable(
          leagueId,
          playDate,
          row.user_id,
          row.last_name,
          row.first_name,
          row.asterisk_suffix,
          row.subgroup,
          row.subgroup_number
        );

        if (rcDel === "ERROR") {
          console.error("G7000 - Error deleting subgroup golfer from work_tee_sheet");
          return "ERROR";
        }
      }
    }

    return "SUCCESS";

  } catch (err) {
    console.error("G7000 error:", err);
    return "ERROR";
  }
}

// -----------------------------------------------------------------------------
// G7100 - Delete a single golfer from work_tee_sheet
// -----------------------------------------------------------------------------
async function G7100DeleteGolferFromWorkTable(
  leagueId,
  playDate,
  userId,
  lastName,
  firstName,
  asteriskSuffix,
  subgroup,
  subgroupNumber
) {
  try {
    const delResult = await dbRun(
      `DELETE FROM work_tee_sheet
         WHERE play_date = ?
           AND league_id = ?
           AND last_name = ?
           AND first_name = ?
           AND asterisk_suffix = ?
           AND subgroup = ?
           AND subgroup_number = ?`,
      [
        playDate,
        leagueId,
        lastName,
        firstName,
        asteriskSuffix,
        subgroup,
        subgroupNumber
      ]
    );

    console.log(
      `G7100 - ${delResult.changes} row deleted from work_tee_sheet for golfer ${firstName} 
       ${lastName}${asteriskSuffix}, subgroup ${subgroup}, number ${subgroupNumber}`
    );

    return "SUCCESS";

  } catch (err) {
    console.error("G7100 error:", err);
    return "ERROR";
  }
}

// -----------------------------------------------------------------------------
// H8000 - Update subgroup values in work_tee_sheet
// -----------------------------------------------------------------------------
// 1. Any subgroup that appears only once → set subgroup = '' (independent)
// 2. Any subgroup with more than 4 golfers → convert the *highest subgroup_number*
//    golfer(s) to subgroup = '' so that no subgroup exceeds 4 players.
// -----------------------------------------------------------------------------
async function H8000UpdateSubgroupValues(leagueId, playDate) {
  try {
    // -------------------------------------------------------------------------
    // STEP 1 — Convert orphaned subgroups (count = 1) to independent
    // -------------------------------------------------------------------------
    const upd1 = await dbRun(
      `UPDATE work_tee_sheet
          SET subgroup = ''
        WHERE league_id = ?
          AND play_date = ?
          AND subgroup IN (
                SELECT subgroup
                  FROM work_tee_sheet
                 WHERE league_id = ?
                   AND play_date = ?
                   AND subgroup <> ''
              GROUP BY subgroup
                HAVING COUNT(*) = 1
          )`,
      [leagueId, playDate, leagueId, playDate]
    );

    console.log(
      `H8000: Updated ${upd1.changes} orphaned subgroup golfers to independent (league ${leagueId},
       date ${playDate})`
    );

    // -------------------------------------------------------------------------
    // STEP 2 — Convert overflow subgroup golfers (count > 4) to independent
    //
    // Logic:
    //   For each subgroup with > 4 golfers:
    //     - Identify the golfer(s) with the highest subgroup_number
    //     - Convert those golfers to subgroup = ''
    //
    // This ensures no subgroup exceeds 4 golfers.
    // -------------------------------------------------------------------------
    const upd2 = await dbRun(
      `UPDATE work_tee_sheet
                SET subgroup = ''
        WHERE league_id = ?
               AND play_date = ?
               AND (subgroup || CAST(subgroup_number AS TEXT)) IN (
                         SELECT subgroup || CAST(MAX(subgroup_number) AS TEXT)
                              FROM work_tee_sheet
                           WHERE league_id = ?
                                  AND play_date = ?
                                  AND subgroup IN (
                                           SELECT subgroup
                                                FROM work_tee_sheet
                                             WHERE league_id = ?
                                                    AND play_date = ?
                                                    AND subgroup <> ''
                                        GROUP BY subgroup
                                              HAVING COUNT(*) > 4
                   )
              GROUP BY subgroup
          )`,
      [leagueId, playDate, leagueId, playDate, leagueId, playDate]
    );

    console.log(
      `H8000: Updated ${upd2.changes} overflow subgroup golfers to independent (league ${leagueId}, date ${playDate})`
    );

    return "SUCCESS";

  } catch (err) {
    console.error("H8000 error:", err);
    return "ERROR";
  }
}
// -----------------------------------------------------------------------------
// I9000 - Load subgroup golfers (after H8000 normalization)
// -----------------------------------------------------------------------------
// This step:
//   • Selects all remaining subgroup golfers (subgroup != '')
//   • Groups them by subgroup
//   • For each subgroup, finds a tee time with enough open slots
//   • Places subgroup golfers into that tee time
//   • Marks tee time as full when appropriate
//   • Does NOT delete them from work_tee_sheet (no need)
// -----------------------------------------------------------------------------
async function I9000getSubgroupGolfers(leagueId, playDate, ctx) {
  try {
    // -------------------------------------------------------------------------
    // STEP 1 — Get subgroup counts
    // -------------------------------------------------------------------------
    const subgroupCounts = await dbAll(
      `SELECT subgroup
            , COUNT(*) AS subgroup_count
         FROM work_tee_sheet
        WHERE play_date = ?
          AND league_id = ?
          AND subgroup <> ''
        GROUP BY subgroup
        ORDER BY subgroup_count DESC`,
      [playDate, leagueId]
    );

    if (subgroupCounts.length === 0) {
      console.log(
        `I9000: No subgroup golfers for league ${leagueId} on ${playDate}`
      );
      return "SUCCESS";
    }

    console.log(
      `I9000: Found ${subgroupCounts.length} subgroups for league ${leagueId}
       on ${playDate} ... ${subgroupCounts}`
    );

    // -------------------------------------------------------------------------
    // STEP 2 — Process each subgroup
    // -------------------------------------------------------------------------
    for (const row of subgroupCounts) {
      const subgroup = row.subgroup;
      const countNeeded = row.subgroup_count;

      // -----------------------------------------------------
      // Get golfers in this subgroup
      // -----------------------------------------------------
      const subgroupGolfers = await dbAll(
        `SELECT subgroup_number
              , user_id
              , last_name
              , first_name
              , asterisk_suffix
           FROM work_tee_sheet
          WHERE play_date = ?
            AND league_id = ?
            AND subgroup = ?
       ORDER BY subgroup_number ASC`,
        [playDate, leagueId, subgroup]
      );

      if (subgroupGolfers.length === 0) continue;

      // -----------------------------------------------------
      // Find a tee time with enough open slots
      // We search from LAST tee time backward
      // -----------------------------------------------------
      let freeTeeTime = 0;

      for (let tee = ctx.calcTeeTimeCount; tee > 0; tee--) {
        const totalSlots = ctx.teeSlots[tee];
        const usedSlots = ctx.openSlot[tee] - 1; // openSlot=1 means 0 used
        const freeSlots = totalSlots - usedSlots;

        if (freeSlots >= countNeeded) {
          freeTeeTime = tee;
          break;
        }
      }

      if (freeTeeTime === 0) {
        console.error(
          `I9000 ERROR: No tee time has enough open slots for subgroup ${subgroup}`
        );
        return "ERROR";
      }

      console.log(
        `I9000: Placing subgroup ${subgroup} (${countNeeded} golfers) into tee time ${freeTeeTime}`
      );

      // -----------------------------------------------------
      // STEP 3 — Place subgroup golfers into tee slots
      // -----------------------------------------------------
      for (const golfer of subgroupGolfers) {
        const slot = ctx.openSlot[freeTeeTime];

        if (slot === 1) {
          ctx.userId1[freeTeeTime]    = golfer.user_id
          ctx.lastName1[freeTeeTime]  = golfer.last_name + golfer.asterisk_suffix;
          ctx.firstName1[freeTeeTime] = golfer.first_name;
          ctx.openSlot[freeTeeTime]   = 2;

        } else if (slot === 2) {
          ctx.userId2[freeTeeTime]    = golfer.user_id
          ctx.lastName2[freeTeeTime]  = golfer.last_name + golfer.asterisk_suffix;
          ctx.firstName2[freeTeeTime] = golfer.first_name;
          ctx.openSlot[freeTeeTime]   = 3;

        } else if (slot === 3) {
          ctx.userId3[freeTeeTime]    = golfer.user_id
          ctx.lastName3[freeTeeTime]  = golfer.last_name + golfer.asterisk_suffix;
          ctx.firstName3[freeTeeTime] = golfer.first_name;
          ctx.openSlot[freeTeeTime]   = 4;

        } else if (slot === 4) {
          ctx.userId4[freeTeeTime]    = golfer.user_id
          ctx.lastName4[freeTeeTime]  = golfer.last_name + golfer.asterisk_suffix;
          ctx.firstName4[freeTeeTime] = golfer.first_name;
          ctx.openSlot[freeTeeTime]   = 5; // full

        } else {
          console.error(
            `I9000 ERROR: Tee time ${freeTeeTime} has no valid open slot for subgroup golfer`
          );
          return "ERROR";
        }
      }
    }
    console.log("I9000 - last name 1 array:", ctx.lastName1);
    console.log("I9000 - last name 2 array:", ctx.lastName2);
    console.log("I9000 - last name 3 array:", ctx.lastName3);
    console.log("I9000 - last name 4 array:", ctx.lastName4);
    return "SUCCESS";

  } catch (err) {
    console.error("I9000 error:", err);
    return "ERROR";
  }
}

// -----------------------------------------------------------------------------
// J10000 - Populate tee slots with independent golfers (subgroup = '')
// -----------------------------------------------------------------------------
// This step:
//   • Selects all remaining independent golfers (subgroup = '')
//   • Randomizes them (ORDER BY random())
//   • Fills remaining open tee slots from last tee time backward
//   • Marks tee times full when appropriate
//   • Deletes each independent golfer from work_tee_sheet after placing them
// -----------------------------------------------------------------------------
async function J10000populateIndependentGolfers(leagueId, playDate, ctx) {
  try {
    // -------------------------------------------------------------------------
    // STEP 1 — Get independent golfers
    // -------------------------------------------------------------------------
    const independents = await dbAll(
      `SELECT user_id 
            , last_name
            , first_name
            , asterisk_suffix
         FROM work_tee_sheet
        WHERE play_date = ?
          AND league_id = ?
          AND subgroup = ''
        ORDER BY random()`,
      [playDate, leagueId]
    );

    if (independents.length === 0) {
      console.log(
        `J10000: No independent golfers for league ${leagueId} on ${playDate}`
      );
      return "SUCCESS";
    }

    console.log(
      `J10000: Found ${independents.length} independent golfers for league ${leagueId} on ${playDate}
       independents array = ${independents}`
    );

    // -------------------------------------------------------------------------
    // STEP 2 — Place independents into tee slots
    // -------------------------------------------------------------------------
    for (const golfer of independents) {

      let placed = false;

      // Search from last tee time backward
      for (let tee = ctx.calcTeeTimeCount; tee > 0; tee--) {

        const slot = ctx.openSlot[tee];
        const totalAvailableSlots = ctx.teeSlots[tee];
        console.log("golfer = ", golfer.first_name, golfer.last_name, golfer.asterisk_suffix,
          " tee = ", tee, " slot = ", slot, " totalAvailableSlots = ", totalAvailableSlots);

        // Tee time is full
        if (slot >= 5) continue;

        // Place golfer in the first available slot
        if (slot === 1) {
          ctx.userId1[tee]    = golfer.user_id;
          ctx.lastName1[tee]  = golfer.last_name + golfer.asterisk_suffix;
          ctx.firstName1[tee] = golfer.first_name;
          ctx.openSlot[tee]   = 2;
          placed = true;

        } else if (slot === 2) {
          ctx.userId2[tee]    = golfer.user_id;
          ctx.lastName2[tee]  = golfer.last_name + golfer.asterisk_suffix;
          ctx.firstName2[tee] = golfer.first_name;
          ctx.openSlot[tee]   = 3;
          placed = true;

        } else if (slot === 3) {
          ctx.userId3[tee]    = golfer.user_id;
          ctx.lastName3[tee]  = golfer.last_name + golfer.asterisk_suffix;
          ctx.firstName3[tee] = golfer.first_name;
          ctx.openSlot[tee]   = 4;
          placed = true;

        } else if (slot === 4) {
          if (totalAvailableSlots === 4) {
              ctx.userId4[tee]    = golfer.user_id;
              ctx.lastName4[tee]  = golfer.last_name + golfer.asterisk_suffix;
              ctx.firstName4[tee] = golfer.first_name;
              placed = true;
              ctx.openSlot[tee]   = 5; // full
          }
        } 
        if (placed) {
          console.log("J10000 - last name 1 array:", ctx.lastName1);
          console.log("J10000 - last name 2 array:", ctx.lastName2);
          console.log("J10000 - last name 3 array:", ctx.lastName3);
          console.log("J10000 - last name 4 array:", ctx.lastName4);
          break;
        } 
      }
        if (!placed) {
          console.error(
            `J10000 ERROR: No available tee slot for independent golfer ${golfer.first_name}
             ${golfer.last_name}`
          );
          return "ERROR";          
        }
    }

    return "SUCCESS";

  } catch (err) {
    console.error("J10000 error:", err);
    return "ERROR";
  }
}

// -----------------------------------------------------------------------------
async function K10500DeleteLeagueDataFromTeeSheetTable(leagueId, playDate) {
  try {
       const delTeeSheetData = await dbRun(
       `DELETE FROM tee_sheet
         WHERE tee_date = ?
           AND league_name in 
               (SELECT league_name
                  FROM leagues
                 WHERE leagues.id = ?)`,
       [playDate, leagueId]
       );
      console.log(
      `K10500 - ${delTeeSheetData.changes} tee_sheet rows deleted for
       league_id=${leagueId}, tee_date=${playDate}`
      );

      return "SUCCESS";

  } catch (err) {
    console.error("K10500 error deleting tee_sheet data:", err);
    return "ERROR";
  }
}


// -----------------------------------------------------------------------------
// L11000 - Populate tee_sheet table from ctx + allocated_tee_times
// -----------------------------------------------------------------------------
// Uses:
//   • ctx.teeSlots
//   • ctx.lastName1..4
//   • ctx.firstName1..4
// -----------------------------------------------------------------------------
async function L11000populateTeeSheetTable(leagueId, playDate, ctx, generatedBy) {
  try {
    const ts = easternNow();   // unified timestamp

    // Determine who generated the tee sheet
    let generated_by_value;

    if (generatedBy) {
      // Rebuild triggered by an admin
      generated_by_value = generatedBy;
    } else {
      // Nightly cron job
      generated_by_value = "CRON-8pm";
    }

    const allocatedTeeTimes = await dbAll(
      `SELECT att.tee_time_number,
              att.tee_time,
              att.first_nine,
              att.play_date,
              l.league_name
         FROM allocated_tee_times att
         JOIN leagues l ON l.id = att.league_id
        WHERE att.league_id = ?
          AND att.play_date = ?
        ORDER BY att.tee_time_number ASC`,
      [leagueId, playDate]
    );

    if (allocatedTeeTimes.length === 0) {
      console.error(`L11000: No allocated tee times for league ${leagueId} on ${playDate}`);
      return "ERROR";
    }

    for (const row of allocatedTeeTimes) {
      const n = row.tee_time_number;

      await dbRun(
        `INSERT INTO tee_sheet (
            tee_date,
            tee_time,
            starting_nine,
            league_id,
            league_name,
            user_id1, first_name1, last_name1,
            user_id2, first_name2, last_name2,
            user_id3, first_name3, last_name3,
            user_id4, first_name4, last_name4,
            is_locked,
            generated_at,
            generated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          playDate,
          row.tee_time,
          row.first_nine,
          leagueId,
          row.league_name,
          ctx.userId1[n] || "",
          ctx.firstName1[n] || "",
          ctx.lastName1[n] || "",
          ctx.userId2[n] || "",
          ctx.firstName2[n] || "",
          ctx.lastName2[n] || "",
          ctx.userId3[n] || "",
          ctx.firstName3[n] || "",
          ctx.lastName3[n] || "",
          ctx.userId4[n] || "",
          ctx.firstName4[n] || "",
          ctx.lastName4[n] || "",
          1,
          ts,                   // generated_at
          generated_by_value    // generated_by
        ]
      );
    }

    return "SUCCESS";

  } catch (err) {
    console.error("L11000 ERROR:", err);
    return "ERROR";
  }
}

// ----------------------------------------------------------------------------------------------
// --- Sync tee_sheet_working with the newly rebuilt tee_sheet
// --- data for specified league and tee sheet date.  The delete of
// --- the old data from tee_sheet_working is done in this function
// --- and the copy of the data from tee_sheet to tee_sheet_working
// --- will be done in subsequent function.
// -----------------------------------------------------------------------------
async function M12000DeleteLeagueDataFromTeeSheetWorking(leagueId, playDate) {
  try {
       // --- Sync tee_sheet_working with the newly rebuilt tee_sheet ---
       const delTeeSheetWorking = await dbRun(
         `DELETE FROM tee_sheet_working
           WHERE league_id = ?
                  AND tee_date = ?`,
          [ leagueId, playDate ]
       );
      console.log(
      `M12000 - ${delTeeSheetWorking.changes} tee_sheet_working rows deleted for
       league_id=${leagueId}, tee_date=${playDate}`
      );

      return "SUCCESS";

  } catch (err) {
    console.error("M12000 error deleting tee_sheet data:", err);
    return "ERROR";
  }
}

// ----------------------------------------------------------------------------------------------
// --- Sync tee_sheet_working with the newly rebuilt tee_sheet
// --- data for specified league and tee sheet date.  The delete of
// --- the old data from tee_sheet_working was done in prior
// --- function M12000.  We simply copy the data from the tee_sheet
// --- table to the tee_sheet_working table in function N13000, below. 
// ----------------------------------------------------------------------------------------------
async function N13000LoadTeeSheetWorking(leagueId, playDate, generatedBy) {
  try {
    const ts = easternNow();   // ⭐ unified timestamp

    const copyToWorkingTable = await dbRun(
      `INSERT INTO tee_sheet_working (
         tee_date, tee_time, starting_nine, league_id, league_name,
         user_id1, last_name1, first_name1,
         user_id2, last_name2, first_name2,
         user_id3, last_name3, first_name3,
         user_id4, last_name4, first_name4,
         generated_at,
         edited_at,
         edited_by
       )
       SELECT
         tee_date, tee_time, starting_nine, league_id, league_name,
         user_id1, last_name1, first_name1,
         user_id2, last_name2, first_name2,
         user_id3, last_name3, first_name3,
         user_id4, last_name4, first_name4,
         generated_at,      -- ⭐ copy from tee_sheet
         ?,                 -- ⭐ edited_at (baseline)
         ?                  -- ⭐ edited_by
       FROM tee_sheet
       WHERE league_id = ?
         AND tee_date = ?`,
      [ts, generatedBy, leagueId, playDate]
    );

    return "SUCCESS";

  } catch (err) {
    console.error("N13000 ERROR:", err);
    return "ERROR";
  }
}

// ----------------------------------------------------------------------------------------------
// O14000 - Send nightly tee sheet email to:
//   - All players on the tee sheet (members + guests)
//   - All guests with non-null guest_email
//   - All league admins (users.is_admin = 1)
//   - DISTINCT applied across the UNION
// ----------------------------------------------------------------------------------------------
async function O14000SendTeeSheetEmail(leagueId, playDate) {
  try {
    console.log(`O14000: Preparing tee sheet email for league ${leagueId} on ${playDate}`);  
    // ------------------------------------------------------------
    // 1. Build list of email recipients
    // ------------------------------------------------------------
    const currMonth = parseInt(playDate.substring(5, 7), 10);
    const emailIds = await dbAll(

       `SELECT DISTINCT email
	     FROM (
	   SELECT users.email
         FROM tee_sheet
		    , users
        WHERE tee_sheet.league_id = ?
		  AND tee_sheet.tee_date = ?
		  AND users.league_id = tee_sheet.league_id
		  AND     ((users.is_admin = 1  AND EXISTS
                                  (SELECT 1
                                         FROM user_play_months
                                       WHERE user_id = users.id
                                              AND in_town = 1
                                              AND month = ?))
                             OR
		             users.id in 
				  ( tee_sheet.user_id1
		          , tee_sheet.user_id2
			      , tee_sheet.user_id3
			      , tee_sheet.user_id4)
			      )
		UNION
        SELECT guest_email AS email
          FROM tee_sheet
		     , guests
			 , users
         WHERE tee_sheet.league_id = ?
		   AND tee_sheet.tee_date = ?
		   AND users.league_id = tee_sheet.league_id
		   AND guests.sponsor_user_id = users.id
		   AND guests.id in 
		       ( tee_sheet.user_id1
		       , tee_sheet.user_id2
			   , tee_sheet.user_id3
			   , tee_sheet.user_id4
			   )
		      )`,
               [ leagueId, playDate, currMonth, leagueId, playDate ]
          );

      if (emailIds.length === 0) {
      console.warn(`O14000: No recipients found for league ${leagueId} on ${playDate}`);
      return "NO-RECIPIENTS";
      }

      console.log(
      `O14000 - ${emailIds.length} email recipients for CRON-8PM generateTeeTimes run.
       league_id=${leagueId}, tee_date=${playDate}`);

    let emailRecipientList = ` `;
    let firstOne = 1;

    for (const row of emailIds) {
      if (firstOne === 1) {
          emailRecipientList += `${row.email}`.trim();
          firstOne = 0;
      } else {
          emailRecipientList += `, ${row.email}`.trim();
      }
      }
     console.log("O14000 emailRecipientList = ", emailRecipientList);

   // ------------------------------------------------------------
    // 2. Load tee sheet rows into an array 
    // ------------------------------------------------------------
    const teeRows = await dbAll(
      `SELECT *
         FROM tee_sheet
        WHERE league_id = ?
          AND tee_date = ?
        ORDER BY tee_time ASC`,
      [leagueId, playDate]
    );

    if (teeRows.length === 0) {
      console.warn(`O14000: No tee sheet rows found for league ${leagueId} on ${playDate}`);
      return "NO-TEESHEET";
    }

    // ------------------------------------------------------------
    // 3. Build email body
    // ------------------------------------------------------------
    let emailBody = `Tee Sheet for ${playDate}\n\n`;

    for (const row of teeRows) {
      emailBody += `${row.tee_time} (${row.starting_nine})\n`;

      const players = [
        `${row.first_name1} ${row.last_name1}`.trim(),
        `${row.first_name2} ${row.last_name2}`.trim(),
        `${row.first_name3} ${row.last_name3}`.trim(),
        `${row.first_name4} ${row.last_name4}`.trim()
      ].filter(n => n !== "");

      emailBody += players.join(", ") + "\n\n";
    }

    // ------------------------------------------------------------
    // 4. Send the email
    // ------------------------------------------------------------
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: emailRecipientList,
      subject: `Tee Sheet for ${playDate}`,
      text: emailBody
    });

      return "SUCCESS";

  } catch (err) {
    console.error("O14000 error getting email recipients for CRON-8PM generateTeeTimes run:", err);
    return "ERROR";
  }
}

// ------------------------------------------------------------------------------
// generateTeeSheet function is called EITHER...
// 1.  To generate the TeeSheet for all leagues that play two days from today
//       In this case we invoke function A0000generateTeeSheetForAllLeagues 
//       OR
// 2.  To generate the TeeSheet for a specific league and specific play date
//       In this case we invoke function A0500generateTeeSheetForLeagueAndDate
// ------------------------------------------------------------------------------
async function generateTeeSheet({ leagueId = 0, playDate = null, generatedBy = null } = {}) {
  // (1) nightly job: all leagues, two days hence
  if (!leagueId || leagueId === 0) {
    return A0000generateTeeSheetForAllLeagues();
  }

  // single‑league rebuild
  if (!playDate) {
    throw new Error("playDate is required when leagueId > 0");
  }

  // 2) process only this league
  const rc = await A0500generateTeeSheetForLeagueAndDate(leagueId, playDate, generatedBy);
  if (rc === "ERROR") {
    throw new Error("Error processing league tee sheet");
  }

  return "SUCCESS";
}


module.exports = { generateTeeSheet };