-- After the owner exists, new accounts need an invitation link from the owner.
ALTER TABLE "deployment_settings" ADD COLUMN "signupsInviteOnly" boolean NOT NULL DEFAULT true;

CREATE TABLE "signup_invites" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signup_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signup_invites_tokenHash_key" ON "signup_invites"("tokenHash");
CREATE INDEX "signup_invites_usedByEmail_idx" ON "signup_invites"("usedByEmail");

ALTER TABLE "signup_invites" ADD CONSTRAINT "signup_invites_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
