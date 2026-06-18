function buildTeeSheetHTML(rows) {
  let html = `
    <table border="1" cellpadding="6" cellspacing="0">
      <tr>
        <th>Tee Time</th>
        <th>Starting Nine</th>
        <th>Players</th>
      </tr>
  `;

  rows.forEach(row => {
    const players = [
      row.first_name1 && `${row.first_name1} ${row.last_name1}`,
      row.first_name2 && `${row.first_name2} ${row.last_name2}`,
      row.first_name3 && `${row.first_name3} ${row.last_name3}`,
      row.first_name4 && `${row.first_name4} ${row.last_name4}`
    ].filter(Boolean).join(", ");

    html += `
      <tr>
        <td>${row.tee_time}</td>
        <td>${row.starting_nine}</td>
        <td>${players}</td>
      </tr>
    `;
  });

  html += `</table>`;
  return html;
}

window.buildTeeSheetHTML = buildTeeSheetHTML;
