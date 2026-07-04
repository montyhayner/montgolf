//  /jobs/runExtendCalendarDates.js

const { extendCalendarDates } = require("../services/extendCalendar");

async function runExtendCalendarJob() {
  console.log("📅 Running monthly calendar extension job...");

  const added = extendCalendarDates();

  console.log(`📅 Calendar extended. ${added} new dates added.`);

  // Later: email super-admins here
  // await sendCalendarExtensionEmail(added);

  return added;
}

module.exports = { runExtendCalendarJob };
