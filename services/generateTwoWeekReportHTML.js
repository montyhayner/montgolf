// services/generateTwoWeekReportHTML.js

function generateTwoWeekReportHTML(dates, rows, totals, allocatedTeeTimes, leagueName = "") {
  if (!dates || dates.length === 0) {
    return `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        <h2>Two‑Week Golfers Report - ${leagueName}</h2>
        <p>No scheduled play in the next 14 days.</p>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // Build Allocated Tee Times Table
  // ------------------------------------------------------------
  function buildAllocatedTeeTimesTableHTML(dates, allocated) {
    const allTeeNumbers = new Set();

    dates.forEach(date => {
      const rows = allocated[date] || [];
      rows.forEach(r => allTeeNumbers.add(r.tee_time_number));
    });

    const teeNumbers = Array.from(allTeeNumbers).sort((a, b) => a - b);

    let html = `
      <table style="width:100%; border-collapse: collapse; max-width: 700px; margin: 20px auto 0 auto;">
        <thead>
          <tr>
            <th style="padding: 8px; background:#f4f4f4; border:1px solid #ccc; text-align:left;">
              Tee Time
            </th>
    `;

    dates.forEach(d => {
      const [y, m, day] = d.split("-").map(Number);
      const dt = new Date(y, m - 1, day);
      const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
      const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

      html += `
        <th style="padding: 8px; background:#f4f4f4; border:1px solid #ccc; text-align:center;">
          <div>${dow}</div>
          <div style="font-size:12px; color:#555;">${md}</div>
        </th>
      `;
    });

    html += `
          </tr>
        </thead>
        <tbody>
    `;

    // Starting 9 row
    html += `
      <tr>
        <td style="padding: 6px; border:1px solid #ccc;"><strong>Starting 9</strong></td>
    `;

    dates.forEach(date => {
      const rows = allocated[date] || [];
      const starting9 = rows.length > 0 ? rows[0].first_nine : "—";
      html += `
        <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
          ${starting9}
        </td>
      `;
    });

    html += `</tr>`;

    // Tee time rows
    teeNumbers.forEach(num => {
      html += `
        <tr>
          <td style="padding: 6px; border:1px solid #ccc;">${num}</td>
      `;

      dates.forEach(date => {
        const rows = allocated[date] || [];
        const match = rows.find(r => r.tee_time_number === num);
        html += `
          <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
            ${match ? match.tee_time : ""}
          </td>
        `;
      });

      html += `</tr>`;
    });

    html += `
        </tbody>
      </table>
    `;

    return html;
  }

  // ------------------------------------------------------------
  // Main HTML wrapper
  // ------------------------------------------------------------
  return `
  <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
    <h2 style="text-align:center; margin-bottom: 20px;">
      Two‑Week Golfers Report - ${leagueName}
    </h2>

    <!-- LEFT SIDE TABLE -->
    <table style="width:100%; border-collapse: collapse; max-width: 700px; margin: 0 auto;">
      <thead>
        <tr>
          <th style="padding: 8px; background:#f4f4f4; border:1px solid #ccc; text-align:left;">Golfer</th>
            ${dates.map(d => {
              const [year, month, day] = d.split("-").map(Number);
              const dt = new Date(year, month - 1, day);
              const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
              const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

              return `
                <th style="padding: 8px; background:#f4f4f4; border:1px solid #ccc; text-align:center;">
                  <div>${dow}</div>
                  <div style="font-size:12px; color:#555;">${md}</div>
                </th>
              `;
            }).join("")}
        </tr>
      </thead>

      <tbody>
        ${rows.map(r => `
          <tr>
            <td style="padding: 6px; border:1px solid #ccc;">${r.name}</td>
            ${dates.map(d => `
              <td style="padding: 6px; border:1px solid #ccc; text-align:center;">
                ${r.plays[d] || ""}
              </td>
            `).join("")}
          </tr>
        `).join("")}

        <tr style="background:#fafafa; font-weight:bold;">
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

    ${buildAllocatedTeeTimesTableHTML(dates, allocatedTeeTimes)}

  </div>
  `;
}

module.exports = generateTwoWeekReportHTML;