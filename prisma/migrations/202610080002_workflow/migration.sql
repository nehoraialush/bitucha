ALTER TABLE "ClaimLine" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Policy" ADD COLUMN "exclusions" JSONB NOT NULL DEFAULT '[]';
CREATE TABLE "PolicySuspension" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "policyId" TEXT NOT NULL REFERENCES "Policy"("id"),
 "startDate" DATE NOT NULL,
 "endDate" DATE,
 "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ("endDate" IS NULL OR "endDate">="startDate")
);
CREATE UNIQUE INDEX policy_one_open_suspension ON "PolicySuspension"("policyId") WHERE "endDate" IS NULL;
CREATE TABLE "Task" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "title" TEXT NOT NULL,
 "dueAt" DATE NOT NULL,
 "assignedTo" TEXT NOT NULL REFERENCES "Employee"("id"),
 "status" TEXT NOT NULL DEFAULT 'OPEN',
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
 "completedAt" TIMESTAMPTZ
);
CREATE INDEX ON "Task"("customerId","status");
CREATE FUNCTION immutable_product_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published THEN RAISE EXCEPTION 'Published product versions are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER product_version_immutable BEFORE UPDATE ON "ProductVersion" FOR EACH ROW EXECUTE FUNCTION immutable_product_version();
