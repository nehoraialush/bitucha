ALTER TABLE "Customer" ADD COLUMN "identifier" TEXT, ADD COLUMN "profile" JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX "Customer_identifier_key" ON "Customer"("identifier");
ALTER TABLE "Pet" ADD COLUMN "profile" JSONB NOT NULL DEFAULT '{}';
