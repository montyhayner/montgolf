// services/generateTwoWeekReportText.js

function generateTwoWeekReportText(dates, rows, totals) {
  if (!dates || dates.length === 0) {
    return "Two‑Week Golfers Report\n\nNo scheduled play in the next 14 days.";
  }

  let text = "";
  text += "Two‑Week Golfers Report\n";
  text += "=====================\n\n";

  text += `Dates: ${dates.join(", ")}\n\n`;

  // -----------------------------------------
  // HEADER ROWS (DOW on top, M/D below)
  // -----------------------------------------

  // First line: Golfer + DOW
  text += "Golfer".padEnd(22);
  dates.forEach(d => {
    const dt  = new Date(d);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" }); // Wed
    text += dow.padEnd(6);
  });
  text += "\n";

  // Second line: blank + M/D (no leading zeros)
  text += "".padEnd(22);
  dates.forEach(d => {
    const [year, month, day] = d.split("-").map(Number);
    const dt = new Date(year, month - 1, day);   // local date, no shift
    const md = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }); // 6/3
    text += md.padEnd(6);
  });
  text += "\n";

  // Divider
  text += "-".repeat(22 + dates.length * 6) + "\n";

  // -----------------------------------------
  // BODY ROWS
  // -----------------------------------------
  rows.forEach(r => {
    text += r.name.padEnd(22);
    dates.forEach(d => {
      text += (r.plays[d] || " ").padEnd(6);
    });
    text += "\n";
  });

  // -----------------------------------------
  // TOTALS ROW
  // -----------------------------------------
  text += "-".repeat(22 + dates.length * 6) + "\n";
  text += "Total".padEnd(22);
  dates.forEach(d => {
    text += totals[d].toString().padEnd(6);
  });
  text += "\n\n";

  text += "End of report.\n";

  return text;
}

module.exports = generateTwoWeekReportText;