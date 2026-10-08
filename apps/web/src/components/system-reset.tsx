import React, { useState } from "react";
import { api } from "../api";
import { Button } from "./ui/button";
const labels: Record<string, string> = {
  Customer: "לקוחות",
  Pet: "בעלי חיים",
  Policy: "פוליסות",
  Claim: "תביעות",
  ClaimLine: "שורות תביעה",
  PaymentOrder: "הוראות תשלום",
  Charge: "חיובים",
  LedgerEntry: "תנועות כספיות",
  Document: "מסמכים",
  ServiceCase: "פניות",
  Task: "משימות",
  PolicySuspension: "תקופות השעיה",
  WorkflowInstance: "תהליכים",
  WorkflowStep: "גרסאות שלבים",
  WorkflowAttachment: "קבצים מצורפים",
  Application: "בקשות הצטרפות",
  ApprovalRequest: "בקשות אישור",
  AuditEvent: "אירועי ביקורת",
  Command: "רשומות מניעת כפל",
  ProductVersion: "גרסאות מוצר",
  ProductRider: "הרחבות",
};
export function SystemReset({ onReset }: { onReset: () => Promise<void> }) {
  const [preview, setPreview] = useState<any>(null),
    [phrase, setPhrase] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<any>(null),
    [restoreOpen, setRestoreOpen] = useState(false),
    [restoreNotice, setRestoreNotice] = useState("");
  return (
    <section className="panel" dir="rtl">
      <h1>ניהול ואיפוס המערכת</h1>
      <p>
        האיפוס מוחק את כל הנתונים העסקיים ואת קטלוג המוצרים. חשבונות העובדים,
        ההתחברות ומבנה מסד הנתונים נשמרים. לאחר האיפוס נשמרת קבלת איפוס ביומן
        הביקורת.
      </p>
      <p>
        <strong>
          המחיקה אינה ניתנת לביטול בממשק. יש לשמור גיבוי אם רוצים לשחזר את
          הנתונים.
        </strong>
      </p>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {receipt && (
        <p role="status">האיפוס בוצע. מזהה קבלה: {receipt.resetId}</p>
      )}
      <div className="workflow-toolbar">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setRestoreOpen(true)}
        >
          החזרת נתוני דוגמה
        </Button>
      </div>
      {restoreNotice && <p role="status">{restoreNotice}</p>}
      {restoreOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="אישור החזרת נתוני דוגמה"
        >
          <h2>החזרת נתוני דוגמה</h2>
          <p>
            ייווצרו עד 100 לקוחות, 140 חיות, 120 פוליסות, 200 תביעות, חיובים,
            תשלומים, מסמכים ופניות בדויים. נתונים קיימים לא יוחלפו. חשבונות
            עובדים לא ישתנו.
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(
                  "/system/restore-demo",
                  "POST",
                  { confirmed: true },
                  crypto.randomUUID(),
                );
                setRestoreOpen(false);
                setRestoreNotice("נתוני הדוגמה הוחזרו. נתונים קיימים נשמרו.");
                setPreview(null);
                await onReset();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            אישור החזרת נתוני דוגמה
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setRestoreOpen(false)}
          >
            ביטול
          </Button>
        </div>
      )}
      <Button
        variant="destructive"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setPreview(await api("/system/reset-preview"));
            setPhrase("");
            setPassword("");
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        בדיקת היקף המחיקה לפני איפוס
      </Button>
      {preview && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await api(
                "/system/reset",
                "POST",
                { phrase, password, fingerprint: preview.fingerprint },
                crypto.randomUUID(),
              );
              setPassword("");
              setPreview(null);
              setReceipt(result);
              await onReset();
            } catch (e: any) {
              setError(e.message);
              setPassword("");
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>רשומות שיימחקו</h2>
          <table>
            <thead>
              <tr>
                <th>סוג</th>
                <th>כמות</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(preview.counts).map(([key, count]) => (
                <tr key={key}>
                  <td>{labels[key] || key}</td>
                  <td>{String(count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="field">
            <span>הקלד בדיוק: {preview.phrase}</span>
            <input
              required
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>סיסמת מנהל המערכת</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            variant="destructive"
            disabled={busy || phrase !== preview.phrase || !password}
          >
            {busy ? "מאפס…" : "איפוס המערכת ומחיקת כל הנתונים העסקיים"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              setPassword("");
            }}
          >
            ביטול
          </Button>
        </form>
      )}
    </section>
  );
}
