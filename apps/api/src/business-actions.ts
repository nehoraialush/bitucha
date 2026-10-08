import { NotFoundException, BadRequestException } from "@nestjs/common";
import { Actor, need, permissions } from "./auth";
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
    id: "application.open",
    name: "פתיחת בקשת הצטרפות",
    module: "הצטרפות",
    permission: "policy.write",
    entityRequired: false,
    preconditions: [],
    fields: [],
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
];
export class BusinessActionService {
  private insurance = new InsuranceService();
  private enrollment = new EnrollmentService();
  list(actor: Actor) {
    return businessActions.filter((a) =>
      permissions[actor.role]?.some((p) => p === "*" || p === a.permission),
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
