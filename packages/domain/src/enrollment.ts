// Versioned simulation rules. These are not actuarial or regulatory rules.
export const ENROLLMENT_VERSION = 2;
export type Field = {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "boolean" | "select" | "textarea";
  required?: boolean;
  options?: string[];
};
export type StepDefinition = {
  number: number;
  title: string;
  fields: Field[];
  repeat?: Field[];
  questions?: { key: string; label: string }[];
};
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  required = false,
  options?: string[],
): Field => ({ key, label, type, required, options });
export const medicalQuestions = [
  ["illness", "מחלה בעבר"],
  ["chronic", "מחלה כרונית"],
  ["surgery", "ניתוח"],
  ["hospital", "אשפוז"],
  ["emergency", "טיפול במיון"],
  ["longMedication", "טיפול תרופתי ממושך"],
  ["medication", "תרופות קבועות"],
  ["imaging", "בדיקות הדמיה"],
  ["ongoing", "טיפול שטרם הסתיים"],
  ["futureSurgery", "ניתוח צפוי"],
  ["futureTest", "בדיקה נוספת צפויה"],
  ["symptoms", "תסמינים ללא אבחנה"],
  ["mobility", "מגבלה בתנועה"],
  ["diet", "מזון רפואי"],
  ["allergy", "אלרגיה"],
  ["injury", "פציעה או תאונה משמעותית"],
].map(([key, label]) => ({ key, label }));
export const bodySystemCategories = [
  ["לב וכלי דם", "מחלת לב, אוושה או הפרעת קצב"],
  ["נשימה", "אסתמה, קוצר נשימה או שיעול ממושך"],
  ["עיכול", "הקאות חוזרות, שלשול כרוני או מחלת מעי"],
  ["כבד ולבלב", "מחלת כבד או דלקת לבלב"],
  ["כליות ודרכי שתן", "מחלת כליות, אבנים או דלקות חוזרות"],
  ["עצבים", "פרכוסים, אפילפסיה או מחלה עצבית"],
  ["עצמות ומפרקים", "צליעה, דיספלזיה או מחלת מפרקים"],
  ["שרירים וגידים", "קרע, חולשת שרירים או פגיעה בגידים"],
  ["עור ואלרגיות", "אלרגיה, דלקת עור או גרד כרוני"],
  ["עיניים", "קטרקט, פגיעה בקרנית או מחלת עיניים"],
  ["אוזניים", "דלקות חוזרות או ירידה בשמיעה"],
  ["שיניים וחלל הפה", "מחלת חניכיים, שבר שן או מחלת פה"],
  ["הורמונלית", "מחלת בלוטת התריס או מחלת יותרת הכליה"],
  ["מטבולית", "סוכרת או הפרעה מטבולית אחרת"],
  ["זיהומים", "זיהום ממושך או מחלה זיהומית בעבר"],
  ["גידולים וסרטן", "גוש, גידול או אבחנה אונקולוגית"],
  ["רבייה", "מחלה או טיפול במערכת הרבייה"],
  ["התנהגות", "חרדה, תוקפנות או הפרעה התנהגותית"],
  ["תורשתיות", "מחלה תורשתית ידועה או חשודה"],
  ["מולדות", "מום מולד או הפרעה בהתפתחות"],
].map(([label, topic], i) => ({ key: `system${i + 1}`, label, topic }));
export const bodySystems = bodySystemCategories.flatMap((c) => [
  { key: c.key, label: `${c.label} — האם אובחן מצב כגון ${c.topic}?` },
  {
    key: c.key + "Symptoms",
    label: `${c.label} — האם קיימים תסמינים או בירור רפואי שטרם הסתיים?`,
  },
  {
    key: c.key + "Treatment",
    label: `${c.label} — האם ניתן או צפוי טיפול בתחום זה?`,
  },
]);
export const medicalDetails = [
  f("onset", "מועד הופעת הבעיה", "date", true),
  f("diagnosis", "אבחנה / תסמין", "text", true),
  f("treatment", "טיפול שניתן", "textarea", true),
  f("clinic", "מרפאה", "text", true),
  f("medication", "תרופות"),
  f("outcome", "תוצאת הטיפול"),
  f("currentStatus", "מצב נוכחי", "text", true),
  f("futureTreatment", "טיפול נוסף צפוי", "boolean", true),
  f("attachmentId", "מזהה מסמך רפואי", "text", true),
  f("notes", "הערות", "textarea"),
];
export const declarations = [
  ["accuracy", "אני מאשר/ת את נכונות הפרטים שמסרתי."],
  ["medical", "מסרתי את המידע הרפואי הידוע לי במסגרת הסימולציה."],
  ["terms", "קיבלתי וקראתי את תנאי המוצר המוצגים."],
  ["waiting", "קיבלתי מידע על תקופות האכשרה."],
  ["exclusions", "קיבלתי מידע על ההחרגות."],
  ["deductible", "קיבלתי מידע על ההשתתפות העצמית."],
  ["limits", "קיבלתי מידע על תקרות הכיסוי."],
  ["payment", "אני מאשר/ת את תנאי התשלום המדומה."],
  ["processing", "אני מסכים/ה לעיבוד הנתונים הבדויים לצורך הסימולציה."],
].map(([key, label]) => ({ key, label }));
export const enrollmentSteps: StepDefinition[] = [
  {
    number: 1,
    title: "פתיחת בקשת הצטרפות",
    fields: [
      f("channel", "ערוץ", "select", true, ["PHONE", "WEB", "AGENT", "CLINIC"]),
      f("source", "מקור הפנייה", "text", true),
      f("requestType", "סוג בקשה", "select", true, ["NEW"]),
      f("urgency", "דחיפות", "select", true, ["NORMAL", "HIGH", "URGENT"]),
      f("notes", "הערות פנימיות", "textarea"),
    ],
  },
  {
    number: 2,
    title: "זיהוי בעל הפוליסה",
    fields: [
      f("customerId", "מזהה לקוח קיים"),
      f("firstName", "שם פרטי", "text", true),
      f("lastName", "שם משפחה", "text", true),
      f("identifierType", "סוג מזהה", "select", true, [
        "SIMULATED_ID",
        "SIMULATED_PASSPORT",
      ]),
      f("identifier", "מזהה בדוי", "text", true),
      f("birthDate", "תאריך לידה", "date", true),
      f("phone", "טלפון נייד", "text", true),
      f("additionalPhone", "טלפון נוסף"),
      f("email", "דואר אלקטרוני", "text", true),
      f("address", "רחוב ומספר", "text", true),
      f("city", "עיר", "text", true),
      f("postalCode", "מיקוד"),
      f("preferredContact", "אמצעי התקשרות", "select", true, [
        "PHONE",
        "EMAIL",
      ]),
      f("language", "שפה", "select", true, ["HE", "EN", "AR"]),
      f("verified", "אומתו הפרטים", "boolean", true),
      f("consent", "הסכמה לשימוש במידע בדוי", "boolean", true),
    ],
  },
  {
    number: 3,
    title: "פרטי בעל החיים",
    fields: [
      f("petId", "מזהה חיה קיימת"),
      f("name", "שם", "text", true),
      f("species", "סוג", "select", true, ["DOG", "CAT"]),
      f("breed", "גזע", "text", true),
      f("mixed", "גזע מעורב", "boolean", true),
      f("sex", "מין", "select", true, ["MALE", "FEMALE"]),
      f("birthDate", "תאריך לידה", "date", true),
      f("weight", "משקל בק״ג", "number", true),
      f("color", "צבע"),
      f("chip", "מספר שבב — 15 ספרות"),
      f("chipDate", "מועד החדרת שבב", "date"),
      f("neutered", "מסורס / מעוקרת", "boolean", true),
      f("neuteredDate", "מועד סירוס / עיקור", "date"),
      f("use", "שימוש", "select", true, ["COMPANION", "WORKING"]),
      f("residence", "מקום מגורים עיקרי", "text", true),
      f("vet", "וטרינר קבוע"),
      f("clinic", "מרפאה"),
      f("ownershipHistory", "היסטוריית בעלות", "textarea"),
      f("adoptionDate", "אימוץ / רכישה", "date"),
    ],
  },
  {
    number: 4,
    title: "אימות וזכאות בעל החיים",
    fields: [
      f("productId", "מוצר מבוקש", "text", true),
      f("startDate", "תחילת כיסוי", "date", true),
      f("confirmed", "נתוני החיה נבדקו", "boolean", true),
    ],
  },
  {
    number: 5,
    title: "שאלון רפואי כללי",
    fields: [],
    questions: medicalQuestions,
  },
  {
    number: 6,
    title: "שאלון לפי מערכות גוף",
    fields: [],
    questions: bodySystems,
  },
  {
    number: 7,
    title: "היסטוריה וטרינרית",
    fields: [f("none", "אין היסטוריה נוספת", "boolean", true)],
    repeat: [
      f("date", "תאריך", "date", true),
      f("kind", "סוג", "select", true, [
        "VISIT",
        "SURGERY",
        "HOSPITAL",
        "TEST",
        "MEDICATION",
      ]),
      f("diagnosis", "אבחנה", "text", true),
      f("treatment", "טיפול", "textarea", true),
      f("clinic", "מרפאה", "text", true),
      f("vet", "וטרינר"),
      f("attachmentId", "מסמך רפואי"),
    ],
  },
  {
    number: 8,
    title: "חיסונים וטיפולים מניעתיים",
    fields: [f("vaccinated", "מחוסן לפי ההצהרה", "boolean", true)],
    repeat: [
      f("kind", "סוג חיסון / טיפול", "text", true),
      f("date", "תאריך", "date", true),
      f("validUntil", "תוקף", "date"),
      f("clinic", "מרפאה", "text", true),
      f("attachmentId", "אסמכתה"),
    ],
  },
  {
    number: 9,
    title: "השוואת ובחירת מסלול",
    fields: [f("productId", "מסלול נבחר", "text", true)],
  },
  {
    number: 10,
    title: "הרחבות",
    fields: [f("confirmed", "בחירת ההרחבות נבדקה", "boolean", true)],
    repeat: [f("riderId", "מזהה הרחבה נבחרת", "text", true)],
  },
  {
    number: 11,
    title: "הצעת מחיר",
    fields: [f("accepted", "אישור פירוט חישוב המחיר המדומה", "boolean", true)],
  },
  {
    number: 12,
    title: "בדיקת חיתום",
    fields: [f("requested", "העברה לבדיקת חיתום", "boolean", true)],
  },
  {
    number: 13,
    title: "תנאים והצהרות",
    fields: declarations.map((d) => f(d.key, d.label, "boolean", true)),
  },
  {
    number: 14,
    title: "מסמכים נדרשים",
    fields: [f("reviewed", "רשימת המסמכים נבדקה", "boolean", true)],
  },
  {
    number: 15,
    title: "תשלום מדומה",
    fields: [
      f("frequency", "תדירות חיוב", "select", true, ["ANNUAL", "MONTHLY"]),
      f("method", "אמצעי תשלום מדומה", "select", true, [
        "SIMULATED_TRANSFER",
        "SIMULATED_CARD",
      ]),
      f("accepted", "אישור תנאי הגבייה המדומה", "boolean", true),
    ],
  },
  {
    number: 16,
    title: "חתימה מדומה",
    fields: [
      f("signerName", "שם החותם", "text", true),
      f("signerRole", "תפקיד החותם", "select", true, [
        "POLICYHOLDER",
        "AUTHORIZED_REPRESENTATIVE",
      ]),
      f("accepted", "חתימה מדומה ללא אימות משפטי", "boolean", true),
    ],
  },
  {
    number: 17,
    title: "סיכום ובקרת שלמות",
    fields: [f("confirmed", "כל פרטי הסיכום נבדקו", "boolean", true)],
  },
  { number: 18, title: "הפקת פוליסה", fields: [] },
];
// Definition v1 remains readable for drafts created before expanded body questionnaires.
export function enrollmentDefinition(
  version = ENROLLMENT_VERSION,
): StepDefinition[] {
  if (version === ENROLLMENT_VERSION) return enrollmentSteps;
  if (version === 1)
    return enrollmentSteps.map((s) =>
      s.number === 6
        ? {
            ...s,
            questions: bodySystemCategories.map((c) => ({
              key: c.key,
              label: c.label,
            })),
          }
        : s,
    );
  throw new Error("Unsupported enrollment definition version");
}
export type Answers = Record<string, unknown>;
export function validateStep(
  number: number,
  answers: Answers,
  version = ENROLLMENT_VERSION,
): string[] {
  const def = enrollmentDefinition(version).find((s) => s.number === number);
  if (!def) return ["שלב אינו קיים"];
  const errors: string[] = [];
  const validate = (fields: Field[], a: Answers, prefix = "") => {
    for (const field of fields) {
      const v = a[field.key];
      if (v === undefined || v === null || v === "") {
        if (field.required) errors.push(prefix + field.label + ": חובה");
        continue;
      }
      if (field.type === "boolean") {
        if (typeof v !== "boolean")
          errors.push(prefix + field.label + ": נדרש כן או לא");
      } else if (field.type === "number") {
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 200)
          errors.push(prefix + field.label + ": מספר לא תקין");
      } else if (typeof v !== "string" || v.length > 4000)
        errors.push(prefix + field.label + ": טקסט לא תקין");
      else if (
        field.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          !Number.isFinite(Date.parse(v)) ||
          new Date(v).toISOString().slice(0, 10) !== v)
      )
        errors.push(prefix + field.label + ": תאריך לא תקין");
      else if (field.options && !field.options.includes(v))
        errors.push(prefix + field.label + ": בחירה לא תקינה");
    }
  };
  validate(def.fields, answers);
  if (def.questions) {
    for (const q of def.questions) {
      const answer = answers[q.key];
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
        errors.push(q.label + ": חסרה תשובה");
        continue;
      }
      const a = answer as Answers;
      if (typeof a.value !== "boolean")
        errors.push(q.label + ": נדרש כן או לא");
      if (a.value === true) validate(medicalDetails, a, q.label + " — ");
    }
  }
  if (def.repeat) {
    const records = answers.records;
    if (!Array.isArray(records) || records.length > 100)
      errors.push("רשימת רשומות לא תקינה");
    else
      for (const r of records) {
        if (!r || typeof r !== "object" || Array.isArray(r))
          errors.push("רשומה לא תקינה");
        else validate(def.repeat, r as Answers);
      }
    if (
      number === 7 &&
      Array.isArray(records) &&
      !records.length &&
      answers.none !== true
    )
      errors.push("יש להזין היסטוריה או לאשר שאין היסטוריה נוספת");
    if (
      number === 7 &&
      Array.isArray(records) &&
      records.length &&
      answers.none === true
    )
      errors.push("הצהרת היעדר היסטוריה סותרת את הרשומות");
  }
  const mustTrue: Record<number, string[]> = {
    2: ["verified", "consent"],
    4: ["confirmed"],
    10: ["confirmed"],
    11: ["accepted"],
    12: ["requested"],
    13: declarations.map((d) => d.key),
    14: ["reviewed"],
    15: ["accepted"],
    16: ["accepted"],
    17: ["confirmed"],
  };
  for (const key of mustTrue[number] || [])
    if (answers[key] !== true)
      errors.push(
        "נדרש אישור: " + (def.fields.find((f) => f.key === key)?.label || key),
      );
  if (number === 2) {
    if (
      typeof answers.email === "string" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email)
    )
      errors.push("דואר אלקטרוני לא תקין");
    if (
      typeof answers.phone === "string" &&
      !/^\+?[\d -]{7,20}$/.test(answers.phone)
    )
      errors.push("טלפון לא תקין");
  }
  if (number === 3 && answers.chip && !/^\d{15}$/.test(String(answers.chip)))
    errors.push("שבב חייב להכיל 15 ספרות");
  if (
    [2, 3].includes(number) &&
    typeof answers.birthDate === "string" &&
    answers.birthDate > new Date().toISOString().slice(0, 10)
  )
    errors.push("תאריך לידה עתידי");
  if (number === 16) {
    const strokes = answers.strokes;
    if (
      !Array.isArray(strokes) ||
      !strokes.length ||
      strokes.length > 100 ||
      strokes.some(
        (s) =>
          !Array.isArray(s) ||
          s.length < 2 ||
          s.length > 2000 ||
          s.some(
            (p) =>
              !Array.isArray(p) ||
              p.length !== 2 ||
              p.some(
                (n) =>
                  typeof n !== "number" ||
                  !Number.isFinite(n) ||
                  n < 0 ||
                  n > 1000,
              ),
          ),
      )
    )
      errors.push("נדרשת חתימה מצוירת תקינה");
  }
  return [...new Set(errors)];
}
export function latestSteps<T extends { number: number; revision: number }>(
  steps: T[],
): Record<number, T> {
  const out: Record<number, T> = {};
  for (const s of steps)
    if (!out[s.number] || out[s.number].revision < s.revision)
      out[s.number] = s;
  return out;
}
export function paymentSchedule(
  annualCents: number,
  frequency: string,
  start: string,
) {
  if (
    !Number.isSafeInteger(annualCents) ||
    annualCents <= 0 ||
    !["ANNUAL", "MONTHLY"].includes(frequency) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !Number.isFinite(Date.parse(start))
  )
    throw new Error("Invalid payment schedule");
  const count = frequency === "MONTHLY" ? 12 : 1;
  const first = new Date(start + "T00:00:00Z");
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1),
    );
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    d.setUTCDate(Math.min(first.getUTCDate(), last));
    return {
      position: i + 1,
      dueAt: d.toISOString().slice(0, 10),
      amountCents:
        Math.floor(annualCents / count) + (i < annualCents % count ? 1 : 0),
    };
  });
}
