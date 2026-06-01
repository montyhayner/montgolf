document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("report-table-container");

 // const res = await fetch("/admin/reports/two-week", {
 // credentials: "include"
//  });

 // const data = await res.json();

 // if (!data.dates.length) {
  //  container.innerHTML = "<p>No play dates found for the next two weeks.</p>";
  //  return;
  //}

const res = await fetch("/admin/reports/two-week", {
  credentials: "include"
});

console.log("STATUS:", res.status);

const text = await res.text();
console.log("RAW RESPONSE:", text);

let data;
try {
  data = JSON.parse(text);
} catch (e) {
  console.log("JSON PARSE FAILED");
}

  // Build table
  let html = `<table class="report-table"><thead><tr><th>Golfer</th>`;

  data.dates.forEach(d => {
    html += `<th>${d}</th>`;
  });

  html += `</tr></thead><tbody>`;

  data.players.forEach(p => {
    html += `<tr><td>${p.name}</td>`;
    data.dates.forEach(d => {
      html += `<td>${p.plays[d] || " "}</td>`;
    });
    html += `</tr>`;
  });

  // Totals row
  html += `<tr class="totals-row"><td><strong>Total</strong></td>`;
  data.dates.forEach(d => {
    html += `<td>${data.totals[d]}</td>`;
  });
  html += `</tr>`;

  html += `</tbody></table>`;

  container.innerHTML = html;

  // Email button
  document.getElementById("emailBtn").addEventListener("click", async () => {
    const sendRes = await fetch("/admin/reports/two-week/email", {
      method: "POST",
      credentials: "include"
    });

    const result = await sendRes.json();
    alert(result.message || "Email sent.");
  });
});
