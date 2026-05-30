// utils/easternTime.js

// Returns a JS Date object representing "now" in Eastern Time
function easternDateObj() {
  const now = new Date();

  // Convert to Eastern using Intl API (handles DST correctly)
  const options = {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  };

  const parts = new Intl.DateTimeFormat("en-US", options)
    .formatToParts(now)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  );
}

// Returns "YYYY-MM-DD HH:MM:SS" in Eastern Time
function easternNow() {
  const d = easternDateObj();
  const pad = n => String(n).padStart(2, "0");

  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

// Returns "YYYY-MM-DD" in Eastern Time
function easternDate() {
  return easternNow().split(" ")[0];
}

// Optional helper: is Eastern DST right now
function isDST() {
  const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset();
  return Math.min(jan, jul) !== new Date().getTimezoneOffset();
}

module.exports = {
  easternNow,
  easternDate,
  easternDateObj,
  isDST
};
