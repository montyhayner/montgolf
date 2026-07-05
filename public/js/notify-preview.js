function waitForReportData() {
  if (!window.teeRows || !window.leagueId || !window.teeDate) {
    console.log("Waiting for report data...");
    return setTimeout(waitForReportData, 50);
  }

  console.log("Report data ready:", window.teeRows, window.leagueId, window.teeDate);
  initializeNotifyPreview();
}

waitForReportData();


function updateStatus(msg, type = "info") {
  const el = document.getElementById("notifyStatus");
  if (!el) return;

  el.textContent = msg;
  el.className = "";
  el.classList.add("notify-status", `status-${type}`);
}

document.addEventListener("DOMContentLoaded", () => {

  const previewBtn = document.getElementById("btnPreviewEmail");
  const backBtn = document.getElementById("btnBackToOptions");
  const sendBtn = document.getElementById("btnSendEmail");
  const leagueId = window.leagueId;
  const teeDate = window.tee_date;

  // -------------------------------------------------------------
  // PREVIEW EMAIL BUTTON
  // -------------------------------------------------------------
  if (previewBtn) {
    previewBtn.addEventListener("click", async () => {
      console.log("=== PREVIEW CLICKED ===");
      console.log("Preview Email clicked");
      // Clear old preview content
      const previewBody = document.getElementById("notifyPreviewBody");
      previewBody.innerHTML = "";
      console.log("Preview body cleared");

      const includeTeeSheet = document.getElementById("bodyIncludeTeeSheet").checked;
      const includeUnplaced = document.getElementById("bodyIncludeUnplaced").checked;
      const message = document.getElementById("notifyMessage").value;

      const recPlayers = document.getElementById("recTeeSheetPlayers").checked;
      const recUnplaced = document.getElementById("recUnplacedGolfers").checked;
      const recAdmins = document.getElementById("recLeagueAdmins").checked;
      const recStaff = document.getElementById("recClubStaff").checked;

      let html = "";
      console.log("includeTeeSheet:", includeTeeSheet);
      console.log("window.teeRows:", window.teeRows);

      // ---------------------------------------------------------
      // RECIPIENTS SECTION
      // ---------------------------------------------------------
      html += `<h3>Recipients</h3>`;

      // Tee Sheet Players
      if (recPlayers && window.teeRows) {
        html += `<strong>Tee Sheet Players:</strong><ul>`;
        window.teeRows.forEach(row => {
          [row.first_name1, row.first_name2, row.first_name3, row.first_name4].forEach((fn, idx) => {
            const ln = row[`last_name${idx+1}`];
            if (fn && ln) html += `<li>${fn} ${ln}</li>`;
          });
        });
        html += `</ul>`;
      }

      // Unplaced Golfers (editor page only)
      const unplaced = (window.latestApplyResult && window.latestApplyResult.unplaced) || [];
      if (recUnplaced && unplaced.length > 0) {
        html += `<strong>Unplaced Golfers:</strong><ul>`;
        unplaced.forEach(g => {
          html += `<li>${g.first_name} ${g.last_name}</li>`;
        });
        html += `</ul>`;
      }

      // League Admins
      if (recAdmins && window.allAdmins) {
        html += `<strong>League Admins:</strong><ul>`;
        window.allAdmins.forEach(a => {
          html += `<li>${a.first_name} ${a.last_name}</li>`;
        });
        html += `</ul>`;
      }

      // Club Staff
      if (recStaff && window.clubStaff) {
        html += `<strong>Club Staff:</strong><ul>`;
        window.clubStaff.forEach(s => {
          html += `<li>${s.first_name} ${s.last_name}</li>`;
        });
        html += `</ul>`;
      }

      // ---------------------------------------------------------
      // OPTIONAL MESSAGE
      // ---------------------------------------------------------
      if (message.trim()) {
        html += `<h3>Message</h3><p>${message}</p>`;
      }

// ---------------------------------------------------------
// TEE SHEET BODY
// ---------------------------------------------------------              
if (includeTeeSheet && window.teeRows) {

  let actualDate = "";

  if (window.teeRows.length > 0) {
    const raw = window.teeRows[0].tee_date
             || window.teeRows[0].date
             || window.teeRows[0].play_date;

    console.log("Raw date value:", raw);

    if (raw) {
      const dt = new Date(raw + "T00:00:00");
      console.log("Parsed date:", dt);

      actualDate = dt.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });

      console.log("Formatted actualDate:", actualDate);
    }
  }

  console.log("Heading being inserted:", `<h3 class="preview-tee-date">Tee Sheet for ${actualDate}</h3>`);
  html += `<h3 class="preview-tee-date">Tee Sheet for ${actualDate}</h3>`;
  html += window.buildTeeSheetHTML(window.teeRows);   // <-- RESTORE THIS
}

// ---------------------------------------------------------
// UNPLACED GOLFERS BODY (editor page only)
// ---------------------------------------------------------
      if (includeUnplaced && unplaced.length > 0) {
        html += `<h3>Unplaced Golfers</h3><ul>`;
        unplaced.forEach(g => {
          html += `<li>${g.first_name} ${g.last_name}</li>`;
        });
        html += `</ul>`;
      }

      // Insert preview HTML
      document.getElementById("notifyPreviewBody").innerHTML = html;

      // Switch to Step 2
      document.getElementById("notifyStep1").style.display = "none";
      document.getElementById("notifyStep2").style.display = "block";
    });
  }

  // -------------------------------------------------------------
  // BACK BUTTON
  // -------------------------------------------------------------
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      document.getElementById("notifyStep2").style.display = "none";
      document.getElementById("notifyStep1").style.display = "block";
    });
  }

  // -------------------------------------------------------------
  // SEND EMAIL BUTTON
  // -------------------------------------------------------------
  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      console.log("Send Email clicked");

      const includeTeeSheet = document.getElementById("bodyIncludeTeeSheet").checked;
      const includeUnplaced = document.getElementById("bodyIncludeUnplaced").checked;
      const message = document.getElementById("notifyMessage").value;

      const recipientGroups = {
        teeSheetPlayers: document.getElementById("recTeeSheetPlayers").checked,
        unplacedGolfers: document.getElementById("recUnplacedGolfers").checked,
        leagueAdmins: document.getElementById("recLeagueAdmins").checked,
        clubStaff: document.getElementById("recClubStaff").checked
      };

      updateStatus("Sending notifications...", "info");

      try {
        const res = await fetch(`/admin/api/tee-sheet/${leagueId}/${teeDate}/send-notifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientGroups,
            includeTeeSheet,
            includeUnplaced,
            message
          })
        });

        if (!res.ok) throw new Error("Failed to send notifications");

        updateStatus("Notifications sent.", "success");
        closeNotifyModal();

      } catch (err) {
        console.error(err);
        updateStatus("Error sending notifications.", "error");
      }
    });
  }

  });
