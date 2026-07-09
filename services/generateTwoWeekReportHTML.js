// ============================================================================
// generateTwoWeekReportHTML.js
// Email HTML generator for Two-Week Golfers Report + Allocated Tee Times
// ============================================================================

function generateTwoWeekReportHTML(dates, players, totals, allocatedTeeTimes, leagueName = "") {

  // ------------------------------------------------------------
  // Handle empty report
  // ------------------------------------------------------------
  if (!dates || dates.length === 0) {
    return `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        <h2>Two‑Week Golfers Report - ${leagueName}</h2>
        <p>No scheduled play in the next 14 days.</p>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // Allocated Tee Times (NEW unified structure)
  // ------------------------------------------------------------
  function buildAllocatedTeeTimesHTML(dates, allocated) {
    let html = `
      <table style="width:100%; border-collapse: collapse; max-width: 700px; margin: 0 auto;">
        <thead>
          <tr style="background:#e6ffe6;">
            <th style="padding: 8px; border:1px solid #ccc; text-align:center;">Date</th>
            <th style="padding: 8px; border:1px solid #ccc; text-align:center;">Tee Times</th>
          </tr>
        </thead>
        <tbody>
    `;

    dates.forEach((date, idx) => {
      const teeTimes = allocated[date] || [];

      html += `
        <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#e6ffe6'};">
          <td style="padding: 6px; border:1px solid #ccc; width:120px;">
            ${date}
          </td>
          <td style="padding: 6px; border:1px solid #ccc;">
            ${teeTimes.length > 0
              ? teeTimes.map(t => `<div>${t}</div>`).join("")
              : "<em>No tee times</em>"
            }
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    return html;
  }

  // ------------------------------------------------------------
  // Main HTML (Golfers Table + Allocated Tee Times)
  // ------------------------------------------------------------
  return `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">

      <h2 style="text-align:center; margin-bottom: 20px;">
        Two‑Week Golfers Report - ${leagueName}
      </h2>

      <!-- GOLFERS TABLE -->
      <table style="width:100%; border-collapse: collapse; max-width: 700px; margin: 0 auto;">
        <thead>
          <tr style="background:#e6ffe6;">
            <th style="padding: 8px; border:1px solid #ccc; text-align:left;">Golfer</th>
            ${dates.map(d => {
              const [year, month, day] = d.split("-").map(Number);
              const dt = new Date(year, month - 1, day);
              const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
              const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

              return `
                <th style="padding: 8px; border:1px solid #ccc; text-align:center;">
                  <div>${dow}</div>
                  <div style="font-size:12px; color:#555;">${md}</div>
                </th>
              `;
            }).join("")}
          </tr>
        </thead>

        <tbody>
          ${players.map((p, idx) => `
            <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#e6ffe6'};">
              <td style="padding: 6px; border:1px solid #ccc;">${p.name}</td>
              ${dates.map(d => `
                <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
                  ${p.plays[d] || ""}
                </td>
              `).join("")}
            </tr>
          `).join("")}

          <tr style="background:${players.length % 2 === 0 ? '#ffffff' : '#e6ffe6'}; font-weight:bold;">
            <td style="padding: 6px; border:1px solid #ccc;">Total</td>
            ${dates.map(d => `
              <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
                ${totals[d]}
              </td>
            `).join("")}
          </tr>
        </tbody>
      </table>

      <hr style="margin:30px 0; border:none; border-top:1px solid #ccc;" />

      <h3 style="text-align:center; margin-bottom:10px;">Allocated Tee Times</h3>

      ${buildAllocatedTeeTimesHTML(dates, allocatedTeeTimes)}

    </div>
  `;
}

module.exports = generateTwoWeekReportHTML;
