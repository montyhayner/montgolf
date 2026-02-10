const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./golf.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      league_name TEXT NOT NULL,
      Play_Days_Of_Week TEXT DEFAULT " ",
      subgroup TEXT NOT NULL DEFAULT "#",
      subgroup_number INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      week_start_date TEXT NOT NULL,
      monday INTEGER DEFAULT 0,
      tuesday INTEGER DEFAULT 0,
      wednesday INTEGER DEFAULT 0,
      thursday INTEGER DEFAULT 0,
      friday INTEGER DEFAULT 0,
      saturday INTEGER DEFAULT 0,
      sunday INTEGER DEFAULT 0,
      UNIQUE(user_id, week_start_date),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
});

module.exports = db;