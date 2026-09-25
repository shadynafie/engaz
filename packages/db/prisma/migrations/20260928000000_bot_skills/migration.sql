-- CreateTable
CREATE TABLE "bot_skills" (
    "botId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_skills_pkey" PRIMARY KEY ("botId","skillId")
);

-- CreateIndex
CREATE INDEX "bot_skills_skillId_idx" ON "bot_skills"("skillId");

-- AddForeignKey
ALTER TABLE "bot_skills" ADD CONSTRAINT "bot_skills_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_skills" ADD CONSTRAINT "bot_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "agent_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every agent already received all of its owner's skills; keep that on upgrade.
INSERT INTO "bot_skills" ("botId", "skillId")
SELECT b."id", s."id"
FROM "agent_skills" s
JOIN "bots" b ON b."spaceId" = s."spaceId" AND b."userId" = s."userId";
