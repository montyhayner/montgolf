// services/mailer.js

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendEmail({ to, subject, html }) {
  return transporter.sendMail({
    from: "notifications@mg.montgolf.net",
    to,
    subject,
    html
  });
}

module.exports = { sendEmail };
