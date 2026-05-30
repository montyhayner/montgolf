const bcrypt = require('bcrypt');
const db = require('./db');

const name = "Monty";
const email = "rlhayner@verizon.net";
const password = "2156";   // your chosen password
const isAdmin = 1;         // 1 = admin, 0 = normal user

async function addUser() {
  try {
    const hash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (name, email, password_hash, is_admin)
       VALUES (?, ?, ?, ?)`,
      [name, email, hash, isAdmin],
      function (err) {
        if (err) {
          console.error("Error inserting user:", err.message);
        } else {
          console.log("User added with ID:", this.lastID);
        }
        db.close();
      }
    );
  } catch (err) {
    console.error("Hashing error:", err);
  }
}

addUser();