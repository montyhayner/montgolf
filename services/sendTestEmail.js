const { sendEmail } = require("./mailer");

async function sendTestEmail() {
  try {
    const info = await sendEmail({
      from: "test@mg.montgolf.net",
      to: "montyhayner@gmail.com",
      subject: "Mailgun SMTP Test",
      html: "<h2>Mailgun SMTP test successful.</h2>"
    });

    console.log("Message sent:", info.messageId);
  } catch (err) {
    console.error("SMTP Error:", err);
  }
}

sendTestEmail();
