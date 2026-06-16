function generateLatestTeeSheetText(teeSheet, playDate, leagueName) {
  let text = `Latest Tee Sheet Report - ${leagueName}\n`;
  text += `Play Date: ${playDate}\n\n`;

  for (const row of teeSheet) {
    text += `${row.tee_time}  ${row.first_name} ${row.last_name}  `
    text += `Subgroup ${row.subgroup} #${row.subgroup_number}\n`;
  }

  return text;
}