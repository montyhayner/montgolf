function generateLatestTeeSheetHTML(teeSheet, playDate, leagueName) {
  let html = `<h2>Latest Tee Sheet Report - ${leagueName}</h2>`;
  html += `<h3>${playDate}</h3>`;
  html += `<table border="1" cellpadding="6" cellspacing="0">
             <tr>
               <th>Tee Time</th>
               <th>Name</th>
               <th>Subgroup</th>
               <th>#</th>
             </tr>`;

  for (const row of teeSheet) {
    html += `<tr>
      <td>${row.tee_time}</td>
      <td>${row.first_name} ${row.last_name}</td>
      <td>${row.subgroup}</td>
      <td>${row.subgroup_number}</td>
    </tr>`;
  }

  html += `</table>`;
  return html;
}
