-- Opt-in: mirror a routine's completed runs to its bot's linked messaging DM.
ALTER TABLE "routines" ADD COLUMN "deliverToMessaging" BOOLEAN NOT NULL DEFAULT false;
