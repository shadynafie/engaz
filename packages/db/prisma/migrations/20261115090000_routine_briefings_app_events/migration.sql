ALTER TABLE "routines" ADD COLUMN "quietBriefing" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "appEvent" JSONB;
ALTER TABLE "runs" ADD COLUMN "briefingSnapshotAt" TIMESTAMP(3);
