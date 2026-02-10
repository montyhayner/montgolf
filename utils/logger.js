// utils/logger.js

const fs = require("fs");
const path = require("path");

// Load retention + slow threshold from .env
const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || "31", 10);
const slowThreshold = parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS || "250", 10);

// Ensure logs directory exists
const logDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Daily filenames
const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const combinedLog = path.join(logDir, `combined-${date}.log`);
const errorLog = path.join(logDir, `error-${date}.log`);

// Append a line to a file
function writeToFile(filePath, line) {
  fs.appendFile(filePath, line + "\n", (err) => {
    if (err) console.error("🔥 [LOGGER ERROR] Failed to write log file:", err);
  });
}

// Timestamp helper
function timestamp() {
  return new Date().toISOString();
}

// Auto-delete logs older than X days
function deleteOldLogs(days = retentionDays) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  fs.readdir(logDir, (err, files) => {
    if (err) {
      console.error("🔥 [LOGGER ERROR] Failed to read logs directory:", err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(logDir, file);

      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error("🔥 [LOGGER ERROR] Failed to stat log file:", err);
          return;
        }

        if (stats.mtimeMs < cutoff) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error("🔥 [LOGGER ERROR] Failed to delete old log:", err);
            } else {
              console.log(`🧹 [CLEANUP] Deleted old log file: ${file}`);
            }
          });
        }
      });
    });
  });
}

// Run cleanup on startup
deleteOldLogs();

const isDev = process.env.NODE_ENV === "development";

const logger = {
  // 🔥 Critical errors
  error(err, context = "") {
    const msg = err instanceof Error ? err.message : err;
    const line = `${timestamp()} 🔥 [ERROR] ${context} ${msg}`;

    console.error(line);
    writeToFile(combinedLog, line);
    writeToFile(errorLog, line);

    if (err instanceof Error) {
      console.error(err.stack);
      writeToFile(combinedLog, err.stack);
      writeToFile(errorLog, err.stack);
    }
  },

  // ⚠️ Warnings
  warn(message, context = "") {
    const line = `${timestamp()} ⚠️ [WARN] ${context} ${message}`;
    console.warn(line);
    writeToFile(combinedLog, line);
  },

  // 🛠 Debug (dev only)
  debug(label, data = "") {
    if (isDev) {
      const line = `${timestamp()} 🛠 [DEBUG] ${label}: ${JSON.stringify(data)}`;
      console.log(line);
      writeToFile(combinedLog, line);
    }
  },

  // 📦 Database operations
  db(action, details = "") {
    const line = `${timestamp()} 📦 [DB] ${action} ${JSON.stringify(details)}`;
    console.log(line);
    writeToFile(combinedLog, line);
  },

  // 🔐 Authentication events
  auth(message, details = "") {
    const line = `${timestamp()} 🔐 [AUTH] ${message} ${JSON.stringify(details)}`;
    console.log(line);
    writeToFile(combinedLog, line);
  },

  // 🧭 Route hits
  route(method, url) {
    const line = `${timestamp()} 🧭 [ROUTE] ${method} ${url}`;
    console.log(line);
    writeToFile(combinedLog, line);
  },

  // ⏱️ HTTP timing logs + slow route alerts
  http(method, url, status, durationMs) {
    const line = `${timestamp()} ⏱️ [HTTP] ${method} ${url} ${status} ${durationMs}ms`;
    console.log(line);
    writeToFile(combinedLog, line);

    // Slow route alert
    if (durationMs > slowThreshold) {
      const slowLine = `${timestamp()} 🐢 [SLOW] ${method} ${url} ${durationMs}ms`;
      console.warn(slowLine);
      writeToFile(combinedLog, slowLine);
    }
  },

  // 🧹 Cleanup tasks
  cleanup(message, details = "") {
    const line = `${timestamp()} 🧹 [CLEANUP] ${message} ${JSON.stringify(details)}`;
    console.log(line);
    writeToFile(combinedLog, line);
  },

  // 🚀 Startup
  start(port) {
    const line = `${timestamp()} 🚀 [START] Server running on port ${port}`;
    console.log(line);
    writeToFile(combinedLog, line);
  }
};

module.exports = logger;