BEGIN TRANSACTION;
DROP TABLE IF EXISTS "league_play_days";
CREATE TABLE "league_play_days" (
	"id"	INTEGER,
	"league_id"	INTEGER NOT NULL,
	"day_of_week"	INTEGER NOT NULL CHECK("day_of_week" BETWEEN 0 AND 6),
	"is_play_day"	INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY("id" AUTOINCREMENT),
	UNIQUE("league_id","day_of_week")
);
DROP TABLE IF EXISTS "leagues";
CREATE TABLE "leagues" (
	"id"	INTEGER,
	"league_name"	TEXT NOT NULL UNIQUE,
	"coordinator_last_name"	,
	"coordinator_first_name"	,
	PRIMARY KEY("id" AUTOINCREMENT),
	UNIQUE("league_name")
);
DROP TABLE IF EXISTS "schedule";
CREATE TABLE "schedule" (
	"sched_id"	INTEGER,
	"user_id"	INTEGER NOT NULL,
	"date"	TEXT NOT NULL,
	"playing"	INTEGER NOT NULL,
	PRIMARY KEY("sched_id" AUTOINCREMENT),
	UNIQUE("user_id","date")
);
DROP TABLE IF EXISTS "schedules";
CREATE TABLE "schedules" (
	"id"	INTEGER,
	"user_id"	INTEGER NOT NULL,
	"week_start_date"	TEXT NOT NULL,
	"monday"	INTEGER DEFAULT 0,
	"tuesday"	INTEGER DEFAULT 0,
	"wednesday"	INTEGER DEFAULT 0,
	"thursday"	INTEGER DEFAULT 0,
	"friday"	INTEGER DEFAULT 0,
	"saturday"	INTEGER DEFAULT 0,
	"sunday"	INTEGER DEFAULT 0,
	PRIMARY KEY("id" AUTOINCREMENT),
	UNIQUE("user_id","week_start_date"),
	FOREIGN KEY("user_id") REFERENCES "users"("id")
);
DROP TABLE IF EXISTS "user_play_days";
CREATE TABLE "user_play_days" (
	"id"	INTEGER,
	"user_id"	INTEGER NOT NULL,
	"day_of_week"	INTEGER NOT NULL CHECK("day_of_week" BETWEEN 0 AND 6),
	"is_play_day"	INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY("id" AUTOINCREMENT),
	UNIQUE("user_id","day_of_week")
);
DROP TABLE IF EXISTS "user_play_months";
CREATE TABLE "user_play_months" (
	"id"	INTEGER,
	"user_id"	INTEGER NOT NULL,
	"month"	INTEGER NOT NULL CHECK("month" BETWEEN 1 AND 12),
	"in_town"	INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY("id" AUTOINCREMENT),
	UNIQUE("user_id","month")
);
DROP TABLE IF EXISTS "users";
CREATE TABLE "users" (
	"id"	INTEGER,
	"last_name"	TEXT NOT NULL,
	"first_name"	TEXT NOT NULL,
	"email"	TEXT NOT NULL,
	"password_hash"	TEXT NOT NULL,
	"is_admin"	INTEGER NOT NULL CHECK("is_admin" IN (0, 1)),
	"league_name"	TEXT NOT NULL,
	"subgroup"	TEXT NOT NULL,
	"subgroup_number"	INTEGER NOT NULL,
	"is_member"	INTEGER NOT NULL CHECK("is_member" IN (0, 1)),
	UNIQUE("email","league_name"),
	PRIMARY KEY("id" AUTOINCREMENT)
);
INSERT INTO "league_play_days" ("id","league_id","day_of_week","is_play_day") VALUES (1,'RENEGADES',0,0);
INSERT INTO "league_play_days" ("id","league_id","day_of_week","is_play_day") VALUES (2,'RENEGADES',1,1);
INSERT INTO "league_play_days" ("id","league_id","day_of_week","is_play_day") VALUES (3,'RENEGADES',2,0);
INSERT INTO "league_play_days" ("id","league_id","day_of_week","is_play_day") VALUES (4,'RENEGADES',3,1);
INSERT INTO "league_play_days" ("id","league_id","day_of_week","is_play_day") VALUES (5,'RENEGADES',4,0);
INSERT INTO "league_play_days" ("id","league_id","day_of_week","is_play_day") VALUES (6,'RENEGADES',5,1);
INSERT INTO "league_play_days" ("id","league_id","day_of_week","is_play_day") VALUES (7,'RENEGADES',6,0);
INSERT INTO "leagues" ("id","league_name","coordinator_last_name","coordinator_first_name") VALUES (1,'Renegades','Hayner','Monty');
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (1,19,0,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (2,19,1,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (3,19,2,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (4,19,3,1);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (5,19,4,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (6,19,5,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (7,19,6,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (8,24,0,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (9,24,1,1);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (10,24,2,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (11,24,3,1);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (12,24,4,0);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (13,24,5,1);
INSERT INTO "user_play_days" ("id","user_id","day_of_week","is_play_day") VALUES (14,24,6,0);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (1,19,1,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (2,19,2,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (3,19,3,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (4,19,4,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (5,19,5,0);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (6,19,6,0);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (7,19,7,0);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (8,19,8,0);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (9,19,9,0);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (10,19,10,0);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (11,19,11,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (12,19,12,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (13,24,1,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (14,24,2,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (15,24,3,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (16,24,4,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (17,24,5,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (18,24,6,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (19,24,7,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (20,24,8,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (21,24,9,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (22,24,10,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (23,24,11,1);
INSERT INTO "user_play_months" ("id","user_id","month","in_town") VALUES (24,24,12,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (2,'Barber','Tom','tkbarber@comcast.net','0000',0,'Renegades','B',2,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (3,'Blauman','Mike','mikeblauman@yahoo.com','0000',0,'Renegades','#',0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (4,'Fabris','Denny','fabris.dm@gmail.com','0000',0,'Renegades','C',5,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (5,'King','Bill','wnking1962@gmail.com','0000',0,'Renegades','C',1,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (6,'Lonergan','Paul','longerganpg@gmail.com','0000',0,'Renegades','C',2,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (7,'Mason','Jerry','47oldmasonjar@gmail.com','0000',0,'Renegades','#',0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (8,'Mason','Ralph','ralph.mason313@gmail.com','0000',0,'Renegades','C',3,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (10,'Rose','Jack','jtrosejr@outlook.com','0000',0,'Renegades','C',4,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (11,'Spalding','Bill','wgspalding@gmail.com','0000',0,'Renegades','D',3,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (12,'Walsh','Dave','dwalsh48@aol.com','0000',0,'Renegades','D',1,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (13,'Bischof','Bill','billbischof@rocketmail.com','0000',0,'Renegades','F',5,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (16,'Jameson','Bob','linbobj1212@gmail.com','0000',0,'Renegades','#',0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (17,'Johnson','Fred','fredzoio@gmail.com','0000',0,'Renegades','D',5,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (18,'LaPierre','Tico','michaellapierre103@hotmail.com','0000',0,'Renegades','D',4,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (19,'LeoFanti','Ralph','montyhayner@gmail.com','0000',0,'Renegades','D',3,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (20,'Lillquist','Jeff','jeffreylillquist@comcast.net','0000',0,'Renegades','A',5,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (21,'Hill','Jay','hilljayann@gmail.com','0000',0,'Renegades','#',0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (22,'Tsolinas','Pete','tmapete@aol.com','0000',0,'Renegades','#',0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (23,'Waligora','Roger','fivehead47@gmail.com','0000',0,'Renegades','A',3,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (24,'Hayner','Monty','rlhayner@verizon.net','1664',1,'Renegades','#',0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (25,'Wickman','Bill','friscowickm@aol.com','0000',1,'Renegades','D',2,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (27,'Perilli','Frank','perilli@pga.com','0000',1,'Renegades','F',1,1);
COMMIT;
