function generateLatestTeeSheetText(teeSheet, playDate, leagueName) {
  let text = `Latest Tee Sheet Report - ${leagueName}\n`;
  text += `Play Date: ${playDate}\n\n`;

  for (const row of teeSheet) {
    text += `${row.tee_time.padEnd(8)}  ${row.first_name} ${row.last_name}  `;
    if (row.subgroup) {
      text += `Subgroup ${row.subgroup} #${row.subgroup_number}\n`;
    } else {
      text += `\n`;
    }
  }

  return text;
}
