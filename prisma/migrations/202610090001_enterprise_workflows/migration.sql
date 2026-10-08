CREATE TABLE "WorkflowInstance" (
 "id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "definitionVersion" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'DRAFT', "version" INTEGER NOT NULL DEFAULT 1,
 "currentStep" INTEGER NOT NULL DEFAULT 1, "assignedTo" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "workflow_step_range" CHECK ("currentStep" BETWEEN 1 AND 18),
 CONSTRAINT "workflow_status" CHECK ("status" IN ('DRAFT','WAITING_APPROVAL','READY','COMPLETED','REJECTED'))
);
CREATE INDEX "WorkflowInstance_type_status_updatedAt_idx" ON "WorkflowInstance"("type","status","updatedAt");
CREATE TABLE "Application" (
 "id" TEXT PRIMARY KEY, "number" SERIAL UNIQUE NOT NULL, "workflowId" TEXT UNIQUE NOT NULL REFERENCES "WorkflowInstance"("id"),
 "customerId" TEXT REFERENCES "Customer"("id"), "petId" TEXT REFERENCES "Pet"("id"),
 "productId" TEXT REFERENCES "ProductVersion"("id"), "policyId" TEXT UNIQUE REFERENCES "Policy"("id"),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Application_customerId_idx" ON "Application"("customerId");
CREATE TABLE "WorkflowStep" (
 "id" TEXT PRIMARY KEY, "workflowId" TEXT NOT NULL REFERENCES "WorkflowInstance"("id"),
 "number" INTEGER NOT NULL CHECK ("number" BETWEEN 1 AND 18), "revision" INTEGER NOT NULL,
 "definitionVersion" INTEGER NOT NULL, "answers" JSONB NOT NULL, "completed" BOOLEAN NOT NULL DEFAULT false,
 "employeeId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("workflowId","number","revision")
);
CREATE TABLE "ApprovalRequest" (
 "id" TEXT PRIMARY KEY, "workflowId" TEXT NOT NULL REFERENCES "WorkflowInstance"("id"),
 "status" TEXT NOT NULL DEFAULT 'PENDING', "kind" TEXT NOT NULL, "requestedBy" TEXT NOT NULL,
 "decidedBy" TEXT, "reason" TEXT NOT NULL DEFAULT '', "decision" JSONB, "workflowVersion" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "decidedAt" TIMESTAMP(3)
);
CREATE INDEX "ApprovalRequest_status_kind_idx" ON "ApprovalRequest"("status","kind");
CREATE TABLE "WorkflowAttachment" (
 "id" TEXT PRIMARY KEY, "workflowId" TEXT NOT NULL REFERENCES "WorkflowInstance"("id"),
 "kind" TEXT NOT NULL, "filename" TEXT NOT NULL, "mediaType" TEXT NOT NULL,
 "digest" TEXT NOT NULL, "content" BYTEA NOT NULL CHECK (octet_length("content") <= 1048576),
 "status" TEXT NOT NULL DEFAULT 'RECEIVED', "employeeId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkflowAttachment_workflowId_idx" ON "WorkflowAttachment"("workflowId");
