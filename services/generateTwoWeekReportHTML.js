// services/generateTwoWeekReportHTML.js

function generateTwoWeekReportHTML(dates, rows, totals, leagueName = "") {
  if (!dates || dates.length === 0) {
    return `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        <h2>Two‑Week Golfers Report - ${leagueName}</h2>
        <p>No scheduled play in the next 14 days.</p>
      </div>
    `;
  }

  return `
  <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
    <h2 style="text-align:center; margin-bottom: 20px;">Two‑Week Golfers Report - ${leagueName}</h2>

    <table style="width:100%; border-collapse: collapse; max-width: 700px; margin: 0 auto;">
      <thead>
        <tr>
          <th style="padding: 8px; background:#f4f4f4; border:1px solid #ccc; text-align:left;">Golfer</th>
            ${dates.map(d => {
              const [year, month, day] = d.split("-").map(Number);
              const dt = new Date(year, month - 1, day);   // local date, no shift
              const dow = dt.toLocaleDateString("en-US", { weekday: "short" }); // Wed
              const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }); // 6/3

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

  </div>
  `;
}

module.exports = generateTwoWeekReportHTML;