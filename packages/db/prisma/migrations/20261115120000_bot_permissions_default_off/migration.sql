-- New bots ask for fleet management and cross-space communication to be turned on (fork change).
-- Existing bots keep their settings.
ALTER TABLE "bots" ALTER COLUMN "crossSpaceCommunication" SET DEFAULT false;
ALTER TABLE "bots" ALTER COLUMN "fleetManagement" SET DEFAULT false;
