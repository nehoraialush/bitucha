CREATE TABLE "Employee" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "csrf" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL
);

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "number" SERIAL NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT NOT NULL,
  "address" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Pet" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "species" TEXT NOT NULL,
  "breed" TEXT NOT NULL,
  "sex" TEXT NOT NULL,
  "birthDate" DATE NOT NULL,
  "chip" TEXT UNIQUE,
  "vaccinated" BOOLEAN NOT NULL,
  "neutered" BOOLEAN NOT NULL DEFAULT false,
  "weight" DOUBLE PRECISION,
  "medicalHistory" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "ProductVersion" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "species" TEXT NOT NULL,
  "minAgeMonths" INTEGER NOT NULL,
  "maxAgeMonths" INTEGER NOT NULL,
  "premiumCents" INTEGER NOT NULL,
  "annualLimitCents" INTEGER NOT NULL,
  "deductibleCents" INTEGER NOT NULL,
  "reimbursementBps" INTEGER NOT NULL,
  "waitingDays" INTEGER NOT NULL,
  "coverages" JSONB NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("code","version")
);

CREATE TABLE "Policy" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "number" SERIAL NOT NULL UNIQUE,
  "customerId" TEXT NOT NULL,
  "petId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "cancelledAt" DATE,
  "snapshot" JSONB NOT NULL,
  "premiumCents" INTEGER NOT NULL,
  "annualLimitCents" INTEGER NOT NULL,
  "reservedCents" INTEGER NOT NULL DEFAULT 0,
  "paidCents" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "underwritingReason" TEXT NOT NULL DEFAULT '',
  "conditionsAccepted" BOOLEAN NOT NULL DEFAULT false,
  "paymentMethod" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Claim" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "number" SERIAL NOT NULL UNIQUE,
  "policyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "eventDate" DATE NOT NULL,
  "diagnosis" TEXT NOT NULL,
  "clinic" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "approvedCents" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "ClaimLine" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "claimId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "costCents" INTEGER NOT NULL,
  "approvedCents" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL DEFAULT ''
);

CREATE TABLE "PaymentOrder" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "claimId" TEXT NOT NULL UNIQUE,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPROVED',
  "executedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Charge" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "policyId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "paidCents" INTEGER NOT NULL DEFAULT 0,
  "creditedCents" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL DEFAULT 'PREMIUM',
  "dueAt" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "customerId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Document" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "number" SERIAL NOT NULL UNIQUE,
  "customerId" TEXT NOT NULL,
  "policyId" TEXT,
  "claimId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "signedAt" TIMESTAMPTZ,
  "signedBy" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "ServiceCase" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "number" SERIAL NOT NULL UNIQUE,
  "customerId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "assignedTo" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "employeeId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "customerId" TEXT,
  "reason" TEXT NOT NULL DEFAULT '',
  "before" JSONB,
  "after" JSONB,
  "processId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Command" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "key" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("employeeId","action","key")
);

ALTER TABLE "Session" ADD FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT;

ALTER TABLE "Pet" ADD FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT;

ALTER TABLE "Policy" ADD FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT;

ALTER TABLE "Policy" ADD FOREIGN KEY ("petId") REFERENCES "Pet" ("id") ON DELETE RESTRICT;

ALTER TABLE "Policy" ADD FOREIGN KEY ("productId") REFERENCES "ProductVersion" ("id") ON DELETE RESTRICT;

ALTER TABLE "Claim" ADD FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE RESTRICT;

ALTER TABLE "ClaimLine" ADD FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE RESTRICT;

ALTER TABLE "PaymentOrder" ADD FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE RESTRICT;

ALTER TABLE "Charge" ADD FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE RESTRICT;

ALTER TABLE "ServiceCase" ADD FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT;

CREATE INDEX ON "Policy" ("petId","status");

CREATE INDEX ON "LedgerEntry" ("customerId","createdAt");

CREATE INDEX ON "Document" ("customerId");

CREATE INDEX ON "AuditEvent" ("customerId","createdAt");

ALTER TABLE "Policy" ADD CONSTRAINT policy_money CHECK ("annualLimitCents">0 AND "reservedCents">=0 AND "paidCents">=0 AND "reservedCents"+"paidCents"<="annualLimitCents");

ALTER TABLE "Policy" ADD CONSTRAINT policy_dates CHECK ("endDate">"startDate");

ALTER TABLE "Charge" ADD CONSTRAINT charge_money CHECK ("amountCents">=0 AND "paidCents">=0 AND "creditedCents">=0 AND "creditedCents"<="amountCents");

ALTER TABLE "ClaimLine" ADD CONSTRAINT claim_line_money CHECK ("costCents">0 AND "approvedCents">=0 AND "approvedCents"<="costCents");
