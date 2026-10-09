import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { Prisma } from "./generated/client";
import { Actor, need } from "./auth";
import { InsuranceService } from "./service";
import { text, integer, choice, date, today } from "./validation";
import { ageMonths, anniversary } from "../../../packages/domain/src/insurance";
import {
  ENROLLMENT_VERSION,
  enrollmentSteps,
  enrollmentDefinition,
  validateStep,
  latestSteps,
  paymentSchedule,
  declarations,
} from "../../../packages/domain/src/enrollment";
type Tx = Prisma.TransactionClient;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const command = new InsuranceService();
async function audit(
  tx: Tx,
  a: Actor,
  action: string,
  id: string,
  version: number,
  details: unknown,
) {
  await tx.auditEvent.create({
    data: {
      employeeId: a.id,
      action,
      entityId: id,
      processId: id,
      after: json({ version, details }),
    },
  });
}
async function load(tx: Tx, id: string) {
  const w = await tx.workflowInstance.findUnique({
    where: { id },
    include: {
      application: true,
      steps: { orderBy: [{ number: "asc" }, { revision: "asc" }] },
      approvals: { orderBy: { createdAt: "desc" } },
      attachments: {
        select: {
          id: true,
          kind: true,
          filename: true,
          mediaType: true,
          digest: true,
          status: true,
          createdAt: true,
          reviewedBy: true,
          reviewReason: true,
          reviewedAt: true,
        },
      },
    },
  });
  if (!w || w.type !== "ENROLLMENT")
    throw new NotFoundException("בקשת הצטרפות לא נמצאה");
  const renewal = w.application?.renewalOfId
    ? await tx.policy.findUnique({
        where: { id: w.application.renewalOfId },
        include: { customer: true, pet: true },
      })
    : null;
  return { ...w, renewal };
}
function stepAnswers(w: Awaited<ReturnType<typeof load>>, n: number) {
  return (latestSteps(w.steps)[n]?.answers || {}) as Record<string, any>;
}
function view(w: Awaited<ReturnType<typeof load>>) {
  return {
    ...w,
    steps: Object.values(latestSteps(w.steps)),
    definition: enrollmentDefinition(w.definitionVersion),
  };
}
async function locked(tx: Tx, id: string, version: unknown) {
  await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id=${id} FOR UPDATE`;
  const w = await load(tx, id);
  if (w.version !== integer(version, "גרסת תהליך", 1))
    throw new ConflictException("התהליך השתנה. יש לרענן לפני שמירה");
  if (["COMPLETED", "REJECTED"].includes(w.status))
    throw new ConflictException("התהליך סגור לעריכה");
  return w;
}
function requirePrevious(w: Awaited<ReturnType<typeof load>>, number: number) {
  const steps = latestSteps(w.steps);
  for (let n = 1; n < number; n++)
    if (!steps[n]?.completed)
      throw new ConflictException(`יש להשלים קודם את שלב ${n}`);
}
async function productFor(
  tx: Tx,
  w: Awaited<ReturnType<typeof load>>,
  a?: Record<string, any>,
) {
  const id =
    a?.productId || stepAnswers(w, 9).productId || stepAnswers(w, 4).productId;
  const p = await tx.productVersion.findUnique({
    where: { id: text(id, "מוצר") },
  });
  if (!p?.published) throw new BadRequestException("מוצר אינו זמין");
  return p;
}
async function eligibility(
  tx: Tx,
  w: Awaited<ReturnType<typeof load>>,
  p: Awaited<ReturnType<typeof productFor>>,
  start: string,
) {
  const pet = stepAnswers(w, 3);
  const startDate = date(start, "תחילת כיסוי");
  if (w.application?.renewalOfId) {
    const source = w.renewal;
    if (!source || !["ACTIVE", "EXPIRED"].includes(source.status))
      throw new ConflictException("הפוליסה המקורית אינה ניתנת לחידוש");
    if (
      pet.petId !== source.petId ||
      stepAnswers(w, 2).customerId !== source.customerId ||
      start !== source.endDate.toISOString().slice(0, 10)
    )
      throw new BadRequestException(
        "חידוש מחייב את אותו לקוח וחיה ואת מועד סיום הפוליסה הקודמת",
      );
    if (await tx.policy.findUnique({ where: { renewedFromId: source.id } }))
      throw new ConflictException("כבר הופקה פוליסה מחודשת");
  }

  if (startDate < today())
    throw new BadRequestException("אין הרשאה להפקה רטרואקטיבית");
  const months = ageMonths(date(pet.birthDate, "תאריך לידה"), startDate);
  if (
    p.species !== pet.species ||
    months < p.minAgeMonths ||
    months > p.maxAgeMonths
  )
    throw new BadRequestException(
      "בעל החיים אינו זכאי למוצר במועד תחילת הכיסוי",
    );
  if (pet.chip) {
    const existing = await tx.pet.findUnique({ where: { chip: pet.chip } });
    if (existing && existing.id !== pet.petId)
      throw new ConflictException("השבב כבר משויך לחיה אחרת");
  }
  if (pet.petId) {
    const existing = await tx.pet.findUnique({ where: { id: pet.petId } });
    if (!existing || existing.customerId !== stepAnswers(w, 2).customerId)
      throw new BadRequestException("החיה אינה שייכת ללקוח שנבחר");
    if (
      existing.chip !== (pet.chip || null) ||
      existing.birthDate.toISOString().slice(0, 10) !== pet.birthDate ||
      existing.species !== pet.species
    )
      throw new BadRequestException("נתוני החיה אינם תואמים לתיק הקיים");
    const overlap = await tx.policy.findFirst({
      where: {
        petId: existing.id,
        status: { notIn: ["CANCELLED", "EXPIRED"] },
        startDate: { lt: anniversary(startDate) },
        endDate: { gt: startDate },
      },
    });
    if (overlap) throw new ConflictException("קיימת פוליסה או הצעה חופפת");
  }
  return {
    ageMonths: months,
    startDate: start,
    endDate: anniversary(startDate).toISOString().slice(0, 10),
    productVersion: p.version,
  };
}
function medicalRisk(w: Awaited<ReturnType<typeof load>>) {
  const answers = [stepAnswers(w, 5), stepAnswers(w, 6)];
  const risks: string[] = [];
  for (const a of answers)
    for (const [key, v] of Object.entries(a))
      if (v && typeof v === "object" && (v as any).value === true)
        risks.push(key);
  if (!stepAnswers(w, 3).chip) risks.push("MISSING_CHIP");
  if (stepAnswers(w, 7).records?.length) risks.push("MEDICAL_HISTORY");
  if (stepAnswers(w, 8).vaccinated !== true) risks.push("VACCINATION_REVIEW");
  if (stepAnswers(w, 9).noClaims === true)
    risks.push("NO_CLAIMS_WAIVER_REVIEW");
  return risks;
}
async function selectedRiders(
  tx: Tx,
  w: Awaited<ReturnType<typeof load>>,
  answers?: any,
) {
  const selected = answers || stepAnswers(w, 10);
  const ids = (selected.records || []).map((r: any) =>
    text(r.riderId, "הרחבה"),
  );
  if (new Set(ids).size !== ids.length)
    throw new BadRequestException("הרחבה נבחרה פעמיים");
  const product = await productFor(tx, w);
  const riders = await tx.productRider.findMany({
    where: { id: { in: ids }, productId: product.id },
    orderBy: { code: "asc" },
  });
  if (riders.length !== ids.length)
    throw new BadRequestException("הרחבה אינה שייכת למוצר הנבחר");
  const pet = stepAnswers(w, 3),
    age = ageMonths(
      date(pet.birthDate, "לידה"),
      date(stepAnswers(w, 4).startDate, "תחילת כיסוי"),
    );
  if (
    riders.some(
      (r) =>
        r.species !== pet.species ||
        age < r.minAgeMonths ||
        age > r.maxAgeMonths,
    )
  )
    throw new BadRequestException("החיה אינה זכאית להרחבה");
  return riders;
}
function quote(w: Awaited<ReturnType<typeof load>>) {
  return stepAnswers(w, 11).quote;
}
function validMedicalDocuments(w: Awaited<ReturnType<typeof load>>) {
  for (const n of [5, 6])
    for (const v of Object.values(stepAnswers(w, n)))
      if (v && typeof v === "object" && (v as any).value === true) {
        const id = (v as any).attachmentId;
        if (
          !w.attachments.some(
            (a) =>
              a.id === id &&
              a.kind === "MEDICAL" &&
              ["RECEIVED", "APPROVED"].includes(a.status),
          )
        )
          throw new BadRequestException("נדרש מסמך רפואי לכל הצהרה חיובית");
      }
}
export class EnrollmentService {
  async list(actor: Actor) {
    need(actor, "application.read");
    return db.workflowInstance.findMany({
      where: { type: "ENROLLMENT" },
      select: {
        id: true,
        status: true,
        currentStep: true,
        version: true,
        assignedTo: true,
        updatedAt: true,
        application: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
  }
  async get(actor: Actor, id: string) {
    need(actor, "application.read");
    return db.$transaction(async (tx) => view(await load(tx, id)));
  }
  async history(actor: Actor, id: string) {
    need(actor, "application.read");
    return db.$transaction(async (tx) => (await load(tx, id)).steps);
  }
  async create(actor: Actor, b: any, key: unknown) {
    need(actor, "policy.write");
    return command.command(actor, "application.create", key, b, async (tx) => {
      let renewal: any = null;
      if (b.renewalOfId) {
        renewal = await tx.policy.findUnique({
          where: { id: text(b.renewalOfId, "פוליסה לחידוש") },
          include: { customer: true, pet: true },
        });
        if (!renewal || !["ACTIVE", "EXPIRED"].includes(renewal.status))
          throw new ConflictException("פוליסה אינה ניתנת לחידוש");
        if (renewal.endDate < today())
          throw new BadRequestException(
            "חידוש רטרואקטיבי דורש תהליך חריגה שטרם מומש",
          );
        if (
          await tx.policy.findUnique({ where: { renewedFromId: renewal.id } })
        )
          throw new ConflictException("כבר קיימת פוליסה מחודשת");
      }
      const w = await tx.workflowInstance.create({
        data: {
          type: "ENROLLMENT",
          definitionVersion: ENROLLMENT_VERSION,
          assignedTo: actor.id,
          application: {
            create: renewal
              ? {
                  renewalOfId: renewal.id,
                  customerId: renewal.customerId,
                  petId: renewal.petId,
                  productId: renewal.productId,
                }
              : {},
          },
        },
      });
      if (renewal) {
        const customer = renewal.customer,
          pet = renewal.pet,
          names = customer.name.split(" ");
        const defaults: Record<number, any> = {
          1: {
            channel: "PHONE",
            source: "חידוש פוליסה " + renewal.number,
            requestType: "RENEWAL",
            urgency: "NORMAL",
          },
          2: {
            ...customer.profile,
            customerId: customer.id,
            firstName: customer.profile.firstName || names[0],
            lastName: customer.profile.lastName || names.slice(1).join(" "),
            identifier: customer.identifier || "",
            phone: customer.phone,
            email: customer.email || "",
            address: customer.address,
          },
          3: {
            ...pet.profile,
            petId: pet.id,
            name: pet.name,
            species: pet.species,
            breed: pet.breed,
            sex: pet.sex,
            birthDate: pet.birthDate.toISOString().slice(0, 10),
            chip: pet.chip || "",
            weight: pet.weight,
            neutered: pet.neutered,
          },
          4: {
            productId: renewal.productId,
            startDate: renewal.endDate.toISOString().slice(0, 10),
          },
          9: { productId: renewal.productId },
        };
        for (const [number, answers] of Object.entries(defaults))
          await tx.workflowStep.create({
            data: {
              workflowId: w.id,
              number: Number(number),
              revision: 1,
              definitionVersion: ENROLLMENT_VERSION,
              answers: json(answers),
              completed: false,
              employeeId: actor.id,
            },
          });
      }
      await audit(tx, actor, "application.create", w.id, 1, {
        definitionVersion: ENROLLMENT_VERSION,
      });
      return view(await load(tx, w.id));
    });
  }
  async save(actor: Actor, id: string, n: number, b: any, key: unknown) {
    need(actor, "policy.write");
    integer(n, "שלב", 1, 17);
    return command.command(
      actor,
      "application.step",
      key,
      { id, n, ...b },
      async (tx) => {
        const w = await locked(tx, id, b.version);
        const answers = b.answers;
        if (
          !answers ||
          typeof answers !== "object" ||
          Array.isArray(answers) ||
          JSON.stringify(answers).length > 200000
        )
          throw new BadRequestException("תשובות לא תקינות");
        if (typeof b.complete !== "boolean")
          throw new BadRequestException("מצב שמירה לא תקין");
        // Strict field allowlist also applies to drafts; completed steps use deeper validation.
        const def = enrollmentDefinition(w.definitionVersion)[n - 1];
        const allowed = new Set([
          ...def.fields.map((f) => f.key),
          ...(def.questions?.map((q) => q.key) || []),
          ...(def.repeat ? ["records"] : []),
          ...(n === 16 ? ["strokes"] : []),
        ]);
        if (Object.keys(answers).some((k) => !allowed.has(k)))
          throw new BadRequestException("שדה אינו מוכר בגרסת הטופס");
        requirePrevious(w, n);
        const a = { ...answers };
        if (b.complete) {
          const errors = validateStep(n, a, w.definitionVersion);
          if (errors.length) throw new BadRequestException(errors.join("; "));
          if (
            n === 1 &&
            (a.requestType === "RENEWAL") !== !!w.application?.renewalOfId
          )
            throw new BadRequestException("סוג הבקשה אינו תואם לפוליסה לחידוש");
          if (n === 2) {
            const duplicate = await tx.customer.findUnique({
              where: { identifier: a.identifier },
            });
            if (duplicate && duplicate.id !== a.customerId)
              throw new ConflictException(
                "קיים לקוח עם המזהה הזה. יש לבחור את הלקוח הקיים",
              );
            if (a.customerId) {
              const c = await tx.customer.findUnique({
                where: { id: a.customerId },
              });
              if (!c) throw new BadRequestException("לקוח אינו קיים");
              if (c.identifier && c.identifier !== a.identifier)
                throw new BadRequestException("המזהה אינו תואם לתיק הלקוח");
            }
          }
          if (n === 4 || n === 9) {
            const p = await productFor(tx, w, a);
            a.eligibility = await eligibility(
              tx,
              w,
              p,
              n === 4 ? a.startDate : stepAnswers(w, 4).startDate,
            );
          }
          if (
            n === 9 &&
            a.noClaims === true &&
            !w.attachments.some(
              (x) =>
                x.id === a.noClaimsAttachmentId &&
                x.kind === "NO_CLAIMS" &&
                x.status !== "REJECTED",
            )
          )
            throw new BadRequestException(
              "נדרש אישור היעדר תביעות השייך לבקשה",
            );
          if (n === 5 || n === 6) {
            for (const v of Object.values(a))
              if (v && typeof v === "object" && (v as any).value === true) {
                const attachment = w.attachments.find(
                  (x) => x.id === (v as any).attachmentId,
                );
                if (!attachment || attachment.kind !== "MEDICAL")
                  throw new BadRequestException("מסמך רפואי אינו משויך לבקשה");
              }
          }
          if (n === 10) {
            a.selectedRiders = json(await selectedRiders(tx, w, a));
          }
          if (n === 11) {
            const p = await productFor(tx, w);
            const riders = await selectedRiders(tx, w);
            const annualCents =
              p.premiumCents + riders.reduce((s, r) => s + r.premiumCents, 0);
            const annualLimitCents =
              p.annualLimitCents +
              riders.reduce((s, r) => s + r.limitIncreaseCents, 0);
            const coverages = (p.coverages as any[]).map((c) => ({ ...c }));
            for (const r of riders) {
              if (!r.coverage) continue;
              const c = r.coverage as any;
              const existing = coverages.find((x) => x.code === c.code);
              if (existing) existing.limitCents += c.limitCents;
              else coverages.push({ ...c });
            }
            await eligibility(tx, w, p, stepAnswers(w, 4).startDate);
            a.quote = {
              pricingVersion: 1,
              simulation: true,
              baseProduct: json(p),
              riders: json(riders),
              product: json({
                ...p,
                coverages,
                annualLimitCents,
                premiumCents: annualCents,
              }),
              baseCents: p.premiumCents,
              adjustments: riders.map((r) => ({
                code: r.code,
                name: r.name,
                amountCents: r.premiumCents,
              })),
              annualCents,
              monthlyIllustrationCents: Math.round(annualCents / 12),
              validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
              generatedAt: new Date().toISOString(),
              inputHash: hash({
                pet: stepAnswers(w, 3),
                selection: stepAnswers(w, 9),
              }),
            };
          }
          if (n === 12) {
            validMedicalDocuments(w);
            const risks = medicalRisk(w);
            a.evaluation = {
              rulesVersion: 1,
              risks,
              decision: risks.length ? "REFER" : "APPROVE",
              reason: risks.length
                ? "נדרשת החלטת חתם לפי כללי סימולציה"
                : "לא נמצאו גורמי הפניה בכללי הסימולציה",
            };
            if (risks.length) {
              await tx.approvalRequest.create({
                data: {
                  workflowId: id,
                  kind: "UNDERWRITING",
                  requestedBy: actor.id,
                  workflowVersion: w.version + 1,
                  reason: a.evaluation.reason,
                },
              });
              b = { ...b, complete: false };
            }
          }
          if (n === 13) {
            a.declarationVersion = 1;
            a.declarationTexts = declarations;
            a.acceptedAt = new Date().toISOString();
            a.quoteHash = hash(quote(w));
          }
          if (n === 14) {
            validMedicalDocuments(w);
            a.documents = w.attachments.map((x) => ({
              id: x.id,
              kind: x.kind,
              digest: x.digest,
              status: x.status,
            }));
          }
          if (n === 15) {
            a.schedule = paymentSchedule(
              quote(w).annualCents,
              a.frequency,
              stepAnswers(w, 4).startDate,
            );
            const customerId = stepAnswers(w, 2).customerId;
            if (customerId) {
              const charges = await tx.charge.findMany({
                where: { policy: { customerId } },
              });
              const debt = charges.reduce(
                (s, c) =>
                  s +
                  Math.max(0, c.amountCents - c.creditedCents - c.paidCents),
                0,
              );
              if (debt > 0)
                throw new ConflictException(
                  "קיים חוב בתיק הלקוח. נדרשת הסדרה לפני הצטרפות",
                );
            }
          }
          if (n === 16) {
            a.signedAt = new Date().toISOString();
            a.simulated = true;
            a.documentHash = hash({
              quote: quote(w),
              declarations: stepAnswers(w, 13),
              payment: stepAnswers(w, 15),
              underwriting: stepAnswers(w, 12),
            });
          }
          if (n === 17) {
            await eligibility(
              tx,
              w,
              await productFor(tx, w),
              stepAnswers(w, 4).startDate,
            );
            if (new Date(quote(w).validUntil) < new Date())
              throw new ConflictException("הצעת המחיר פגה. יש לחשב מחדש");
            validMedicalDocuments(w);
          }
        }
        if (n <= 16)
          await tx.signingRequest.updateMany({
            where: { workflowId: id, status: "PENDING" },
            data: { status: "REVOKED" },
          });
        const latest = latestSteps(w.steps);
        await tx.workflowStep.create({
          data: {
            workflowId: id,
            number: n,
            revision: (latest[n]?.revision || 0) + 1,
            definitionVersion: w.definitionVersion,
            answers: json(a),
            completed: b.complete,
            employeeId: actor.id,
          },
        });
        // Append invalidation revisions instead of modifying previous declarations/signatures.
        for (const s of Object.values(latest))
          if (s.number > n && s.completed)
            await tx.workflowStep.create({
              data: {
                workflowId: id,
                number: s.number,
                revision: s.revision + 1,
                definitionVersion: s.definitionVersion,
                answers: s.answers as Prisma.InputJsonValue,
                completed: false,
                employeeId: actor.id,
              },
            });
        await tx.approvalRequest.updateMany({
          where: {
            workflowId: id,
            status: "PENDING",
            ...(n === 12 && a.evaluation?.decision === "REFER"
              ? { workflowVersion: { lt: w.version + 1 } }
              : {}),
          },
          data: { status: "SUPERSEDED" },
        });
        const status =
          n === 12 && a.evaluation?.decision === "REFER"
            ? "WAITING_APPROVAL"
            : n === 17 && b.complete
              ? "READY"
              : "DRAFT";
        await tx.workflowInstance.update({
          where: { id },
          data: {
            status,
            currentStep: b.complete ? n + 1 : n,
            version: { increment: 1 },
          },
        });
        if (n === 2)
          await tx.application.update({
            where: { workflowId: id },
            data: { customerId: a.customerId || null },
          });
        if (n === 3)
          await tx.application.update({
            where: { workflowId: id },
            data: { petId: a.petId || null },
          });
        if (n === 9 && b.complete)
          await tx.application.update({
            where: { workflowId: id },
            data: { productId: a.productId },
          });
        await audit(tx, actor, "application.step.save", id, w.version + 1, {
          step: n,
          revision: (latest[n]?.revision || 0) + 1,
          completed: b.complete,
        });
        return view(await load(tx, id));
      },
    );
  }
  async decide(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "underwriting.decide");
    return command.command(
      actor,
      "application.underwrite",
      key,
      { id, ...b },
      async (tx) => {
        const w = await locked(tx, id, b.version);
        if (w.status !== "WAITING_APPROVAL")
          throw new ConflictException("הבקשה אינה ממתינה לחיתום");
        const approval = w.approvals.find((x) => x.status === "PENDING");
        if (!approval) throw new ConflictException("אין בקשת אישור פעילה");
        if (approval.requestedBy === actor.id)
          throw new ConflictException("יוזם הבקשה אינו יכול לאשר אותה");
        const decision = choice(
          b.decision,
          ["APPROVE", "REJECT", "MORE_INFORMATION"],
          "החלטה",
        );
        const reason = text(b.reason, "נימוק");
        if (decision === "APPROVE") {
          for (const number of [5, 6])
            for (const answer of Object.values(stepAnswers(w, number))) {
              if (
                answer &&
                typeof answer === "object" &&
                (answer as any).value === true &&
                !w.attachments.some(
                  (a) =>
                    a.id === (answer as any).attachmentId &&
                    a.status === "APPROVED",
                )
              )
                throw new ConflictException(
                  "נדרש אישור המסמכים הרפואיים לפני אישור חיתום",
                );
            }
        }
        const categories = Array.isArray(b.excludedCategories)
          ? b.excludedCategories.map((x: unknown) =>
              text(x, "כיסוי מוחרג", 100),
            )
          : [];
        const product = quote(w).product;
        if (
          categories.some(
            (x: string) => !product.coverages.some((c: any) => c.code === x),
          )
        )
          throw new BadRequestException("החרגה אינה קיימת בכיסויי המוצר");
        let waitingWaiver = null;
        if (b.waiveWaiting === true) {
          if (decision !== "APPROVE")
            throw new BadRequestException("ביטול אכשרה מחייב אישור חיתום");
          const prior = stepAnswers(w, 9);
          const configured = await productFor(tx, w);
          const evidence = w.attachments.find(
            (x) => x.id === prior.noClaimsAttachmentId,
          );
          const start = date(stepAnswers(w, 4).startDate, "תחילת כיסוי");
          if (
            !configured.waitingWaiverAllowed ||
            prior.noClaims !== true ||
            !evidence ||
            evidence.kind !== "NO_CLAIMS" ||
            evidence.status !== "APPROVED" ||
            evidence.reviewedBy === approval.requestedBy ||
            prior.claimFreeMonths < configured.minClaimFreeMonths ||
            date(prior.priorCoverageEnd, "סיום הכיסוי הקודם").getTime() <
              start.getTime() - 86400000
          )
            throw new ConflictException(
              "תנאי המוצר, רציפות הכיסוי או האסמכתה המאושרת אינם מאפשרים ביטול אכשרה",
            );
          waitingWaiver = {
            originalWaitingDays: configured.waitingDays,
            waitingDays: 0,
            evidenceId: evidence.id,
            reason,
            approvedBy: actor.id,
            approvedAt: new Date().toISOString(),
            ruleVersion: 1,
            simulation: true,
          };
        }
        await tx.approvalRequest.update({
          where: { id: approval.id },
          data: {
            status: decision,
            decidedBy: actor.id,
            reason,
            decision: json({ decision, categories }),
            decidedAt: new Date(),
          },
        });
        const s = latestSteps(w.steps)[12];
        await tx.workflowStep.create({
          data: {
            workflowId: id,
            number: 12,
            revision: s.revision + 1,
            definitionVersion: w.definitionVersion,
            answers: json({
              ...stepAnswers(w, 12),
              decision,
              reason,
              excludedCategories: categories,
              waitingWaiver,
              decidedBy: actor.id,
              decidedAt: new Date().toISOString(),
            }),
            completed: decision === "APPROVE",
            employeeId: actor.id,
          },
        });
        await tx.workflowInstance.update({
          where: { id },
          data: {
            status: decision === "REJECT" ? "REJECTED" : "DRAFT",
            currentStep: decision === "APPROVE" ? 13 : 12,
            version: { increment: 1 },
          },
        });
        await audit(
          tx,
          actor,
          "application.underwriting.decision",
          id,
          w.version + 1,
          { decision, reason, categories },
        );
        return view(await load(tx, id));
      },
    );
  }
  async upload(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "policy.write");
    const filename = text(b.filename, "שם קובץ", 160);
    if (/[\\/\x00-\x1f]/.test(filename))
      throw new BadRequestException("שם קובץ לא תקין");
    const kind = choice(
      b.kind,
      ["MEDICAL", "CHIP", "VACCINATION", "CONSENT", "NO_CLAIMS"],
      "סוג מסמך",
    );
    const mediaType = choice(
      b.mediaType,
      ["application/pdf", "image/png", "image/jpeg"],
      "סוג קובץ",
    );
    if (
      typeof b.base64 !== "string" ||
      b.base64.length > 1400000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64)
    )
      throw new BadRequestException("תוכן קובץ לא תקין");
    const bytes = Buffer.from(b.base64, "base64");
    if (
      bytes.length < 8 ||
      bytes.length > 1048576 ||
      bytes.toString("base64") !== b.base64
    )
      throw new BadRequestException("גודל קובץ לא תקין");
    const valid =
      mediaType === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : mediaType === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid)
      throw new BadRequestException("תוכן הקובץ אינו תואם לסוג המוצהר");
    return command.command(
      actor,
      "application.attachment",
      key,
      { id, ...b, base64: hash(b.base64) },
      async (tx) => {
        const w = await locked(tx, id, b.version);
        if (w.attachments.length >= 50)
          throw new BadRequestException("ניתן לצרף עד 50 קבצים");
        const attachment = await tx.workflowAttachment.create({
          data: {
            workflowId: id,
            kind,
            filename,
            mediaType,
            digest: createHash("sha256").update(bytes).digest("hex"),
            content: bytes,
            employeeId: actor.id,
          },
        });
        await tx.workflowInstance.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        await audit(
          tx,
          actor,
          "application.attachment.upload",
          id,
          w.version + 1,
          { attachmentId: attachment.id, digest: attachment.digest },
        );
        return view(await load(tx, id));
      },
    );
  }
  async reviewAttachment(
    actor: Actor,
    id: string,
    attachmentId: string,
    b: any,
    key: unknown,
  ) {
    need(actor, "underwriting.decide");
    return command.command(
      actor,
      "application.attachment.review",
      key,
      { id, attachmentId, ...b },
      async (tx) => {
        const w = await locked(tx, id, b.version);
        const attachment = w.attachments.find((a) => a.id === attachmentId);
        if (!attachment) throw new NotFoundException("קובץ אינו משויך לבקשה");
        const status = choice(b.status, ["APPROVED", "REJECTED"], "מצב מסמך");
        const reason = text(b.reason, "נימוק בדיקת מסמך");
        if (
          Object.values(latestSteps(w.steps)).some(
            (s) => s.number >= 12 && s.completed,
          )
        )
          throw new ConflictException(
            "יש להחזיר את בקשת החיתום לבדיקה לפני שינוי מסמך שאושר",
          );
        await tx.workflowAttachment.update({
          where: { id: attachmentId },
          data: {
            status,
            reviewReason: reason,
            reviewedBy: actor.id,
            reviewedAt: new Date(),
          },
        });
        await tx.workflowInstance.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        await audit(
          tx,
          actor,
          "application.attachment.review",
          id,
          w.version + 1,
          { attachmentId, status, reason },
        );
        return view(await load(tx, id));
      },
    );
  }
  async attachment(actor: Actor, id: string) {
    need(actor, "application.read");
    const a = await db.workflowAttachment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException("מסמך לא נמצא");
    return a;
  }
  async issue(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "policy.write");
    return command.command(
      actor,
      "application.issue",
      key,
      { id, ...b },
      async (tx) => {
        const w = await locked(tx, id, b.version);
        requirePrevious(w, 18);
        if (w.status !== "READY")
          throw new ConflictException("נדרשת בקרת שלמות לפני הפקה");
        const q = quote(w);
        if (new Date(q.validUntil) < new Date())
          throw new ConflictException("ההצעה פגה");
        const p = await productFor(tx, w);
        if (
          hash(json(p)) !== hash(q.baseProduct) ||
          hash(json(await selectedRiders(tx, w))) !== hash(q.riders)
        )
          throw new ConflictException("המוצר השתנה. נדרשת הצעה חדשה");
        await eligibility(tx, w, p, stepAnswers(w, 4).startDate);
        validMedicalDocuments(w);
        const c = stepAnswers(w, 2),
          pet = stepAnswers(w, 3);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${String(c.identifier)}))::text`;
        let customer = c.customerId
          ? await tx.customer.findUnique({ where: { id: c.customerId } })
          : null;
        if (!customer) {
          if (
            await tx.customer.findUnique({
              where: { identifier: c.identifier },
            })
          )
            throw new ConflictException(
              "הלקוח כבר נוצר בתהליך אחר. יש לקשר אותו לבקשה",
            );
          customer = await tx.customer.create({
            data: {
              name: c.firstName + " " + c.lastName,
              identifier: c.identifier,
              phone: c.phone,
              email: c.email,
              address: c.address + ", " + c.city,
              profile: json(c),
            },
          });
        }
        if (c.customerId) {
          if (customer.identifier && customer.identifier !== c.identifier)
            throw new ConflictException(
              "מזהה הלקוח השתנה. יש לבדוק מחדש את הבקשה",
            );
          if (!customer.identifier)
            customer = await tx.customer.update({
              where: { id: customer.id },
              data: {
                identifier: c.identifier,
                profile: json({ ...(customer.profile as any), ...c }),
                version: { increment: 1 },
              },
            });
        }
        const startDate = date(stepAnswers(w, 4).startDate, "תחילת כיסוי");
        let animal = pet.petId
          ? await tx.pet.findUnique({ where: { id: pet.petId } })
          : null;
        if (!animal)
          animal = await tx.pet.create({
            data: {
              customerId: customer.id,
              name: pet.name,
              species: pet.species,
              breed: pet.breed,
              sex: pet.sex,
              birthDate: date(pet.birthDate, "לידה"),
              chip: pet.chip || null,
              weight: pet.weight,
              neutered: pet.neutered,
              vaccinated: stepAnswers(w, 8).vaccinated,
              medicalHistory: medicalRisk(w).length
                ? "הצהרה רפואית שמורה בבקשת הצטרפות " + w.application!.number
                : "",
              profile: json(pet),
            },
          });
        await tx.$queryRaw`SELECT id FROM "Pet" WHERE id=${animal.id} FOR UPDATE`;
        if (
          await tx.policy.findFirst({
            where: {
              petId: animal.id,
              status: { notIn: ["CANCELLED", "EXPIRED"] },
              startDate: { lt: anniversary(startDate) },
              endDate: { gt: startDate },
            },
          })
        )
          throw new ConflictException("קיימת פוליסה חופפת");
        const underwriting = stepAnswers(w, 12),
          payment = stepAnswers(w, 15);
        const policy = await tx.policy.create({
          data: {
            renewedFromId: w.application!.renewalOfId,
            customerId: customer.id,
            petId: animal.id,
            productId: p.id,
            status: "ACTIVE",
            startDate,
            endDate: anniversary(startDate),
            snapshot: json({
              ...q.product,
              ...(underwriting.waitingWaiver
                ? { waitingDays: 0, waitingWaiver: underwriting.waitingWaiver }
                : {}),
            }),
            premiumCents: q.annualCents,
            annualLimitCents: q.product.annualLimitCents,
            conditionsAccepted: true,
            paymentMethod: payment.method,
            exclusions: json(underwriting.excludedCategories || []),
            underwritingReason:
              underwriting.reason || underwriting.evaluation.reason,
          },
        });
        const schedule = paymentSchedule(
          q.annualCents,
          payment.frequency,
          stepAnswers(w, 4).startDate,
        );
        for (const item of schedule) {
          const charge = await tx.charge.create({
            data: {
              policyId: policy.id,
              amountCents: item.amountCents,
              dueAt: date(item.dueAt, "חיוב"),
            },
          });
          await tx.ledgerEntry.create({
            data: {
              customerId: customer.id,
              policyId: policy.id,
              referenceId: charge.id,
              kind: "CHARGE",
              amountCents: charge.amountCents,
            },
          });
        }
        const snapshot = json({
          customer,
          pet: animal,
          policy,
          terms: policy.snapshot,
          applicationNumber: w.application!.number,
          steps: Object.values(latestSteps(w.steps)),
          schedule,
          quote: q,
          signature: stepAnswers(w, 16),
        });
        const docs = [];
        for (const [type, title] of [
          ["APPLICATION", "טופס הצטרפות"],
          ["HEALTH_DECLARATION", "הצהרת בריאות"],
          ["UNDERWRITING", "סיכום חיתום"],
          ["POLICY", "דף פרטי ביטוח — סימולציה"],
          ["SIMULATED_SIGNATURE", "אישור חתימה מדומה"],
        ]) {
          const d = await tx.document.create({
            data: {
              customerId: customer.id,
              policyId: policy.id,
              type,
              title,
              snapshot,
              signedAt: new Date(stepAnswers(w, 16).signedAt),
              signedBy: stepAnswers(w, 16).signerName,
            },
          });
          await tx.documentArtifact.create({ data: { documentId: d.id } });
          docs.push(d.id);
        }
        if (w.renewal) {
          const renewalDocument = await tx.document.create({
            data: {
              customerId: customer.id,
              policyId: policy.id,
              type: "RENEWAL_CONFIRMATION",
              title: "אישור חידוש פוליסה — סימולציה",
              snapshot: json({
                ...snapshot,
                renewedFromNumber: w.renewal.number,
              }),
              signedAt: new Date(stepAnswers(w, 16).signedAt),
              signedBy: stepAnswers(w, 16).signerName,
            },
          });
          await tx.documentArtifact.create({
            data: { documentId: renewalDocument.id },
          });
          docs.push(renewalDocument.id);
        }
        if (!animal.chip)
          await tx.task.create({
            data: {
              customerId: customer.id,
              title: "השלמת שבב — בקשת הצטרפות " + w.application!.number,
              dueAt: startDate,
              assignedTo: actor.id,
            },
          });
        await tx.application.update({
          where: { workflowId: id },
          data: {
            customerId: customer.id,
            petId: animal.id,
            productId: p.id,
            policyId: policy.id,
          },
        });
        await tx.workflowStep.create({
          data: {
            workflowId: id,
            number: 18,
            revision: 1,
            definitionVersion: w.definitionVersion,
            answers: json({ policyId: policy.id, documents: docs }),
            completed: true,
            employeeId: actor.id,
          },
        });
        await tx.workflowInstance.update({
          where: { id },
          data: {
            status: "COMPLETED",
            currentStep: 18,
            version: { increment: 1 },
          },
        });
        await audit(tx, actor, "application.issue", id, w.version + 1, {
          policyId: policy.id,
          customerId: customer.id,
          documents: docs,
        });
        return { workflow: view(await load(tx, id)), policy, documents: docs };
      },
    );
  }
}
