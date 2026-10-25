ALTER TABLE "routines"
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failureStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pauseReason" TEXT,
  ADD COLUMN "skipStale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastSkippedAt" TIMESTAMP(3);
-- Preserve legacy overdue behavior; only new routines opt in by default.
ALTER TABLE "routines" ALTER COLUMN "skipStale" SET DEFAULT true;
ALTER TABLE "runs"
  ADD COLUMN "routineGeneration" INTEGER,
  ADD COLUMN "routineScheduledFor" TIMESTAMP(3);
CREATE UNIQUE INDEX "runs_routineId_routineGeneration_routineScheduledFor_key"
  ON "runs"("routineId", "routineGeneration", "routineScheduledFor");
CREATE TABLE "scheduler_health" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL
);
