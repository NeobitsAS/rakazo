-- Whether a run's reply is mirrored to its bot's linked messaging DM, decided when it is created.
ALTER TABLE "runs" ADD COLUMN "deliverToMessaging" BOOLEAN NOT NULL DEFAULT false;
-- Carried through a held inbound delivery to the run that later answers it.
ALTER TABLE "steering_messages" ADD COLUMN "deliverToMessaging" BOOLEAN NOT NULL DEFAULT false;
