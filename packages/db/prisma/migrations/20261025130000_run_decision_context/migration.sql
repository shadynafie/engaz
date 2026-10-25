-- Historical decision context remains unknown; do not infer it from current policy.
ALTER TABLE "runs" ADD COLUMN "originRunId" TEXT, ADD COLUMN "originTrigger" TEXT;
ALTER TABLE "external_effects" ADD COLUMN "decisionSource" TEXT, ADD COLUMN "decisionByUserId" TEXT;
