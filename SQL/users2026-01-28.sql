BEGIN TRANSACTION;
DROP TABLE IF EXISTS "users";
CREATE TABLE "users" (
	"id"	INTEGER,
	"last_name"	TEXT NOT NULL,
	"first_name"	TEXT NOT NULL,
	"email"	TEXT NOT NULL UNIQUE,
	"password_hash"	TEXT NOT NULL,
	"is_admin"	INTEGER NOT NULL CHECK(is_admin in (0,1)),
	"league_name"	TEXT NOT NULL, 
	"subgroup"	TEXT NOT NULL,
	"subgroup_number"	INTEGER NOT NULL,
	"is_member" INTEGER NOT NULL CHECK(is_member in (0,1)),
    UNIQUE(email,league_name),
	PRIMARY KEY("id" AUTOINCREMENT) 
	);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (2,'Barber','Tom','tkbarber@comcast.net','0000',0,'Renegades','B',2,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (3,'Blauman','Mike','mikeblauman@yahoo.com','0000',0,'Renegades',"#",0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (4,'Fabris','Denny','fabris.dm@gmail.com','0000',0,'Renegades','C',5,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (5,'King','Bill','wnking1962@gmail.com','0000',0,'Renegades','C',1,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (6,'Lonergan','Paul','longerganpg@gmail.com','0000',0,'Renegades','C',2,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (7,'Mason','Jerry','47oldmasonjar@gmail.com','0000',0,'Renegades',"#",0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (8,'Mason','Ralph','ralph.mason313@gmail.com','0000',0,'Renegades','C',3,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (10,'Rose','Jack','jtrosejr@outlook.com','0000',0,'Renegades','C',4,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (11,'Spalding','Bill','wgspalding@gmail.com','0000',0,'Renegades','D',3,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (12,'Walsh','Dave','dwalsh48@aol.com','0000',0,'Renegades','D',1,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (13,'Bischof','Bill','billbischof@rocketmail.com','0000',0,'Renegades','F',5,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (16,'Jameson','Bob','linbobj1212@gmail.com','0000',0,'Renegades',"#",0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (17,'Johnson','Fred','fredzoio@gmail.com','0000',0,'Renegades','D',5,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (18,'LaPierre','Tico','michaellapierre103@hotmail.com','0000',0,'Renegades','D',4,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (19,'LeoFanti','Ralph','montyhayner@gmail.com','0000',0,'Renegades','D',3,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (20,'Lillquist','Jeff','jeffreylillquist@comcast.net','0000',0,'Renegades','A',5,0);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (21,'Hill','Jay','hilljayann@gmail.com','0000',0,'Renegades',"#",0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (22,'Tsolinas','Pete','tmapete@aol.com','0000',0,'Renegades',"#",0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (23,'Waligora','Roger','fivehead47@gmail.com','0000',0,'Renegades','A',3,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (24,'Hayner','Monty','rlhayner@verizon.net','1664',1,'Renegades',"#",0,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (25,'Wickman','Bill','friscowickm@aol.com','0000',1,'Renegades','D',2,1);
INSERT INTO "users" ("id","last_name","first_name","email","password_hash","is_admin","league_name","subgroup","subgroup_number","is_member") VALUES (27,'Perilli','Frank','perilli@pga.com','0000',1,'Renegades','F',1,1);
COMMIT;
