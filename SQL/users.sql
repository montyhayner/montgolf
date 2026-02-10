BEGIN TRANSACTION;
DROP TABLE USERS;
CREATE TABLE IF NOT EXISTS "users" (
	"id"	INTEGER,
	"last_name"	TEXT NOT NULL,
	"first_name"	TEXT NOT NULL,
	"email"	TEXT NOT NULL UNIQUE,
	"password_hash"	TEXT NOT NULL,
	"is_admin"	INTEGER DEFAULT 0,
	"league_name"	TEXT NOT NULL,
	"Play_Days_Of_Week"	TEXT DEFAULT  ,
	"subgroup"	TEXT NOT NULL DEFAULT #,
	"subgroup_number"	INTEGER,
	PRIMARY KEY("id" AUTOINCREMENT)
);
COMMIT;
