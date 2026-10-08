ALTER TABLE "Policy" ADD COLUMN "renewedFromId" TEXT UNIQUE REFERENCES "Policy"("id");
ALTER TABLE "Application" ADD COLUMN "renewalOfId" TEXT REFERENCES "Policy"("id");
