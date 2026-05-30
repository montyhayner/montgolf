const Database = require('better-sqlite3');

console.log("LOADING DB.JS FROM:", __filename);

// Open the database (synchronous, fast, stable)
const db = new Database('./golf.db');

// Async-like wrappers to match your existing code style
db.getAsync = (sql, params = []) => {
  return Promise.resolve(db.prepare(sql).get(params));
};

db.allAsync = (sql, params = []) => {
  return Promise.resolve(db.prepare(sql).all(params));
};

db.runAsync = (sql, params = []) => {
  return Promise.resolve(db.prepare(sql).run(params));
};

module.exports = db;
