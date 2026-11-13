-- Fork: daily check-ins are opt-in. 20261116120000_bot_daily_check_ins added the column switched on
-- for every bot; nobody here had chosen a value yet, so existing bots start off too.
ALTER TABLE "bots" ALTER COLUMN "dailyCheckIns" SET DEFAULT false;
UPDATE "bots" SET "dailyCheckIns" = false WHERE "dailyCheckIns";
