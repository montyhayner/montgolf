// ============================================================================
// generateTwoWeekReportText.js
// Text-only email generator for Two-Week Golfers Report + Allocated Tee Times
// ============================================================================

function generateTwoWeekReportText(dates, players, totals, allocatedTeeTimes, leagueName = "") {

  // ------------------------------------------------------------
  // Handle empty report
  // ------------------------------------------------------------
  if (!dates || dates.length === 0) {
    return `Two-Week Golfers Report - ${leagueName}\n\nNo scheduled play in the next 14 days.\n`;
  }

  let text = "";
  text += `Two-Week Golfers Report - ${leagueName}\n`;
  text += `=====================================\n\n`;

  // ------------------------------------------------------------
  // Header row
  // ------------------------------------------------------------
  text += `Golfer`.padEnd(22);

  dates.forEach(d => {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    text += `${dow} ${md}`.padStart(8);
  });

  text += `\n`;
  text += `-`.repeat(22 + dates.length * 8) + `\n`;

  // ------------------------------------------------------------
  // Player rows
  // ------------------------------------------------------------
  players.forEach(p => {
    text += p.name.padEnd(22);

    dates.forEach(d => {
      const val = p.plays[d] || "";
      text += val.padStart(8);
    });

    text += `\n`;
  });

  // ------------------------------------------------------------
  // Totals row
  // ------------------------------------------------------------
  text += `-`.repeat(22 + dates.length * 8) + `\n`;
  text += `Total`.padEnd(22);

  dates.forEach(d => {
    text += String(totals[d]).padStart(8);
  });

  text += `\n\n`;

  // ------------------------------------------------------------
  // Allocated Tee Times (stacked by date)
  // ------------------------------------------------------------
  text += `Allocated Tee Times\n`;
  text += `====================\n\n`;

  dates.forEach(date => {
    const rows = allocatedTeeTimes[date] || [];

    const [y, m, day] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    const md  = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

    text += `${dow} ${md}\n`;

    if (rows.length === 0) {
      text += `  No tee times\n\n`;
      return;
    }

    const starting9 = rows[0].first_nine || "—";
    text += `  Starting 9: ${starting9}\n`;

    rows.forEach(r => {
      text += `  ${r.tee_time}\n`;
    });

    text += `\n`;
  });

  return text;
}

module.exports = generateTwoWeekReportText;
