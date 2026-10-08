let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === "string" ? data.message : "הפעולה נכשלה",
    );
  return data;
}
export const money = (cents: number) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const localDate = (value: string) =>
  new Date(value).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
export const statusText: Record<string, string> = {
  ACTIVE: "פעילה",
  WAITING_APPROVAL: "ממתינה לאישור",
  READY: "מוכנה להפקה",
  DRAFT: "טיוטה",
  QUOTED: "הצעה",
  UNDERWRITING_PENDING: "ממתינה לחיתום",
  DECLINED: "נדחתה בחיתום",
  CANCELLED: "מבוטלת",
  SUSPENDED: "מושעית",
  EXPIRED: "הסתיימה",
  SUBMITTED: "הוגשה",
  NEEDS_INFORMATION: "נדרשת השלמה",
  APPROVED: "אושרה",
  PARTIALLY_APPROVED: "אושרה חלקית",
  REJECTED: "נדחתה",
  PAID: "שולמה",
  EXECUTED: "בוצע",
  OPEN: "פתוחה",
  CLOSED: "סגורה",
  NORMAL: "רגילה",
  HIGH: "גבוהה",
  URGENT: "דחופה",
  COMPLETED: "הושלמה",
};
