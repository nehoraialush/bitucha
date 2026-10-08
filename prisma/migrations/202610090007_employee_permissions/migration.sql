ALTER TABLE "Employee" ADD COLUMN "department" TEXT NOT NULL DEFAULT '', ADD COLUMN "team" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "managerId" TEXT REFERENCES "Employee"("id"), ADD COLUMN "permissionMode" TEXT NOT NULL DEFAULT 'ROLE',
 ADD COLUMN "approvalLimitCents" INTEGER CHECK ("approvalLimitCents" >= 0);
ALTER TABLE "Employee" ADD CONSTRAINT "employee_permission_mode" CHECK ("permissionMode" IN ('ROLE','CUSTOM'));
CREATE TABLE "EmployeePermission" (
 "id" TEXT PRIMARY KEY, "employeeId" TEXT NOT NULL REFERENCES "Employee"("id"), "permission" TEXT NOT NULL,
 UNIQUE("employeeId","permission")
);
