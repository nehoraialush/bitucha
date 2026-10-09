import { SigningService } from "./signing";
import { retryDocument } from "./documents";
import { EmployeeService } from "./employees";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { Actor, need, permissions, actorPermissions } from "./auth";
import { InsuranceService } from "./service";
import { EnrollmentService } from "./enrollment";
import { text } from "./validation";
type ActionDefinition = {
  id: string;
  name: string;
  module: string;
  permission: string;
  entityRequired: boolean;
  preconditions: string[];
  fields: string[];
  effects: string[];
  documents: string[];
};
// Every advertised action has an implemented transactional handler below.
export const businessActions: ActionDefinition[] = [
  {
    id: "application.signing.create",
    name: "יצירת קישור חתימה ללקוח",
    module: "חתימות",
    permission: "policy.write",
    entityRequired: true,
    preconditions: ["השלמת 15 שלבים", "גרסה עדכנית", "אין חתימה שהושלמה"],
    fields: ["version"],
    effects: ["תוכן מוקפא", "קישור אישי ל־48 שעות", "ביטול קישורים קודמים"],
    documents: ["הסכם הצטרפות", "הצהרת בריאות", "לוח תשלומים"],
  },
  {
    id: "signing.revoke",
    name: "ביטול קישור חתימה",
    module: "חתימות",
    permission: "policy.write",
    entityRequired: true,
    preconditions: ["קישור ממתין"],
    fields: [],
    effects: ["ביטול גישת החותם", "תיעוד ביקורת"],
    documents: [],
  },
  {
    id: "signing.assist",
    name: "ליווי חותם בהודעה",
    module: "חתימות",
    permission: "signing.assist",
    entityRequired: true,
    preconditions: ["קישור ממתין בתוקף"],
    fields: ["message"],
    effects: ["הודעה ללקוח", "תיעוד אירוע חתימה"],
    documents: [],
  },
  {
    id: "document.pdf.retry",
    name: "ניסיון חוזר להפקת PDF",
    module: "מסמכים",
    permission: "document.generate",
    entityRequired: true,
    preconditions: ["הפקה נכשלה", "הרשאת צפייה במסמך"],
    fields: [],
    effects: ["החזרה לתור ההפקה", "שמירת HTML מקורי", "תיעוד ביקורת"],
    documents: ["PDF של המסמך המקורי"],
  },

  {
    id: "application.open",
    name: "פתיחת בקשת הצטרפות",
    module: "הצטרפות",
    permission: "policy.write",
    entityRequired: false,
    preconditions: [],
    fields: ["renewalOfId"],
    effects: ["יצירת תהליך ובקשה עם מספר ייחודי"],
    documents: [],
  },
  {
    id: "application.step.save",
    name: "שמירת שלב הצטרפות",
    module: "הצטרפות",
    permission: "policy.write",
    entityRequired: true,
    preconditions: ["תהליך פתוח", "גרסה עדכנית", "השלבים הקודמים הושלמו"],
    fields: ["number", "version", "answers", "complete"],
    effects: [
      "גרסת תשובות חדשה",
      "ביטול השלמת שלבים תלויים",
      "בדיקות זכאות וחישוב לפי שלב",
    ],
    documents: [],
  },
  {
    id: "application.underwrite",
    name: "החלטת חיתום הצטרפות",
    module: "חיתום",
    permission: "underwriting.decide",
    entityRequired: true,
    preconditions: [
      "ממתינה לאישור",
      "מאשר שונה מיוזם",
      "מסמכים רפואיים מאושרים",
    ],
    fields: ["version", "decision", "reason", "excludedCategories"],
    effects: ["החלטת חיתום מנומקת", "עדכון מצב התהליך"],
    documents: ["סיכום חיתום בהפקה"],
  },
  {
    id: "application.issue",
    name: "הפקת פוליסה מהצטרפות",
    module: "הצטרפות",
    permission: "policy.write",
    entityRequired: true,
    preconditions: ["כל 17 השלבים הושלמו", "הצעה בתוקף", "זכאות ללא חפיפה"],
    fields: ["version"],
    effects: ["לקוח וחיה", "פוליסה פעילה", "לוח חיובים", "גרסה סופית"],
    documents: [
      "הצטרפות",
      "הצהרת בריאות",
      "סיכום חיתום",
      "פוליסה",
      "חתימה מדומה",
    ],
  },
  {
    id: "policy.quote",
    name: "הפקת הצעת ביטוח",
    module: "פוליסות",
    permission: "policy.write",
    entityRequired: false,
    preconditions: ["חיה זכאית", "מוצר מפורסם", "ללא תקופה חופפת"],
    fields: ["petId", "productId", "startDate"],
    effects: ["הצעה או הפניה לחיתום"],
    documents: ["הצעת ביטוח"],
  },
  {
    id: "policy.activate",
    name: "הפעלת פוליסה",
    module: "פוליסות",
    permission: "policy.write",
    entityRequired: true,
    preconditions: ["הצעה מאושרת", "אישור תנאים"],
    fields: ["accepted", "paymentMethod"],
    effects: ["פוליסה פעילה", "חיוב שנתי"],
    documents: ["פוליסה"],
  },
  {
    id: "policy.cancel",
    name: "ביטול פוליסה",
    module: "פוליסות",
    permission: "policy.cancel",
    entityRequired: true,
    preconditions: ["פוליסה פעילה או מושעית", "מועד ביטול תקין"],
    fields: ["at", "reason"],
    effects: ["סיום כיסוי במועד", "זיכוי לוח חיובים", "יתרת החזר"],
    documents: ["אישור ביטול"],
  },
  {
    id: "policy.suspend",
    name: "השעיית פוליסה",
    module: "פוליסות",
    permission: "policy.write",
    entityRequired: true,
    preconditions: ["פוליסה פעילה בתקופה"],
    fields: ["reason"],
    effects: ["שמירת תקופת השעיה", "השעיית כיסוי"],
    documents: ["נספח השעיה"],
  },
  {
    id: "policy.reinstate",
    name: "הפעלה מחדש",
    module: "פוליסות",
    permission: "policy.write",
    entityRequired: true,
    preconditions: ["פוליסה מושעית בתקופה"],
    fields: ["reason"],
    effects: ["סגירת תקופת השעיה", "החזרת כיסוי"],
    documents: ["נספח הפעלה מחדש"],
  },
  {
    id: "claim.submit",
    name: "הגשת תביעה",
    module: "תביעות",
    permission: "claim.write",
    entityRequired: false,
    preconditions: ["פוליסה שהופעלה", "1–30 שורות טיפול"],
    fields: ["policyId", "eventDate", "diagnosis", "clinic", "lines"],
    effects: ["פתיחת תיק תביעה ושורות"],
    documents: [],
  },
  {
    id: "claim.decide",
    name: "החלטת תביעה",
    module: "תביעות",
    permission: "claim.decide",
    entityRequired: true,
    preconditions: [
      "תביעה ללא החלטה סופית",
      "בדיקת כיסוי ויתרות",
      "סמכות סכום",
    ],
    fields: ["decision", "reason"],
    effects: ["חישוב לכל שורה", "שריון סכום", "הוראת תשלום"],
    documents: ["מכתב החלטה ופירוט חישוב"],
  },
  {
    id: "payment.execute",
    name: "ביצוע תשלום תביעה מדומה",
    module: "כספים",
    permission: "payment.execute",
    entityRequired: true,
    preconditions: ["הוראת תשלום מאושרת וטרם בוצעה"],
    fields: [],
    effects: ["שחרור שריון", "יתרה ששולמה", "תנועה כספית"],
    documents: ["אישור תשלום"],
  },
  {
    id: "charge.collect",
    name: "גבייה מדומה",
    module: "כספים",
    permission: "collection.write",
    entityRequired: true,
    preconditions: ["יתרת חיוב פתוחה", "סכום עד יתרת החוב"],
    fields: ["amountCents"],
    effects: ["עדכון חיוב", "תנועת גבייה"],
    documents: ["קבלה"],
  },
  {
    id: "document.sign",
    name: "חתימה מדומה על מסמך",
    module: "מסמכים",
    permission: "document.sign",
    entityRequired: true,
    preconditions: ["מסמך קיים", "אישור הצהרת סימולציה"],
    fields: ["accepted"],
    effects: ["רישום חתימה מדומה"],
    documents: ["המסמך שנחתם"],
  },
  {
    id: "employee.create",
    name: "יצירת עובד",
    module: "מנהלה",
    permission: "employee.write",
    entityRequired: false,
    preconditions: ["סמכות למתן ההרשאות המבוקשות", "דוא״ל ייחודי"],
    fields: [
      "name",
      "email",
      "password",
      "role",
      "active",
      "department",
      "team",
      "managerId",
      "permissionMode",
      "grants",
      "approvalLimitCents",
    ],
    effects: [
      "חשבון עם סיסמה מוצפנת חד־כיוונית",
      "הרשאות במסד",
      "תיעוד ביקורת",
    ],
    documents: [],
  },
  {
    id: "employee.update",
    name: "עדכון עובד והרשאות",
    module: "מנהלה",
    permission: "employee.write",
    entityRequired: true,
    preconditions: [
      "גרסת עובד עדכנית",
      "ללא הסלמת הרשאות",
      "מנהל ללא מעגל",
      "מנהל פעיל אחר נשמר",
    ],
    fields: [
      "version",
      "name",
      "role",
      "active",
      "department",
      "team",
      "managerId",
      "permissionMode",
      "grants",
      "approvalLimitCents",
    ],
    effects: ["עדכון חשבון והרשאות", "ביטול sessions קיימים", "תיעוד ביקורת"],
    documents: [],
  },
];
export class BusinessActionService {
  private signing = new SigningService();
  private insurance = new InsuranceService();
  private employees = new EmployeeService();
  private enrollment = new EnrollmentService();
  list(actor: Actor) {
    return businessActions.filter((a) =>
      actorPermissions(actor).some((p) => p === "*" || p === a.permission),
    );
  }
  async execute(actor: Actor, actionId: string, b: any, key: unknown) {
    const definition = businessActions.find((a) => a.id === actionId);
    if (!definition) throw new NotFoundException("פעולה עסקית אינה קיימת");
    need(actor, definition.permission);
    const id = definition.entityRequired ? text(b.entityId, "מזהה רשומה") : "";
    const input = b.input || {};
    if (typeof input !== "object" || Array.isArray(input))
      throw new BadRequestException("קלט פעולה אינו תקין");
    switch (actionId) {
      case "application.signing.create":
        return this.signing.create(actor, id, input, key);
      case "signing.revoke":
        return this.signing.revoke(actor, id, key);
      case "signing.assist":
        return this.signing.assist(actor, id, input, key);
      case "document.pdf.retry":
        return retryDocument(actor, id, key);
      case "employee.create":
        return this.employees.create(actor, input, key);
      case "employee.update":
        return this.employees.update(actor, id, input, key);
      case "application.open":
        return this.enrollment.create(actor, input, key);
      case "application.step.save":
        return this.enrollment.save(actor, id, input.number, input, key);
      case "application.underwrite":
        return this.enrollment.decide(actor, id, input, key);
      case "application.issue":
        return this.enrollment.issue(actor, id, input, key);
      case "policy.quote":
        return this.insurance.createPolicy(actor, input, key);
      case "policy.activate":
        return this.insurance.activate(actor, id, input, key);
      case "policy.cancel":
        return this.insurance.cancelPolicy(actor, id, input, key);
      case "policy.suspend":
        return this.insurance.suspend(actor, id, input, key);
      case "policy.reinstate":
        return this.insurance.reinstate(actor, id, input, key);
      case "claim.submit":
        return this.insurance.createClaim(actor, input, key);
      case "claim.decide":
        return this.insurance.decideClaim(actor, id, input, key);
      case "payment.execute":
        return this.insurance.executePayment(actor, id, key);
      case "charge.collect":
        return this.insurance.collect(actor, id, input, key);
      case "document.sign":
        return this.insurance.sign(actor, id, input, key);
      default:
        throw new NotFoundException("מימוש הפעולה אינו זמין");
    }
  }
}
