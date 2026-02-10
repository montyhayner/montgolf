require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const logger = require("./utils/logger");

// Crash reporting
process.on("uncaughtException", (err) => logger.error(err, "Uncaught Exception"));
process.on("unhandledRejection", (reason) => logger.error(reason, "Unhandled Rejection"));

// Create app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static("public"));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.http(req.method, req.originalUrl, res.statusCode, duration);
  });
  next();
});

// Sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

// Route modules
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/users");
const adminRoutes = require("./routes/admin");
const leaguesRoutes = require("./routes/leagues");
const availabilityRoutes = require("./routes/availability");
const reportsRoutes = require("./routes/reports");

// Mount routes
app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/admin", adminRoutes);
app.use("/leagues", leaguesRoutes);
app.use("/availability", availabilityRoutes);
app.use("/reports", reportsRoutes);

// Partials
app.get("/partials/login-nav", (req, res) => {
  res.sendFile(path.join(__dirname, "public/partials/login-nav.html"));
});

app.get("/partials/user-nav", (req, res) => {
  res.sendFile(path.join(__dirname, "public/partials/user-nav.html"));
});

// Public pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.get("/admin-login", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin-login.html"));
});

app.get("/my-availability", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "my-availability.html"));
});

app.get("/schedule", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "schedule.html"));
});

app.get("/logout", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "logout.html"));
});

// Error handler
app.use((err, req, res, next) => {
  logger.error(err, "SERVER ERROR");
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.start(PORT);
});