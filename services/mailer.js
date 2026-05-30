const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,      // smtp.aol.com
  port: process.env.EMAIL_PORT,      // 465
  secure: process.env.EMAIL_SECURE === "true", // true
  auth: {
    user: process.env.EMAIL_USER,    // rlhayner@verizon.net
    pass: process.env.EMAIL_PASS
  }
});

module.exports = transporter;