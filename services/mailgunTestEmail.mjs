import FormData from "form-data"; // form-data v4.0.1
import Mailgun from "mailgun.js"; // mailgun.js v11.1.0

async function sendSimpleMessage() {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({
    username: "api",
    key: process.env.API_KEY || "API_KEY",
    // When you have an EU-domain, you must specify the endpoint:
    // url: "https://api.eu.mailgun.net"
  });
  try {
    const data = await mg.messages.create("sandboxf65607b60511415faefa8701aabf05ae.mailgun.org", {
      from: "Mailgun Sandbox <postmaster@sandboxf65607b60511415faefa8701aabf05ae.mailgun.org>",
      to: ["Richard LaMont Hayner <montyhayner@outlook.com>"],
      subject: "Hello Richard LaMont Hayner",
      text: "Congratulations Richard LaMont Hayner, you just sent an email with Mailgun! You are truly awesome!",
    });

    console.log(data); // logs response data
  } catch (error) {
    console.log(error); //logs any error
  }
}