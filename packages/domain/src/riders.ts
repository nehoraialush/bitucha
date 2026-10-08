// Configured fictional options, not real policy coverages or actuarial prices.
export const simulatedRiders = [
  {
    code: "LIABILITY",
    name: "צד שלישי — מדומה",
    premiumCents: 12000,
    limitIncreaseCents: 0,
    coverage: { code: "LIABILITY", name: "צד שלישי", limitCents: 500000 },
  },
  {
    code: "COMPLEMENTARY",
    name: "טיפולים משלימים — מדומה",
    premiumCents: 18000,
    limitIncreaseCents: 0,
    coverage: {
      code: "COMPLEMENTARY",
      name: "טיפול משלים",
      limitCents: 100000,
    },
  },
  {
    code: "PHYSIO",
    name: "פיזיותרפיה — מדומה",
    premiumCents: 18000,
    limitIncreaseCents: 0,
    coverage: { code: "PHYSIO", name: "פיזיותרפיה", limitCents: 150000 },
  },
  {
    code: "BEHAVIOR",
    name: "טיפולים התנהגותיים — מדומה",
    premiumCents: 12000,
    limitIncreaseCents: 0,
    coverage: { code: "BEHAVIOR", name: "טיפול התנהגותי", limitCents: 100000 },
  },
  {
    code: "DENTAL",
    name: "שיניים — מדומה",
    premiumCents: 24000,
    limitIncreaseCents: 0,
    coverage: { code: "DENTAL", name: "טיפול שיניים", limitCents: 200000 },
  },
  {
    code: "PREVENTIVE",
    name: "מניעתי — מדומה",
    premiumCents: 12000,
    limitIncreaseCents: 0,
    coverage: { code: "PREVENTIVE", name: "טיפול מניעתי", limitCents: 50000 },
  },
  {
    code: "HIGH_LIMIT",
    name: "הגדלת תקרה — מדומה",
    premiumCents: 30000,
    limitIncreaseCents: 1000000,
    coverage: null,
  },
];
