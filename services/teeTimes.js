function generateTeeTimes(firstTime, count, interval) {
  const times = [];
  let [hour, minute] = firstTime.split(":").map(Number);

  for (let i = 0; i < count; i++) {
    const hh = hour.toString().padStart(2, "0");
    const mm = minute.toString().padStart(2, "0");
    times.push(`${hh}:${mm}`);

    minute += interval;
    while (minute >= 60) {
      minute -= 60;
      hour++;
    }
  }

  return times;
}

module.exports = { generateTeeTimes };