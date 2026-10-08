import { Prisma } from "./generated/client";
import { simulatedRiders } from "../../../packages/domain/src/riders";
import {
  anniversary,
  assessClaim,
  Terms,
} from "../../../packages/domain/src/insurance";
export async function seedDemo(tx: Prisma.TransactionClient, force = false) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(824772)::text`;
  const state = await tx.systemSetting.findUnique({
    where: { key: "demo-data-state" },
  });
  if (!force && (state?.value as any)?.enabled === false)
    return {
      customers: 0,
      pets: 0,
      policies: 0,
      claims: 0,
      simulated: true,
      skipped: true,
    };
  const coverages = Array.from({ length: 24 }, (_, i) => ({
    code: [
      "VISIT",
      "LAB",
      "SURGERY",
      "MEDICATION",
      "EMERGENCY",
      "HOSPITAL",
      "XRAY",
      "ULTRASOUND",
      "CT",
      "MRI",
      "CHRONIC",
      "HEREDITARY",
      "ONCOLOGY",
      "ORTHOPEDIC",
      "SKIN",
      "EYE",
      "DENTAL",
      "PHYSIO",
      "HYDRO",
      "BEHAVIOR",
      "PREVENTIVE",
      "BLOOD",
      "URINE",
      "COMPLEMENTARY",
    ][i],
    name: [
      "ביקור וטרינר",
      "מעבדה",
      "ניתוח",
      "תרופות",
      "חירום",
      "אשפוז",
      "רנטגן",
      "אולטרסאונד",
      "CT",
      "MRI",
      "מחלות כרוניות",
      "מחלות תורשתיות",
      "אונקולוגיה",
      "אורתופדיה",
      "עור",
      "עיניים",
      "שיניים",
      "פיזיותרפיה",
      "הידרותרפיה",
      "טיפול התנהגותי",
      "מניעה",
      "בדיקות דם",
      "בדיקות שתן",
      "טיפול משלים",
    ][i],
    limitCents: i === 2 ? 1500000 : 500000,
  }));
  for (const species of ["DOG", "CAT"])
    for (const tier of ["BASIC", "PLUS"])
      await tx.productVersion.upsert({
        where: { id: `demo-product-${species}-${tier}` },
        update: {},
        create: {
          id: `demo-product-${species}-${tier}`,
          code: `${species}-${tier}`,
          version: 1,
          name: `${species === "DOG" ? "כלב" : "חתול"} ${tier === "BASIC" ? "בסיס" : "מורחב"}`,
          species,
          minAgeMonths: 2,
          maxAgeMonths: 120,
          premiumCents: tier === "BASIC" ? 180000 : 240000,
          annualLimitCents: tier === "BASIC" ? 2000000 : 3000000,
          deductibleCents: 15000,
          reimbursementBps: 8000,
          waitingDays: 30,
          coverages:
            tier === "BASIC" ? coverages.slice(0, 6) : coverages.slice(0, 20),
        },
      });
  for (let i = 1; i <= 100; i++)
    await tx.customer.upsert({
      where: { id: `demo-customer-${String(i).padStart(3, "0")}` },
      update: {},
      create: {
        id: `demo-customer-${String(i).padStart(3, "0")}`,
        name: `לקוח הדגמה ${String(i).padStart(3, "0")}`,
        phone: `DEMO-${String(i).padStart(3, "0")}`,
        email: `demo-${i}@example.invalid`,
        address: "כתובת בדויה לצורכי הדגמה",
        notes: "נתוני הדגמה בדויים בלבד",
      },
    });
  for (let i = 1; i <= 140; i++)
    await tx.pet.upsert({
      where: { id: `demo-pet-${i}` },
      update: {},
      create: {
        id: `demo-pet-${i}`,
        customerId: `demo-customer-${String(((i - 1) % 100) + 1).padStart(3, "0")}`,
        name: ["לונה", "מילו", "בלה", "צ׳ארלי", "נלה", "לוקי"][i % 6] + ` ${i}`,
        species: i % 3 === 0 ? "CAT" : "DOG",
        breed: i % 3 === 0 ? "חתול מעורב" : "כלב מעורב",
        sex: i % 2 ? "MALE" : "FEMALE",
        birthDate: new Date("2022-01-15"),
        chip: String(900000000000000 + i),
        vaccinated: true,
        neutered: i % 2 === 0,
      },
    });
  const now = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const start = new Date(now.getTime() - 120 * 86400000);
  const end = anniversary(start);
  const products = await tx.productVersion.findMany();
  for (let i = 1; i <= 120; i++) {
    const pet = await tx.pet.findUniqueOrThrow({
      where: { id: `demo-pet-${i}` },
    });
    const product = products.find(
      (p) => p.id === `demo-product-${pet.species}-${i % 2 ? "BASIC" : "PLUS"}`,
    )!;
    const existingPolicy = await tx.policy.findUnique({
      where: { id: `demo-policy-${i}` },
    });
    if (existingPolicy) continue;
    const policy = await tx.policy.create({
      data: {
        id: `demo-policy-${i}`,
        customerId: pet.customerId,
        petId: pet.id,
        productId: product.id,
        status: "ACTIVE",
        startDate: start,
        endDate: end,
        snapshot: JSON.parse(JSON.stringify(product)),
        premiumCents: product.premiumCents,
        annualLimitCents: product.annualLimitCents,
        conditionsAccepted: true,
        paymentMethod: "SIMULATED_ANNUAL",
        underwritingReason: "הדגמה: חיתום אוטומטי",
      },
    });
    const charge = await tx.charge.create({
      data: {
        policyId: policy.id,
        amountCents: product.premiumCents,
        paidCents: i % 4 ? product.premiumCents : 0,
        dueAt: start,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        customerId: pet.customerId,
        policyId: policy.id,
        referenceId: charge.id,
        kind: "CHARGE",
        amountCents: charge.amountCents,
      },
    });
    if (charge.paidCents)
      await tx.ledgerEntry.create({
        data: {
          customerId: pet.customerId,
          policyId: policy.id,
          referenceId: charge.id,
          kind: "COLLECTION_SIMULATED",
          amountCents: charge.paidCents,
        },
      });
    await tx.document.create({
      data: {
        customerId: pet.customerId,
        policyId: policy.id,
        type: "POLICY",
        title: "פוליסת הדגמה",
        snapshot: JSON.parse(
          JSON.stringify({
            policy,
            customer: await tx.customer.findUnique({
              where: { id: pet.customerId },
            }),
            pet,
            terms: product,
          }),
        ),
      },
    });
  }
  const existingClaims = await tx.claim.findMany({
    where: {
      clinic: "מרפאת הדגמה בדויה",
      policyId: { startsWith: "demo-policy-" },
    },
    orderBy: { createdAt: "asc" },
  });
  const seen: Record<string, number> = {};
  for (let i = 1; i <= 200; i++) {
    const policyId = `demo-policy-${((i - 1) % 120) + 1}`;
    const position = seen[policyId] || 0;
    seen[policyId] = position + 1;
    if (existingClaims.filter((c) => c.policyId === policyId)[position])
      continue;
    const policy = await tx.policy.findUniqueOrThrow({
      where: { id: `demo-policy-${((i - 1) % 120) + 1}` },
    });
    const terms = policy.snapshot as unknown as Terms;
    const event = new Date(now.getTime() - (i % 45) * 86400000);
    const result = assessClaim({
      terms,
      start,
      end,
      cancelledAt: null,
      event,
      availableCents:
        policy.annualLimitCents - policy.reservedCents - policy.paidCents,
      usedByCategory: {},
      lines: [{ category: "VISIT", costCents: 100000 + (i % 10) * 10000 }],
    });
    const mode = i % 5;
    const decided = mode >= 2;
    const approved = decided && mode !== 2 ? result.approvedCents : 0;
    const status =
      mode === 0
        ? "SUBMITTED"
        : mode === 1
          ? "NEEDS_INFORMATION"
          : mode === 2
            ? "REJECTED"
            : mode === 3
              ? "PARTIALLY_APPROVED"
              : "PAID";
    const claim = await tx.claim.create({
      data: {
        id: `demo-claim-${i}`,
        policyId: policy.id,
        status,
        eventDate: event,
        diagnosis: "אבחנת הדגמה — בדיקה רפואית",
        clinic: "מרפאת הדגמה בדויה",
        reason: decided ? "החלטת סימולציה לנתוני הדגמה" : "ממתינה לטיפול",
        approvedCents: approved,
        lines: {
          create: {
            category: "VISIT",
            description: "בדיקת הדגמה",
            costCents: result.lines[0].costCents,
            approvedCents: approved,
            reason: decided
              ? mode === 2
                ? "דחיית סימולציה"
                : result.lines[0].reason
              : "",
          },
        },
      },
    });
    if (approved) {
      const executed = mode === 4;
      const order = await tx.paymentOrder.create({
        data: {
          claimId: claim.id,
          amountCents: approved,
          status: executed ? "EXECUTED" : "APPROVED",
          executedAt: executed ? now : null,
        },
      });
      await tx.policy.update({
        where: { id: policy.id },
        data: executed
          ? { paidCents: { increment: approved } }
          : { reservedCents: { increment: approved } },
      });
      if (executed)
        await tx.ledgerEntry.create({
          data: {
            customerId: policy.customerId,
            policyId: policy.id,
            referenceId: order.id,
            kind: "CLAIM_PAYMENT_SIMULATED",
            amountCents: approved,
          },
        });
    }
  }
  for (let i = 1; i <= 20; i++) {
    const customerId = `demo-customer-${String(i).padStart(3, "0")}`;
    if (
      await tx.serviceCase.findFirst({
        where: { customerId, subject: "פניית הדגמה לעדכון פרטים" },
      })
    )
      continue;
    await tx.serviceCase.create({
      data: {
        customerId: `demo-customer-${String(i).padStart(3, "0")}`,
        subject: "פניית הדגמה לעדכון פרטים",
        description: "נתונים בדויים בלבד",
        priority: i % 4 === 0 ? "HIGH" : "NORMAL",
      },
    });
  }
  for (const product of await tx.productVersion.findMany({
    where: { id: { startsWith: "demo-product-" } },
  })) {
    for (const rider of simulatedRiders) {
      const { coverage, ...fields } = rider;
      await tx.productRider.upsert({
        where: { productId_code: { productId: product.id, code: rider.code } },
        update: {},
        create: {
          ...fields,
          coverage: coverage || undefined,
          productId: product.id,
          species: product.species,
          minAgeMonths: product.minAgeMonths,
          maxAgeMonths: product.maxAgeMonths,
        },
      });
    }
  }
  await tx.systemSetting.upsert({
    where: { key: "demo-data-state" },
    create: { key: "demo-data-state", value: { enabled: true } },
    update: { value: { enabled: true } },
  });
  return {
    customers: 100,
    pets: 140,
    policies: 120,
    claims: 200,
    simulated: true,
    skipped: false,
  };
}
