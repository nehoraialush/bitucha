ALTER TABLE "WorkflowAttachment" ADD COLUMN "reviewedBy" TEXT,
 ADD COLUMN "reviewReason" TEXT NOT NULL DEFAULT '', ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "WorkflowAttachment" ADD CONSTRAINT "attachment_status" CHECK ("status" IN ('RECEIVED','APPROVED','REJECTED'));
