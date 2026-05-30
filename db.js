const sqlite3 = require('sqlite3').verbose();

console.log("LOADING DB.JS FROM:", __filename);

const db = new sqlite3.Database('./golf.db', (err) => {
  if (err) {
    console.error("❌ SQLITE OPEN ERROR:", err.message);
  } else {
    console.log("✔ SQLITE OPEN SUCCESS:", db.filename);
    console.log("DB METHODS NOW AVAILABLE:", Object.keys(db));
  }
});

db.getAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.allAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

db.runAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

module.exports = db;