import React, { useEffect, useState } from "react";
import { api, money } from "../api";
import { Button } from "./ui/button";
const roles: Record<string, string> = {
  ADMIN: "מנהל מערכת",
  SERVICE: "שירות",
  SALES: "מכירות",
  UNDERWRITER: "חתם",
  CLAIMS: "תביעות",
  CLAIMS_MANAGER: "מנהל תביעות",
  FINANCE: "כספים",
  AUDITOR: "מבקר",
};
const permissionNames: Record<string, string> = {
  "customer.write": "יצירה ועריכת לקוחות",
  "case.write": "ניהול פניות ומשימות",
  "document.sign": "חתימה מדומה",
  "policy.write": "הצטרפות, הפעלה וחידוש פוליסה",
  "underwriting.decide": "החלטת חיתום ובדיקת מסמכים",
  "application.read": "קריאת בקשות ומסמכי הצטרפות רפואיים",
  "claim.write": "פתיחת תביעה",
  "claim.decide": "החלטת תביעה",
  "claim.large": "אישור תביעה גדולה",
  "payment.execute": "תשלום תביעה מדומה",
  "collection.write": "גבייה מדומה",
  "policy.cancel": "ביטול פוליסה",
  "employee.write": "ניהול עובדים והרשאות",
  "*": "כל הפעולות",
};
const empty = {
  name: "",
  email: "",
  password: "",
  role: "UNDERWRITER",
  active: true,
  department: "חיתום",
  team: "",
  managerId: "",
  permissionMode: "ROLE",
  approvalLimit: "",
  grants: [] as string[],
};
export function EmployeesWorkspace({
  actorId,
  onSelfUpdate,
}: {
  actorId: string;
  onSelfUpdate: () => void;
}) {
  const [catalog, setCatalog] = useState<any>(null),
    [form, setForm] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = () => api("/employees").then(setCatalog);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const change = (key: string, value: any) =>
    setForm((f: any) => ({ ...f, [key]: value }));
  return (
    <section dir="rtl" className="panel">
      <header className="page-title">
        <div>
          <h1>ניהול עובדים והרשאות</h1>
          <p>תפקידים, מחלקות, צוותים, מנהלים וסמכויות אישור</p>
        </div>
        <Button
          disabled={busy}
          onClick={() => {
            setForm({ ...empty });
            setError("");
          }}
        >
          יצירת עובד
        </Button>
      </header>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <table>
        <thead>
          <tr>
            <th>עובד</th>
            <th>דוא״ל</th>
            <th>תפקיד</th>
            <th>מחלקה / צוות</th>
            <th>מנהל</th>
            <th>הרשאות</th>
            <th>סמכות תביעה</th>
            <th>מצב</th>
            <th>פעולה</th>
          </tr>
        </thead>
        <tbody>
          {catalog?.employees.map((e: any) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.email}</td>
              <td>{roles[e.role] || e.role}</td>
              <td>
                {e.department} / {e.team}
              </td>
              <td>
                {catalog.employees.find((x: any) => x.id === e.managerId)
                  ?.name || "—"}
              </td>
              <td>
                {e.permissionMode === "ROLE"
                  ? "לפי תפקיד"
                  : `${e.permissionGrants.length} הרשאות אישיות`}
              </td>
              <td>
                {e.approvalLimitCents == null
                  ? "לפי סמכות התפקיד"
                  : money(e.approvalLimitCents)}
              </td>
              <td>{e.active ? "פעיל" : "מושבת"}</td>
              <td>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setForm({
                      ...e,
                      password: "",
                      managerId: e.managerId || "",
                      grants: e.permissionGrants.map((g: any) => g.permission),
                      approvalLimit:
                        e.approvalLimitCents == null
                          ? ""
                          : String(e.approvalLimitCents / 100),
                    });
                    setError("");
                  }}
                >
                  עריכת {e.name}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {form && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={form.id ? "עריכת עובד" : "יצירת עובד"}
          className="workflow-body"
        >
          <h2>{form.id ? "עריכת עובד" : "יצירת עובד"}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const cap =
                  form.approvalLimit === ""
                    ? null
                    : Math.round(Number(form.approvalLimit) * 100);
                if (cap != null && (!Number.isSafeInteger(cap) || cap < 0))
                  throw new Error("סמכות אישור אינה תקינה");
                const payload = {
                  ...(form.id ? { version: form.version } : {}),
                  name: form.name,
                  role: form.role,
                  active: form.active,
                  department: form.department,
                  team: form.team,
                  managerId: form.managerId || null,
                  permissionMode: form.permissionMode,
                  approvalLimitCents: cap,
                  grants: form.grants,
                  ...(!form.id
                    ? { email: form.email, password: form.password }
                    : {}),
                };
                await api(
                  form.id ? `/employees/${form.id}/update` : "/employees",
                  "POST",
                  payload,
                  crypto.randomUUID(),
                );
                setNotice(
                  "פרטי העובד נשמרו. שינוי הרשאות או השבתה מבטלים את ההתחברויות הקיימות.",
                );
                const self = form.id === actorId;
                setForm(null);
                if (self) onSelfUpdate();
                else await load();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <div className="workflow-fields">
                <label className="field">
                  <span>שם עובד</span>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => change("name", e.target.value)}
                  />
                </label>
                {!form.id && (
                  <>
                    <label className="field">
                      <span>דוא״ל עובד</span>
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(e) => change("email", e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>סיסמה ראשונית — 16 תווים לפחות</span>
                      <input
                        required
                        type="password"
                        minLength={16}
                        maxLength={256}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => change("password", e.target.value)}
                      />
                    </label>
                  </>
                )}
                <label className="field">
                  <span>תפקיד</span>
                  <select
                    aria-label="תפקיד עובד"
                    value={form.role}
                    onChange={(e) => change("role", e.target.value)}
                  >
                    {catalog?.roles.map((r: string) => (
                      <option value={r} key={r}>
                        {roles[r] || r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>מחלקה</span>
                  <input
                    value={form.department}
                    onChange={(e) => change("department", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>צוות</span>
                  <input
                    value={form.team}
                    onChange={(e) => change("team", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>מנהל</span>
                  <select
                    aria-label="מנהל עובד"
                    value={form.managerId}
                    onChange={(e) => change("managerId", e.target.value)}
                  >
                    <option value="">ללא</option>
                    {catalog?.employees
                      .filter((e: any) => e.active && e.id !== form.id)
                      .map((e: any) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>תקרת אישור תביעה (₪) — ריק לפי סמכות תפקיד</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.approvalLimit}
                    onChange={(e) => change("approvalLimit", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>מצב עובד</span>
                  <select
                    aria-label="מצב עובד"
                    value={form.active ? "true" : "false"}
                    onChange={(e) =>
                      change("active", e.target.value === "true")
                    }
                  >
                    <option value="true">פעיל</option>
                    <option value="false">מושבת</option>
                  </select>
                </label>
                <label className="field">
                  <span>מקור הרשאות</span>
                  <select
                    aria-label="מקור הרשאות עובד"
                    value={form.permissionMode}
                    onChange={(e) => change("permissionMode", e.target.value)}
                  >
                    <option value="ROLE">לפי תפקיד</option>
                    <option value="CUSTOM">הרשאות אישיות מפורשות</option>
                  </select>
                </label>
              </div>
              {form.permissionMode === "CUSTOM" && (
                <div className="workflow-fields">
                  {[
                    ...catalog.permissionCatalog,
                    ...(form.role === "ADMIN" ? ["*"] : []),
                  ].map((p: string) => (
                    <label key={p}>
                      <input
                        type="checkbox"
                        checked={form.grants.includes(p)}
                        onChange={(e) =>
                          change(
                            "grants",
                            e.target.checked
                              ? [...form.grants, p]
                              : form.grants.filter((x: string) => x !== p),
                          )
                        }
                      />
                      {permissionNames[p] || p}
                    </label>
                  ))}
                </div>
              )}
              <p>
                השרת מונע הסלמת הרשאות, מעגל בניהול העובדים, השבתת המשתמש המחובר
                והסרת המנהל הפעיל האחרון.
              </p>
              <Button disabled={busy}>שמירת עובד</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm(null)}
              >
                ביטול עריכת עובד
              </Button>
            </fieldset>
          </form>
        </div>
      )}
    </section>
  );
}
