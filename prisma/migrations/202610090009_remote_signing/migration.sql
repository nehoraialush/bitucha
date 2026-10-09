ALTER TABLE "ProductVersion" ADD COLUMN "waitingWaiverAllowed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "minClaimFreeMonths" INTEGER NOT NULL DEFAULT 12 CHECK ("minClaimFreeMonths" >= 1 AND "minClaimFreeMonths" <= 120);
CREATE TABLE "SigningRequest" (
 "id" TEXT PRIMARY KEY, "workflowId" TEXT NOT NULL REFERENCES "WorkflowInstance"("id"),
 "tokenHash" TEXT NOT NULL UNIQUE, "snapshot" JSONB NOT NULL, "contentHash" TEXT NOT NULL,
 "workflowVersion" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SIGNED','REVOKED')),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "signedAt" TIMESTAMP(3)
);
CREATE INDEX "SigningRequest_workflowId_createdAt_idx" ON "SigningRequest"("workflowId","createdAt");
CREATE TABLE "SigningEvent" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "SigningRequest"("id"),
 "kind" TEXT NOT NULL, "actorType" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SigningEvent_requestId_createdAt_idx" ON "SigningEvent"("requestId","createdAt");
