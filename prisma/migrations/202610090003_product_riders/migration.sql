CREATE TABLE "ProductRider" (
 "id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "ProductVersion"("id"),
 "code" TEXT NOT NULL, "name" TEXT NOT NULL, "premiumCents" INTEGER NOT NULL CHECK ("premiumCents" >= 0),
 "limitIncreaseCents" INTEGER NOT NULL DEFAULT 0 CHECK ("limitIncreaseCents" >= 0),
 "coverage" JSONB, "species" TEXT NOT NULL, "minAgeMonths" INTEGER NOT NULL,
 "maxAgeMonths" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("productId","code")
);
