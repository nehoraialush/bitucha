import type { OpenAPIObject } from "@nestjs/swagger";
const string = { type: "string" };
const cents = {
  type: "integer",
  minimum: 0,
  maximum: 100000000,
  description: "סכום באגורות ILS",
};
const date = { type: "string", format: "date", example: "2026-10-08" };
function object(properties: any, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}
export function documentContracts(document: OpenAPIObject) {
  const schemas: Record<string, any> = {
    Login: object(
      {
        email: { type: "string", format: "email" },
        password: { type: "string", format: "password" },
      },
      ["email", "password"],
    ),
    Customer: object(
      {
        name: string,
        phone: string,
        email: string,
        address: string,
        notes: string,
      },
      ["name", "phone"],
    ),
    CustomerUpdate: object(
      {
        name: string,
        phone: string,
        address: string,
        notes: string,
        version: { type: "integer", minimum: 1 },
      },
      ["name", "phone", "version"],
    ),
    Pet: object(
      {
        name: string,
        species: { type: "string", enum: ["DOG", "CAT"] },
        breed: string,
        sex: { type: "string", enum: ["MALE", "FEMALE"] },
        birthDate: date,
        chip: { type: "string", pattern: "^[0-9]{15}$" },
        vaccinated: { type: "boolean" },
        neutered: { type: "boolean" },
        medicalHistory: string,
      },
      ["name", "species", "breed", "sex", "birthDate", "vaccinated"],
    ),
    Quote: object({ petId: string, productId: string, startDate: date }, [
      "petId",
      "productId",
      "startDate",
    ]),
    Underwriting: object(
      {
        decision: { type: "string", enum: ["APPROVE", "REJECT"] },
        reason: string,
        excludedCategories: { type: "array", items: string },
      },
      ["decision", "reason"],
    ),
    Activation: object(
      {
        accepted: { type: "boolean", enum: [true] },
        paymentMethod: { type: "string", enum: ["SIMULATED_ANNUAL"] },
      },
      ["accepted", "paymentMethod"],
    ),
    Claim: object(
      {
        policyId: string,
        eventDate: date,
        diagnosis: string,
        clinic: string,
        lines: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: object(
            {
              category: string,
              description: string,
              costCents: { ...cents, minimum: 1, maximum: 10000000 },
            },
            ["category", "description", "costCents"],
          ),
        },
      },
      ["policyId", "eventDate", "diagnosis", "clinic", "lines"],
    ),
    ClaimDecision: object(
      {
        decision: {
          type: "string",
          enum: ["APPROVE", "REJECT", "NEEDS_INFORMATION"],
        },
        reason: string,
      },
      ["decision", "reason"],
    ),
    Collection: object({ amountCents: { ...cents, minimum: 1 } }, [
      "amountCents",
    ]),
    Cancellation: object({ at: date, reason: string }, ["at", "reason"]),
    Reason: object({ reason: string }, ["reason"]),
    Signature: object({ accepted: { type: "boolean", enum: [true] } }, [
      "accepted",
    ]),
    ServiceCase: object(
      {
        customerId: string,
        subject: string,
        description: string,
        priority: { type: "string", enum: ["NORMAL", "HIGH", "URGENT"] },
      },
      ["customerId", "subject", "description", "priority"],
    ),
    CaseStatus: object(
      { status: { type: "string", enum: ["OPEN", "CLOSED"] }, reason: string },
      ["status", "reason"],
    ),
    Task: object({ customerId: string, title: string, dueAt: date }, [
      "customerId",
      "title",
      "dueAt",
    ]),
    ProductVersion: object(
      {
        name: string,
        premiumCents: { ...cents, minimum: 1 },
        annualLimitCents: { ...cents, minimum: 1 },
        deductibleCents: cents,
        reimbursementBps: { type: "integer", minimum: 1, maximum: 10000 },
        waitingDays: { type: "integer", minimum: 0, maximum: 365 },
        coverages: {
          type: "array",
          minItems: 1,
          items: object(
            {
              code: string,
              name: string,
              limitCents: { ...cents, minimum: 1 },
            },
            ["code", "name", "limitCents"],
          ),
        },
      },
      [
        "name",
        "premiumCents",
        "annualLimitCents",
        "deductibleCents",
        "reimbursementBps",
        "waitingDays",
        "coverages",
      ],
    ),
  };
  document.components ??= {};
  document.components.schemas = { ...document.components.schemas, ...schemas };
  const requests: Record<string, string> = {
    "POST /api/v1/auth/login": "Login",
    "POST /api/v1/customers": "Customer",
    "PATCH /api/v1/customers/{id}": "CustomerUpdate",
    "POST /api/v1/customers/{id}/pets": "Pet",
    "POST /api/v1/policies": "Quote",
    "POST /api/v1/policies/{id}/underwrite": "Underwriting",
    "POST /api/v1/policies/{id}/activate": "Activation",
    "POST /api/v1/policies/{id}/cancel": "Cancellation",
    "POST /api/v1/policies/{id}/suspend": "Reason",
    "POST /api/v1/policies/{id}/reinstate": "Reason",
    "POST /api/v1/claims": "Claim",
    "POST /api/v1/claims/{id}/decide": "ClaimDecision",
    "POST /api/v1/charges/{id}/collect-simulated": "Collection",
    "POST /api/v1/documents/{id}/sign-simulated": "Signature",
    "POST /api/v1/service-cases": "ServiceCase",
    "PATCH /api/v1/service-cases/{id}": "CaseStatus",
    "POST /api/v1/tasks": "Task",
    "POST /api/v1/products/{id}/versions": "ProductVersion",
  };
  for (const [path, entry] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(entry as any)) {
      if (!["get", "post", "patch"].includes(method) || !operation) continue;
      const op = operation as any;
      const schema = requests[method.toUpperCase() + " " + path];
      if (schema)
        op.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/" + schema },
            },
          },
        };
      if (["post", "patch"].includes(method) && !path.includes("/auth/login")) {
        op.parameters ??= [];
        op.parameters.push({
          in: "header",
          name: "X-CSRF-Token",
          required: true,
          schema: string,
          description: "הערך שמתקבל בהתחברות או ב־auth/session",
        });
        if (
          path.includes("/policies") ||
          path.includes("/claims") ||
          path.includes("/payment-orders") ||
          path.includes("/collect-simulated") ||
          path.includes("/sign-simulated") ||
          path.includes("/versions")
        )
          op.parameters.push({
            in: "header",
            name: "Idempotency-Key",
            required: true,
            schema: { type: "string", maxLength: 120 },
            description:
              "מפתח ייחודי לפעולה; יש לשמור אותו בניסיון חוזר של אותה בקשה",
          });
      }
      op.responses = {
        ...op.responses,
        "400": { description: "נתונים לא תקינים" },
        "401": { description: "נדרשת התחברות" },
        "403": { description: "הרשאה חסרה או CSRF שגוי" },
        "409": { description: "התנגשות גרסה, מצב או idempotency" },
      };
    }
  return document;
}
