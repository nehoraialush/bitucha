CREATE TABLE "DocumentArtifact" (
 "id" TEXT PRIMARY KEY, "documentId" TEXT NOT NULL UNIQUE REFERENCES "Document"("id") ON DELETE CASCADE,
 "templateVersion" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','PROCESSING','READY','FAILED')),
 "attempts" INTEGER NOT NULL DEFAULT 0, "html" TEXT, "htmlHash" TEXT,
 "content" BYTEA, "pdfHash" TEXT, "errorCode" TEXT,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("status" != 'READY' OR ("content" IS NOT NULL AND "pdfHash" IS NOT NULL AND "htmlHash" IS NOT NULL))
);
CREATE INDEX "DocumentArtifact_status_nextAttemptAt_idx" ON "DocumentArtifact"("status","nextAttemptAt");
