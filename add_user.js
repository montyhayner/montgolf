const bcrypt = require('bcrypt');
const db = require('./db');

async function addUser() {
  const name = "Test User";
  const email = "test@example.com";
  const password = "password123";   // You can change this
  const is_admin = 1;               // 1 = admin, 0 = normal user
  // league_name, Play_Days_Of_Week, subgroup, subgroup_number admin, 0 = normal user
  const league_name = "Renegades"; 
  const Play_Days_Of_Week = "MWF";
  const subgroup = "#";  // "#" = no subgroup
  const subgroup_number = "0"

  const password_hash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (name, email, password_hash, is_admin,
    league_name, Play_Days_Of_Week, subgroup, subgroup_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, email, password_hash, is_admin, league_name, 
        Play_Days_Of_Week, subgroup, subgroup_number ],
    function (err) {
      if (err) {
        console.error("Error inserting user:", err.message);
      } else {
        console.log("User added with ID:", this.lastID);
      }
      db.close();
    }
  );
}

addUser();