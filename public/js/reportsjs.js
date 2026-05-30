let activeRecipientField = "extraRecipients"; // default mode = TO

document.addEventListener("DOMContentLoaded", async () => {

  // Load nav
  const html = await fetch("/partials/user-nav.html").then(r => r.text());
  document.getElementById("user-nav-container").innerHTML = html;

  // Highlight nav
  const path = window.location.pathname;
  document.querySelectorAll("#topNav .nav-link").forEach(link => {
    if (link.getAttribute("href") === path) {
      link.classList.add("active");
    }
  });

  // 1. Load user info to determine admin status
  const userRes = await fetch("/auth/me");
  const user = await userRes.json();
  const isAdmin = user.is_admin === 1;

  // Show extra recipients field only for admins
  if (isAdmin) {
      document.getElementById("extraRecipientsContainer").style.display = "block";
      document.getElementById("recipientPickerContainer").style.display = "block";
      document.getElementById("ccBccContainer").style.display = "block";

      // Mode selector (TO / CC / BCC)
      document.querySelectorAll("input[name='recipientMode']").forEach(radio => {
        radio.addEventListener("change", (e) => {
          activeRecipientField = e.target.value;
          highlightActiveField();
        });
      });

      // Load user list
      const users = await fetch("/reports/usrs/list").then(r => r.json());
      populateRecipientCheckboxes(users);
    }


  // 2. Load the report
  await loadNextPlayDayReport(user.league_id);

  // 3. Email button handler
  document.getElementById("emailReportBtn").addEventListener("click", async () => {
    const reportText = document.getElementById("reportOutput").textContent;

    const extraRecipients = isAdmin ? document.getElementById("extraRecipients").value : "";

    console.log("📤 Sending email payload:", {
      reportText,
      extraRecipients
    });

    const res = await fetch("/reports/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportText,
        extraRecipients,
        ccRecipients: document.getElementById("ccRecipients")?.value || "",
        bccRecipients: document.getElementById("bccRecipients")?.value || ""
      })
    });

    const data = await res.json();

    if (data.ok) {
      alert("Email sent successfully.");
    } else {
      alert("Error sending email.");
    }
  });

  // 4. Print button
  document.getElementById("printReportBtn").addEventListener("click", () => {
    window.print();
  });

  // 5. Report selector (future-proof)
  document.getElementById("reportType").addEventListener("change", async (e) => {
    if (e.target.value === "nextPlayDay") {
      await loadNextPlayDayReport(user.league_id);
    }
  });

});

// -----------------------------
// Helper functions
// -----------------------------

function populateRecipientCheckboxes(users) {
  const container = document.getElementById("recipientPicker");
  container.innerHTML = "";

  users.forEach(u => {
    const div = document.createElement("div");
    div.className = "recipient-item";

    div.innerHTML = `
      <label>
        <input type="checkbox" class="recipientCheckbox" value="${u.email}">
        ${u.last_name}, ${u.first_name} — <span class="email">${u.email}</span>
      </label>
    `;

    container.appendChild(div);
  });

  // Update extraRecipients when checkboxes change
  container.addEventListener("change", updateExtraRecipientsFromCheckboxes);

  // Select All handler
  document.getElementById("selectAllRecipients").addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.querySelectorAll(".recipientCheckbox").forEach(cb => cb.checked = checked);
    updateExtraRecipientsFromCheckboxes();
  });
}

function updateExtraRecipientsFromCheckboxes() {
  const selected = Array.from(
    document.querySelectorAll(".recipientCheckbox:checked")
  ).map(cb => cb.value);

  const field = document.getElementById(activeRecipientField);
  if (field) {
    field.value = selected.join(", ");
  }
}

function highlightActiveField() {
  ["extraRecipients", "ccRecipients", "bccRecipients"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active-recipient-field", id === activeRecipientField);
  });
}

async function loadNextPlayDayReport(leagueId) {
  const res = await fetch(`/reports/next-play-day/${leagueId}`);
  const data = await res.json();

  document.getElementById("reportOutput").textContent =
    `============================\n` +
    `Next Play Date: ${data.next_play_date || "N/A"}\n` +
    `============================\n` +
    data.report;
}
