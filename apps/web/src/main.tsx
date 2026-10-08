import { EmployeesWorkspace } from "./components/employees-workspace";
import { SystemReset } from "./components/system-reset";
import { EnrollmentWorkspace } from "./components/enrollment-workspace";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  ClipboardList,
  BarChart3,
  Search,
  Plus,
  LogOut,
  PawPrint,
  ChevronLeft,
  FileText,
  X,
  CheckCircle2,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { api, setCsrf, money, localDate, statusText } from "./api";
import "./styles.css";
type Modal = { kind: string; data?: any; key: string };
const tabs = [
  "סקירה",
  "בעלי חיים",
  "פוליסות",
  "כיסויים",
  "תביעות",
  "תשלומים",
  "מסמכים",
  "פניות",
  "משימות",
  "היסטוריה",
];
const isoToday = () => new Date().toISOString().slice(0, 10);
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value.toLowerCase()}>
      {statusText[value] || value}
    </span>
  );
}
function Field({
  label,
  children,
}: React.PropsWithChildren<{ label: string }>) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ children }: React.PropsWithChildren) {
  return <div className="empty">{children || "אין רשומות להצגה"}</div>;
}
function App() {
  const [session, setSession] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [initialEnrollmentId, setInitialEnrollmentId] = useState("");
  const [section, setSection] = useState("dashboard"),
    [customers, setCustomers] = useState<any[]>([]),
    [query, setQuery] = useState(""),
    [products, setProducts] = useState<any[]>([]),
    [reports, setReports] = useState<any>(null),
    [queues, setQueues] = useState<any>(null);
  const [workspace, setWorkspace] = useState<any>(null),
    [tab, setTab] = useState("סקירה"),
    [modal, setModal] = useState<Modal | null>(null),
    [busy, setBusy] = useState(false),
    [lines, setLines] = useState(1),
    [assessment, setAssessment] = useState<any>(null),
    [cancelPreview, setCancelPreview] = useState<any>(null);
  const can = (p: string) =>
    session?.permissions?.some((v: string) => v === "*" || v === p);
  const open = (kind: string, data?: any) => {
    setError("");
    setAssessment(null);
    setCancelPreview(null);
    setLines(1);
    setModal({ kind, data, key: crypto.randomUUID() });
  };
  async function loadWorkspace(id: string) {
    setWorkspace(await api(`/customers/${id}/workspace`));
    setSection("customers");
  }
  async function refresh(includeWorkspace = true) {
    const [c, p, r, q] = await Promise.all([
      api("/customers?q=" + encodeURIComponent(query)),
      api("/products"),
      api("/reports"),
      api("/work-queues"),
    ]);
    setCustomers(c);
    setProducts(p);
    setReports(r);
    setQueues(q);
    if (workspace && includeWorkspace)
      setWorkspace(await api(`/customers/${workspace.id}/workspace`));
  }
  useEffect(() => {
    api("/auth/session")
      .then((s) => {
        setCsrf(s.csrf);
        setSession(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (session) refresh().catch((e) => setError(e.message));
  }, [session]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const timer = setTimeout(() => {
      api("/customers?q=" + encodeURIComponent(query))
        .then((c) => {
          if (active) setCustomers(c);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, session]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || busy) return;
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const b: any = Object.fromEntries(f);
    try {
      switch (modal.kind) {
        case "customer": {
          const c = await api("/customers", "POST", b);
          await loadWorkspace(c.id);
          break;
        }
        case "customer-edit":
          await api(`/customers/${workspace.id}`, "PATCH", {
            ...b,
            version: workspace.version,
          });
          break;
        case "pet":
          await api(`/customers/${workspace.id}/pets`, "POST", {
            ...b,
            vaccinated: f.has("vaccinated"),
            neutered: f.has("neutered"),
          });
          break;
        case "policy":
          await api("/policies", "POST", b, modal.key);
          break;
        case "activate":
          await api(
            `/policies/${modal.data.id}/activate`,
            "POST",
            { accepted: f.has("accepted"), paymentMethod: "SIMULATED_ANNUAL" },
            modal.key,
          );
          break;
        case "underwrite":
          await api(
            `/policies/${modal.data.id}/underwrite`,
            "POST",
            { ...b, excludedCategories: f.getAll("excludedCategories") },
            modal.key,
          );
          break;
        case "claim": {
          const treatments = Array.from({ length: lines }, (_, i) => ({
            category: f.get(`category${i}`),
            description: f.get(`description${i}`),
            costCents: Math.round(Number(f.get(`cost${i}`)) * 100),
          }));
          await api(
            "/claims",
            "POST",
            {
              policyId: b.policyId,
              eventDate: b.eventDate,
              diagnosis: b.diagnosis,
              clinic: b.clinic,
              lines: treatments,
            },
            modal.key,
          );
          break;
        }
        case "decide":
          await api(`/claims/${modal.data.id}/decide`, "POST", b, modal.key);
          break;
        case "pay":
          await api(
            `/payment-orders/${modal.data.id}/execute-simulated`,
            "POST",
            {},
            modal.key,
          );
          break;
        case "collect":
          await api(
            `/charges/${modal.data.id}/collect-simulated`,
            "POST",
            { amountCents: Math.round(Number(b.amount) * 100) },
            modal.key,
          );
          break;
        case "cancel":
          if (!cancelPreview)
            throw new Error("יש לחשב את ההשפעה הכספית לפני אישור");
          if (b.at !== cancelPreview.at)
            throw new Error("מועד הביטול השתנה. יש לחשב מחדש");
          await api(`/policies/${modal.data.id}/cancel`, "POST", b, modal.key);
          break;
        case "case":
          await api("/service-cases", "POST", {
            ...b,
            customerId: workspace.id,
          });
          break;
        case "case-status":
          await api(`/service-cases/${modal.data.id}`, "PATCH", {
            ...b,
            status: modal.data.status === "OPEN" ? "CLOSED" : "OPEN",
          });
          break;
        case "task":
          await api("/tasks", "POST", { ...b, customerId: workspace.id });
          break;
        case "task-complete":
          await api(`/tasks/${modal.data.id}/complete`, "POST", {});
          break;
        case "suspend":
        case "reinstate":
          await api(
            `/policies/${modal.data.id}/${modal.kind}`,
            "POST",
            b,
            modal.key,
          );
          break;
        case "product-version":
          await api(
            `/products/${modal.data.id}/versions`,
            "POST",
            {
              name: b.name,
              premiumCents: Math.round(Number(b.premium) * 100),
              annualLimitCents: Math.round(Number(b.limit) * 100),
              deductibleCents: Math.round(Number(b.deductible) * 100),
              reimbursementBps: Math.round(Number(b.reimbursement) * 100),
              waitingDays: Number(b.waitingDays),
              coverages: modal.data.coverages
                .filter((c: any) => f.has("include-" + c.code))
                .map((c: any) => ({
                  ...c,
                  limitCents: Math.round(
                    Number(f.get("coverage-" + c.code)) * 100,
                  ),
                })),
            },
            modal.key,
          );
          break;
        case "sign":
          await api(
            `/documents/${modal.data.id}/sign-simulated`,
            "POST",
            { accepted: f.has("accepted") },
            modal.key,
          );
          break;
      }
      setModal(null);
      setNotice("הפעולה בוצעה ונשמרה");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="loading">טוען סביבת עבודה…</div>;
  if (!session)
    return (
      <div className="login-page">
        <div className="login-brand">
          <PawPrint size={48} />
          <h1>ביטוחה</h1>
          <p>מערכת ליבה לביטוח חיות מחמד</p>
          <small>סביבת פיתוח · נתונים ותשלומים מדומים</small>
        </div>
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const s = await api("/auth/login", "POST", Object.fromEntries(f));
              setCsrf(s.csrf);
              setSession(s);
            } catch (err: any) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>כניסה לסביבת העבודה</h2>
          <p>יש להזין את פרטי המשתמש שהוגדרו בסביבה</p>
          <Field label="דוא״ל">
            <input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="סיסמה">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <Button disabled={busy}>{busy ? "מתחבר…" : "כניסה למערכת"}</Button>
        </form>
      </div>
    );
  const policies = workspace?.policies || [];
  const claims = policies.flatMap((p: any) =>
    p.claims.map((c: any) => ({ ...c, policyNumber: p.number, policy: p })),
  );
  const activeCount =
    reports?.policies?.find((p: any) => p.status === "ACTIVE")?._count || 0;
  const navigation = [
    ["dashboard", "סביבת עבודה", LayoutDashboard],
    ["customers", "לקוחות ומבוטחים", Users],
    ...(can("application.read")
      ? [["enrollment", "הצטרפות וחיתום", ClipboardList] as const]
      : []),
    ["products", "מוצרי ביטוח", ShieldCheck],
    ["queues", "תורי טיפול", ClipboardList],
    ["reports", "דוחות כספיים", BarChart3],
    ...(can("employee.write")
      ? [["employees", "עובדים והרשאות", Users] as const]
      : []),
    ...(can("system.reset")
      ? [["administration", "ניהול ואיפוס", ShieldCheck] as const]
      : []),
  ] as const;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <PawPrint />
          <div>
            ביטוחה<small>מערכת ליבה ארגונית</small>
          </div>
        </div>
        <div className="environment">
          <span /> סביבת פיתוח
        </div>
        <nav>
          {navigation.map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? "selected" : ""}
              onClick={() => {
                setSection(id);
                if (id === "customers") setWorkspace(null);
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>{session.employee.name}</strong>
          <small>{session.employee.role}</small>
          <button
            onClick={async () => {
              try {
                await api("/auth/logout", "POST");
                setSession(null);
                setCsrf("");
                setWorkspace(null);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <LogOut size={16} /> יציאה
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            מרכז תפעול <ChevronLeft size={14} />{" "}
            {navigation.find((n) => n[0] === section)?.[1]}
          </span>
          <div className="search">
            <Search size={17} />
            <input
              aria-label="חיפוש לקוח"
              placeholder="חיפוש לקוח לפי שם, מספר או טלפון"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSection("customers");
                setWorkspace(null);
              }}
            />
          </div>
          <span className="simulation">תשלומים מדומים בלבד</span>
        </header>
        <div className="content">
          {error && !modal && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCircle2 size={17} />
              {notice}
              <button aria-label="סגירת הודעה" onClick={() => setNotice("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {(section === "dashboard" || section === "reports") && !reports && (
            <div className="loading">טוען נתונים מהמערכת…</div>
          )}
          {(section === "dashboard" || section === "reports") && reports && (
            <>
              <div className="page-heading">
                <div>
                  <small>ניהול ותפעול</small>
                  <h1>
                    {section === "dashboard"
                      ? "סביבת העבודה שלך"
                      : "דוחות כספיים"}
                  </h1>
                  <p>נתונים עדכניים מתוך פעילות המערכת</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => refresh().catch((e) => setError(e.message))}
                >
                  רענון נתונים
                </Button>
              </div>
              <div className="metrics">
                {[
                  ["לקוחות", reports?.customers || 0],
                  ["בעלי חיים", reports?.pets || 0],
                  ["פוליסות פעילות", activeCount],
                  ["תגמולים ששולמו", money(reports?.claimPaidCents || 0)],
                ].map(([label, value]) => (
                  <div className="metric" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>נתוני סימולציה</small>
                  </div>
                ))}
              </div>
              <div className="grid-two">
                <section className="panel">
                  <h2>תמונת מצב תביעות</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>מצב</th>
                        <th>תביעות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports?.claims.map((c: any) => (
                        <tr key={c.status}>
                          <td>
                            <Badge value={c.status} />
                          </td>
                          <td>{c._count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="panel">
                  <h2>גבייה וכספים</h2>
                  <dl className="financial">
                    <dt>פרמיות מחויבות</dt>
                    <dd>{money(reports?.chargedCents || 0)}</dd>
                    <dt>גבייה מדומה שבוצעה</dt>
                    <dd>{money(reports?.collectedCents || 0)}</dd>
                    <dt>זיכויים</dt>
                    <dd>{money(reports?.creditedCents || 0)}</dd>
                    <dt>חוב פתוח</dt>
                    <dd>{money(reports?.debtCents || 0)}</dd>
                    <dt>תשלומי תביעות</dt>
                    <dd>{money(reports?.claimPaidCents || 0)}</dd>
                  </dl>
                  <Button
                    variant="secondary"
                    onClick={() => setSection("queues")}
                  >
                    מעבר לתורי הטיפול
                  </Button>
                </section>
              </div>
            </>
          )}
          {section === "employees" && (
            <EmployeesWorkspace
              actorId={session.employee.id}
              onSelfUpdate={() => {
                setSession(null);
                setCsrf("");
                setWorkspace(null);
              }}
            />
          )}
          {section === "administration" && (
            <SystemReset
              onReset={async () => {
                setWorkspace(null);
                setModal(null);
                setInitialEnrollmentId("");
                await refresh(false);
              }}
            />
          )}
          {section === "enrollment" && (
            <EnrollmentWorkspace
              session={session}
              products={products}
              onCustomer={loadWorkspace}
              initialId={initialEnrollmentId}
            />
          )}
          {section === "products" && (
            <>
              <div className="page-heading">
                <div>
                  <small>קטלוג וגרסאות</small>
                  <h1>מוצרי ביטוח</h1>
                  <p>
                    גרסאות שפורסמו · תנאי סימולציה הניתנים לאימות לפני שימוש
                    אמיתי
                  </p>
                </div>
              </div>
              <div className="product-grid">
                {products.map((p) => (
                  <section className="panel" key={p.id}>
                    <Badge value={p.species === "DOG" ? "כלב" : "חתול"} />
                    <h2>{p.name}</h2>
                    <small>
                      גרסה {p.version} · {p.code}
                    </small>
                    <dl className="financial">
                      <dt>פרמיה שנתית</dt>
                      <dd>{money(p.premiumCents)}</dd>
                      <dt>תקרה שנתית</dt>
                      <dd>{money(p.annualLimitCents)}</dd>
                      <dt>השתתפות לאירוע</dt>
                      <dd>{money(p.deductibleCents)}</dd>
                      <dt>החזר</dt>
                      <dd>{p.reimbursementBps / 100}%</dd>
                      <dt>אכשרה</dt>
                      <dd>{p.waitingDays} ימים</dd>
                      <dt>גיל כניסה</dt>
                      <dd>
                        {p.minAgeMonths}–{p.maxAgeMonths} חודשים
                      </dd>
                    </dl>
                    {can("product.manage") && (
                      <Button
                        variant="secondary"
                        onClick={() => open("product-version", p)}
                      >
                        יצירת גרסה חדשה
                      </Button>
                    )}
                    <details>
                      <summary>
                        כיסויים ותקרות משנה ({p.coverages.length})
                      </summary>
                      <table>
                        <tbody>
                          {p.coverages.map((c: any) => (
                            <tr key={c.code}>
                              <td>{c.name}</td>
                              <td>{money(c.limitCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </section>
                ))}
              </div>
            </>
          )}
          {section === "queues" && (
            <>
              <div className="page-heading">
                <div>
                  <small>משימות תפעוליות</small>
                  <h1>תורי טיפול</h1>
                  <p>כניסה לתיק הלקוח לטיפול במידע ובפעולות המקושרות</p>
                </div>
              </div>
              {[
                ["underwriting", "פוליסות הממתינות לחיתום"],
                ["claims", "תביעות לטיפול"],
                ["payments", "הוראות תשלום לביצוע"],
              ].map(([key, title]) => (
                <section className="panel queue" key={key}>
                  <h2>{title}</h2>
                  {queues?.[key]?.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>מספר</th>
                          <th>לקוח</th>
                          <th>מצב</th>
                          <th>פעולה</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queues[key].map((r: any) => (
                          <tr key={r.id}>
                            <td>{r.number || r.claim?.number}</td>
                            <td>
                              {r.customer?.name ||
                                r.policy?.customer?.name ||
                                r.claim?.policy?.customer?.name}
                            </td>
                            <td>
                              <Badge value={r.status} />
                            </td>
                            <td>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  loadWorkspace(
                                    r.customerId ||
                                      r.policy?.customerId ||
                                      r.claim?.policy?.customerId,
                                  )
                                    .then(() =>
                                      setTab(
                                        key === "underwriting"
                                          ? "פוליסות"
                                          : key === "payments"
                                            ? "תשלומים"
                                            : "תביעות",
                                      ),
                                    )
                                    .catch((e) => setError(e.message))
                                }
                              >
                                פתיחת תיק
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Empty />
                  )}
                </section>
              ))}
            </>
          )}
          {section === "customers" && !workspace && (
            <>
              <div className="page-heading">
                <div>
                  <small>תיקים ומבוטחים</small>
                  <h1>לקוחות ומבוטחים</h1>
                  <p>{customers.length} רשומות בתוצאות החיפוש</p>
                </div>
                {can("customer.write") && (
                  <Button onClick={() => open("customer")}>
                    <Plus size={16} />
                    פתיחת לקוח
                  </Button>
                )}
              </div>
              <section className="panel">
                <table>
                  <thead>
                    <tr>
                      <th>מספר לקוח</th>
                      <th>שם לקוח</th>
                      <th>טלפון</th>
                      <th>בעלי חיים</th>
                      <th>פוליסות</th>
                      <th>תיק לקוח</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td className="mono">
                          {String(c.number).padStart(6, "0")}
                        </td>
                        <td>
                          <strong>{c.name}</strong>
                          <small className="subtext">{c.email}</small>
                        </td>
                        <td dir="ltr">{c.phone}</td>
                        <td>{c._count.pets}</td>
                        <td>{c._count.policies}</td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setTab("סקירה");
                              loadWorkspace(c.id).catch((e) =>
                                setError(e.message),
                              );
                            }}
                          >
                            פתיחת תיק
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!customers.length && <Empty>לא נמצאו לקוחות</Empty>}
              </section>
            </>
          )}
          {section === "customers" && workspace && (
            <>
              <button className="back" onClick={() => setWorkspace(null)}>
                ← חזרה לרשימת לקוחות
              </button>
              <div className="customer-heading">
                <div className="avatar">{workspace.name.slice(0, 1)}</div>
                <div>
                  <small>
                    תיק לקוח #{String(workspace.number).padStart(6, "0")}
                  </small>
                  <h1>{workspace.name}</h1>
                  <p>
                    {workspace.phone} · {workspace.email || "לא הוזן דוא״ל"}
                  </p>
                </div>
                {can("customer.write") && (
                  <Button
                    variant="secondary"
                    onClick={() => open("customer-edit")}
                  >
                    עדכון פרטי לקוח
                  </Button>
                )}
              </div>
              <div className="tabs">
                {tabs.map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {tab === "סקירה" && (
                <div className="grid-two">
                  <section className="panel">
                    <h2>פרטי התיק</h2>
                    <dl className="financial">
                      <dt>כתובת</dt>
                      <dd>{workspace.address || "לא הוזנה"}</dd>
                      <dt>בעלי חיים</dt>
                      <dd>{workspace.pets.length}</dd>
                      <dt>פוליסות פעילות</dt>
                      <dd>
                        {
                          policies.filter((p: any) => p.status === "ACTIVE")
                            .length
                        }
                      </dd>
                      <dt>תביעות</dt>
                      <dd>{claims.length}</dd>
                    </dl>
                    <h3>הערות פנימיות</h3>
                    <p>{workspace.notes || "אין הערות"}</p>
                  </section>
                  <section className="panel">
                    <h2>פעולות אחרונות</h2>
                    {workspace.audit.slice(0, 8).map((a: any) => (
                      <div className="audit" key={a.id}>
                        <strong>{actionName(a.action)}</strong>
                        <small>
                          {localDate(a.createdAt)} · {a.reason}
                        </small>
                      </div>
                    ))}
                    {!workspace.audit.length && (
                      <Empty>אין פעילות מתועדת בתיק</Empty>
                    )}
                  </section>
                </div>
              )}
              {tab === "בעלי חיים" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>תיקי בעלי חיים</h2>
                    {can("customer.write") && (
                      <Button onClick={() => open("pet")}>
                        <Plus size={15} />
                        הוספת בעל חיים
                      </Button>
                    )}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>שם</th>
                        <th>סוג וגזע</th>
                        <th>תאריך לידה</th>
                        <th>שבב</th>
                        <th>חיסונים</th>
                        <th>היסטוריה רפואית</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.pets.map((p: any) => (
                        <tr key={p.id}>
                          <td>
                            <PawPrint size={15} /> {p.name}
                          </td>
                          <td>
                            {p.species === "DOG" ? "כלב" : "חתול"} · {p.breed}
                          </td>
                          <td>{localDate(p.birthDate)}</td>
                          <td className="mono">{p.chip || "חסר"}</td>
                          <td>{p.vaccinated ? "מעודכנים" : "דורשים בדיקה"}</td>
                          <td>{p.medicalHistory || "לא הוצהרה"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!workspace.pets.length && <Empty />}
                </section>
              )}
              {tab === "פוליסות" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>פוליסות והצעות</h2>
                    {can("policy.write") && workspace.pets.length > 0 && (
                      <Button onClick={() => open("policy")}>
                        <Plus size={15} />
                        הצעת ביטוח חדשה
                      </Button>
                    )}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>מספר</th>
                        <th>בעל חיים ומוצר</th>
                        <th>תקופת ביטוח</th>
                        <th>פרמיה שנתית</th>
                        <th>מצב</th>
                        <th>פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policies.map((p: any) => (
                        <tr key={p.id}>
                          <td>{p.number}</td>
                          <td>
                            {
                              workspace.pets.find((x: any) => x.id === p.petId)
                                ?.name
                            }
                            <small className="subtext">
                              {p.product.name} · גרסה {p.product.version}
                            </small>
                          </td>
                          <td>
                            {localDate(p.startDate)}–{localDate(p.endDate)}
                          </td>
                          <td>{money(p.premiumCents)}</td>
                          <td>
                            <Badge value={p.status} />
                          </td>
                          <td>
                            <div className="actions">
                              {["ACTIVE", "EXPIRED"].includes(p.status) &&
                                can("policy.write") && (
                                  <Button
                                    variant="secondary"
                                    onClick={async () => {
                                      try {
                                        const w = await api(
                                          "/applications",
                                          "POST",
                                          { renewalOfId: p.id },
                                          crypto.randomUUID(),
                                        );
                                        setInitialEnrollmentId(w.id);
                                        setSection("enrollment");
                                      } catch (e: any) {
                                        setError(e.message);
                                      }
                                    }}
                                  >
                                    חידוש פוליסה
                                  </Button>
                                )}
                              {p.status === "QUOTED" && can("policy.write") && (
                                <Button onClick={() => open("activate", p)}>
                                  הפעלה
                                </Button>
                              )}
                              {p.status === "UNDERWRITING_PENDING" &&
                                can("underwriting.decide") && (
                                  <Button onClick={() => open("underwrite", p)}>
                                    החלטת חיתום
                                  </Button>
                                )}
                              {p.status === "ACTIVE" && can("policy.write") && (
                                <Button
                                  variant="secondary"
                                  onClick={() => open("suspend", p)}
                                >
                                  השעיית כיסוי
                                </Button>
                              )}
                              {p.status === "SUSPENDED" &&
                                can("policy.write") && (
                                  <Button onClick={() => open("reinstate", p)}>
                                    הפעלה מחדש
                                  </Button>
                                )}
                              {p.status === "ACTIVE" &&
                                can("policy.cancel") && (
                                  <Button
                                    variant="secondary"
                                    onClick={() => open("cancel", p)}
                                  >
                                    ביטול
                                  </Button>
                                )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!policies.length && <Empty />}
                </section>
              )}
              {tab === "כיסויים" && (
                <div className="product-grid">
                  {policies.map((p: any) => (
                    <section className="panel" key={p.id}>
                      <h2>פוליסה {p.number}</h2>
                      <Badge value={p.status} />
                      <dl className="financial">
                        <dt>תקרה שנתית</dt>
                        <dd>{money(p.annualLimitCents)}</dd>
                        <dt>אושר ולא שולם</dt>
                        <dd>{money(p.reservedCents)}</dd>
                        <dt>שולם</dt>
                        <dd>{money(p.paidCents)}</dd>
                        <dt>יתרה זמינה</dt>
                        <dd>
                          {money(
                            p.annualLimitCents - p.reservedCents - p.paidCents,
                          )}
                        </dd>
                      </dl>
                      <details>
                        <summary>כיסויים בגרסת הפוליסה</summary>
                        <table>
                          <tbody>
                            {p.snapshot.coverages.map((c: any) => (
                              <tr key={c.code}>
                                <td>{c.name}</td>
                                <td>{money(c.limitCents)}</td>
                                <td>
                                  {p.exclusions?.includes(c.code)
                                    ? "מוחרג בחיתום"
                                    : "כלול במוצר"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    </section>
                  ))}
                  {!policies.length && <Empty />}
                </div>
              )}
              {tab === "תביעות" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>תביעות רפואיות</h2>
                    {can("claim.write") &&
                      policies.some((p: any) =>
                        ["ACTIVE", "CANCELLED"].includes(p.status),
                      ) && (
                        <Button onClick={() => open("claim")}>
                          <Plus size={15} />
                          פתיחת תביעה
                        </Button>
                      )}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>מספר</th>
                        <th>אירוע ואבחנה</th>
                        <th>פוליסה</th>
                        <th>נתבע</th>
                        <th>מאושר</th>
                        <th>מצב</th>
                        <th>פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claims.map((c: any) => (
                        <tr key={c.id}>
                          <td>{c.number}</td>
                          <td>
                            {localDate(c.eventDate)}
                            <small className="subtext">{c.diagnosis}</small>
                          </td>
                          <td>{c.policyNumber}</td>
                          <td>
                            {money(
                              c.lines.reduce(
                                (s: number, l: any) => s + l.costCents,
                                0,
                              ),
                            )}
                          </td>
                          <td>{money(c.approvedCents)}</td>
                          <td>
                            <Badge value={c.status} />
                          </td>
                          <td>
                            <div className="actions">
                              {["SUBMITTED", "NEEDS_INFORMATION"].includes(
                                c.status,
                              ) && (
                                <>
                                  <Button
                                    variant="secondary"
                                    onClick={() => {
                                      open("assessment", c);
                                      api(`/claims/${c.id}/assessment`)
                                        .then(setAssessment)
                                        .catch((e) => setError(e.message));
                                    }}
                                  >
                                    בדיקת זכאות
                                  </Button>
                                  {can("claim.decide") && (
                                    <Button onClick={() => open("decide", c)}>
                                      החלטה
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!claims.length && <Empty />}
                </section>
              )}
              {tab === "תשלומים" && (
                <>
                  <section className="panel">
                    <h2>חיובים וגבייה מדומה</h2>
                    <table>
                      <thead>
                        <tr>
                          <th>פוליסה</th>
                          <th>חיוב</th>
                          <th>שולם</th>
                          <th>זוכה</th>
                          <th>חוב</th>
                          <th>פעולות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {policies.flatMap((p: any) =>
                          p.charges.map((c: any) => (
                            <tr key={c.id}>
                              <td>{p.number}</td>
                              <td>{money(c.amountCents)}</td>
                              <td>{money(c.paidCents)}</td>
                              <td>{money(c.creditedCents)}</td>
                              <td>
                                {money(
                                  Math.max(
                                    0,
                                    c.amountCents -
                                      c.paidCents -
                                      c.creditedCents,
                                  ),
                                )}
                              </td>
                              <td>
                                {can("collection.write") &&
                                  c.amountCents >
                                    c.paidCents + c.creditedCents && (
                                    <Button onClick={() => open("collect", c)}>
                                      גבייה מדומה
                                    </Button>
                                  )}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </section>
                  <section className="panel queue">
                    <h2>הוראות תשלום לתביעות</h2>
                    <table>
                      <thead>
                        <tr>
                          <th>תביעה</th>
                          <th>סכום</th>
                          <th>מצב</th>
                          <th>פעולות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {claims
                          .filter((c: any) => c.payment)
                          .map((c: any) => (
                            <tr key={c.id}>
                              <td>{c.number}</td>
                              <td>{money(c.payment.amountCents)}</td>
                              <td>
                                <Badge value={c.payment.status} />
                              </td>
                              <td>
                                {c.payment.status === "APPROVED" &&
                                  can("payment.execute") && (
                                    <Button
                                      onClick={() => open("pay", c.payment)}
                                    >
                                      ביצוע מדומה
                                    </Button>
                                  )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </section>
                </>
              )}
              {tab === "מסמכים" && (
                <section className="panel">
                  <h2>מסמכי תיק הלקוח</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>מספר</th>
                        <th>סוג מסמך</th>
                        <th>מועד</th>
                        <th>חתימה מדומה</th>
                        <th>פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.documents.map((d: any) => (
                        <tr key={d.id}>
                          <td>{d.number}</td>
                          <td>
                            <FileText size={15} /> {d.title}
                          </td>
                          <td>{localDate(d.createdAt)}</td>
                          <td>{d.signedAt ? "נרשמה" : "לא נחתם"}</td>
                          <td>
                            <div className="actions">
                              <Button
                                variant="secondary"
                                onClick={() => open("document", d)}
                              >
                                תצוגה
                              </Button>
                              <Button asChild variant="secondary">
                                <a
                                  href={`/api/v1/documents/${d.id}/pdf`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  PDF
                                </a>
                              </Button>
                              {!d.signedAt && can("document.sign") && (
                                <Button onClick={() => open("sign", d)}>
                                  חתימה מדומה
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!workspace.documents.length && <Empty />}
                </section>
              )}
              {tab === "פניות" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>פניות שירות</h2>
                    {can("case.write") && (
                      <Button onClick={() => open("case")}>
                        <Plus size={15} />
                        פתיחת פנייה
                      </Button>
                    )}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>מספר</th>
                        <th>נושא</th>
                        <th>דחיפות</th>
                        <th>מצב</th>
                        <th>פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.cases.map((c: any) => (
                        <tr key={c.id}>
                          <td>{c.number}</td>
                          <td>
                            {c.subject}
                            <small className="subtext">{c.description}</small>
                          </td>
                          <td>
                            <Badge value={c.priority} />
                          </td>
                          <td>
                            <Badge value={c.status} />
                          </td>
                          <td>
                            {can("case.write") && (
                              <Button
                                variant="secondary"
                                onClick={() => open("case-status", c)}
                              >
                                {c.status === "OPEN"
                                  ? "סגירת פנייה"
                                  : "פתיחה מחדש"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!workspace.cases.length && <Empty />}
                </section>
              )}
              {tab === "משימות" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>משימות המשך</h2>
                    {can("case.write") && (
                      <Button onClick={() => open("task")}>
                        <Plus size={15} />
                        משימה חדשה
                      </Button>
                    )}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>משימה</th>
                        <th>מועד יעד</th>
                        <th>מצב</th>
                        <th>פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.tasks.map((t: any) => (
                        <tr key={t.id}>
                          <td>{t.title}</td>
                          <td>{localDate(t.dueAt)}</td>
                          <td>
                            <Badge value={t.status} />
                          </td>
                          <td>
                            {t.status === "OPEN" && can("case.write") && (
                              <Button
                                variant="secondary"
                                onClick={() => open("task-complete", t)}
                              >
                                סימון הושלם
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!workspace.tasks.length && <Empty />}
                </section>
              )}
              {tab === "היסטוריה" && (
                <section className="panel">
                  <h2>יומן ביקורת</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>מועד</th>
                        <th>פעולה</th>
                        <th>נימוק</th>
                        <th>מבצע</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.audit.map((a: any) => (
                        <tr key={a.id}>
                          <td>{localDate(a.createdAt)}</td>
                          <td>{actionName(a.action)}</td>
                          <td>{a.reason || "—"}</td>
                          <td>{a.employeeName || "עובד מערכת"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!workspace.audit.length && <Empty />}
                </section>
              )}
            </>
          )}
        </div>
        <footer className="main-footer">
          ביטוחה · סביבת פיתוח · כללי ביטוח מדומים וטעונים אימות לפני שימוש
          אמיתי
        </footer>
      </main>
      {modal && (
        <div className="overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            className={"dialog " + (modal.kind === "document" ? "wide" : "")}
          >
            <header>
              <h2 id="dialog-title">{modalTitles[modal.kind]}</h2>
              <button
                aria-label="סגירת חלון"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </header>
            <form onSubmit={submit}>
              <div className="dialog-body">
                {error && (
                  <div className="error" role="alert">
                    {error}
                  </div>
                )}
                {["customer", "customer-edit"].includes(modal.kind) && (
                  <>
                    <Field label="שם לקוח">
                      <input
                        name="name"
                        defaultValue={
                          modal.kind === "customer-edit" ? workspace.name : ""
                        }
                        required
                        maxLength={150}
                      />
                    </Field>
                    <Field label="טלפון">
                      <input
                        name="phone"
                        defaultValue={
                          modal.kind === "customer-edit" ? workspace.phone : ""
                        }
                        required
                        maxLength={30}
                      />
                    </Field>
                    {modal.kind === "customer" && (
                      <Field label="דוא״ל">
                        <input name="email" type="email" />
                      </Field>
                    )}
                    <Field label="כתובת">
                      <input
                        name="address"
                        defaultValue={
                          modal.kind === "customer-edit"
                            ? workspace.address
                            : ""
                        }
                      />
                    </Field>
                    <Field label="הערות פנימיות">
                      <textarea
                        name="notes"
                        defaultValue={
                          modal.kind === "customer-edit" ? workspace.notes : ""
                        }
                      />
                    </Field>
                  </>
                )}
                {modal.kind === "pet" && (
                  <>
                    <div className="form-grid">
                      <Field label="שם בעל חיים">
                        <input name="name" required />
                      </Field>
                      <Field label="סוג">
                        <select name="species">
                          <option value="DOG">כלב</option>
                          <option value="CAT">חתול</option>
                        </select>
                      </Field>
                      <Field label="גזע">
                        <input name="breed" required />
                      </Field>
                      <Field label="מין">
                        <select name="sex">
                          <option value="MALE">זכר</option>
                          <option value="FEMALE">נקבה</option>
                        </select>
                      </Field>
                      <Field label="תאריך לידה">
                        <input
                          name="birthDate"
                          type="date"
                          max={isoToday()}
                          required
                        />
                      </Field>
                      <Field label="מספר שבב (15 ספרות)">
                        <input name="chip" pattern="[0-9]{15}" />
                      </Field>
                    </div>
                    <label className="checkbox">
                      <input name="vaccinated" type="checkbox" />
                      חיסונים מעודכנים
                    </label>
                    <label className="checkbox">
                      <input name="neutered" type="checkbox" />
                      מעוקר / מסורס
                    </label>
                    <Field label="היסטוריה רפואית והצהרה">
                      <textarea name="medicalHistory" />
                    </Field>
                  </>
                )}
                {modal.kind === "policy" && (
                  <>
                    <p className="hint">
                      יצירת הצעה מחשבת זכאות וחיתום לפי גרסת המוצר. הפעלה תבוצע
                      בנפרד לאחר אישור תנאים.
                    </p>
                    <Field label="בעל חיים">
                      <select name="petId">
                        {workspace.pets.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.species === "DOG" ? "כלב" : "חתול"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="מוצר וגרסה">
                      <select name="productId">
                        {products.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · גרסה {p.version} ·{" "}
                            {money(p.premiumCents)} לשנה
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="תחילת ביטוח">
                      <input
                        name="startDate"
                        type="date"
                        defaultValue={isoToday()}
                        min={isoToday()}
                        required
                      />
                    </Field>
                  </>
                )}
                {modal.kind === "activate" && (
                  <>
                    <p>
                      פוליסה {modal.data.number} · פרמיה שנתית{" "}
                      {money(modal.data.premiumCents)}
                    </p>
                    <p className="hint">
                      הפעלה יוצרת חיוב שנתי ומסמך פוליסה. גבייה מבוצעת בנפרד
                      בסימולטור.
                    </p>
                    <label className="checkbox">
                      <input name="accepted" type="checkbox" required />
                      קראתי ואישרתי את תנאי הצעת הסימולציה
                    </label>
                  </>
                )}
                {modal.kind === "underwrite" && (
                  <>
                    <p>{modal.data.underwritingReason}</p>
                    <Field label="החלטה">
                      <select name="decision">
                        <option value="APPROVE">אישור</option>
                        <option value="REJECT">דחייה</option>
                      </select>
                    </Field>
                    <Field label="נימוק החלטה">
                      <textarea name="reason" required />
                    </Field>
                    <Field label="כיסויים להחרגה (אופציונלי)">
                      <select name="excludedCategories" multiple>
                        {modal.data.snapshot.coverages.map((c: any) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                )}
                {modal.kind === "claim" && (
                  <>
                    <Field label="פוליסה">
                      <select name="policyId">
                        {policies
                          .filter((p: any) =>
                            [
                              "ACTIVE",
                              "CANCELLED",
                              "EXPIRED",
                              "SUSPENDED",
                            ].includes(p.status),
                          )
                          .map((p: any) => (
                            <option key={p.id} value={p.id}>
                              פוליסה {p.number} · {p.product.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <div className="form-grid">
                      <Field label="מועד אירוע">
                        <input
                          name="eventDate"
                          type="date"
                          defaultValue={isoToday()}
                          max={isoToday()}
                          required
                        />
                      </Field>
                      <Field label="מרפאה">
                        <input name="clinic" required />
                      </Field>
                    </div>
                    <Field label="אבחנה רפואית">
                      <textarea name="diagnosis" required />
                    </Field>
                    {Array.from({ length: lines }, (_, i) => (
                      <fieldset key={i}>
                        <legend>טיפול {i + 1}</legend>
                        <Field label="קטגוריית טיפול">
                          <select name={`category${i}`}>
                            {Array.from(
                              new Map<string, any>(
                                products
                                  .flatMap((p: any) => p.coverages)
                                  .map((c: any) => [c.code, c]),
                              ).values(),
                            ).map((c: any) => (
                              <option key={c.code} value={c.code}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="תיאור">
                          <input name={`description${i}`} required />
                        </Field>
                        <Field label="עלות בש״ח">
                          <input
                            name={`cost${i}`}
                            type="number"
                            min="0.01"
                            max="100000"
                            step="0.01"
                            required
                          />
                        </Field>
                      </fieldset>
                    ))}
                    {lines < 30 && (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => setLines(lines + 1)}
                      >
                        הוספת טיפול
                      </Button>
                    )}
                  </>
                )}
                {modal.kind === "assessment" && (
                  <>
                    {assessment ? (
                      <>
                        <p>
                          סכום מחושב:{" "}
                          <strong>{money(assessment.approvedCents)}</strong> ·{" "}
                          <Badge value={assessment.status} />
                        </p>
                        <table>
                          <thead>
                            <tr>
                              <th>נתבע</th>
                              <th>מאושר</th>
                              <th>נימוק</th>
                            </tr>
                          </thead>
                          <tbody>
                            {assessment.lines.map((l: any, i: number) => (
                              <tr key={i}>
                                <td>{money(l.costCents)}</td>
                                <td>{money(l.approvedCents)}</td>
                                <td>{l.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="hint">
                          בדיקה מקדימה בלבד. ההחלטה מחשבת מחדש ונועלת את היתרה.
                        </p>
                      </>
                    ) : (
                      <p>מחשב זכאות…</p>
                    )}
                  </>
                )}
                {modal.kind === "decide" && (
                  <>
                    <p>
                      תביעה {modal.data.number}. הסכום נקבע מחדש על ידי מנוע
                      הכיסוי בעת האישור.
                    </p>
                    <Field label="החלטה">
                      <select name="decision">
                        <option value="APPROVE">אישור לפי חישוב זכאות</option>
                        <option value="REJECT">דחייה מנומקת</option>
                        <option value="NEEDS_INFORMATION">בקשת השלמות</option>
                      </select>
                    </Field>
                    <Field label="נימוק / פרטי ההשלמה">
                      <textarea name="reason" required />
                    </Field>
                  </>
                )}
                {modal.kind === "pay" && (
                  <>
                    <p>
                      ביצוע הוראת תשלום על סך{" "}
                      <strong>{money(modal.data.amountCents)}</strong>.
                    </p>
                    <p className="hint">
                      פעולה מדומה בלבד. השריון יעבור לסכום ששולם והתביעה תעודכן.
                      לא תבוצע העברת כסף אמיתית.
                    </p>
                  </>
                )}
                {modal.kind === "collect" && (
                  <>
                    <p>
                      יתרת חוב:{" "}
                      {money(
                        modal.data.amountCents -
                          modal.data.paidCents -
                          modal.data.creditedCents,
                      )}
                    </p>
                    <Field label="סכום גבייה מדומה בש״ח">
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={
                          (modal.data.amountCents -
                            modal.data.paidCents -
                            modal.data.creditedCents) /
                          100
                        }
                        defaultValue={
                          (modal.data.amountCents -
                            modal.data.paidCents -
                            modal.data.creditedCents) /
                          100
                        }
                        required
                      />
                    </Field>
                  </>
                )}
                {modal.kind === "cancel" && (
                  <>
                    <Field label="מועד ביטול">
                      <input
                        name="at"
                        type="date"
                        defaultValue={isoToday()}
                        min={isoToday()}
                        required
                        onChange={() => setCancelPreview(null)}
                      />
                    </Field>
                    <Field label="סיבת ביטול">
                      <textarea name="reason" required />
                    </Field>
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={async (e) => {
                        const form = e.currentTarget.closest("form")!;
                        const f = new FormData(form);
                        try {
                          setCancelPreview(
                            await api(
                              `/policies/${modal.data.id}/cancellation-preview?at=${f.get("at")}`,
                            ),
                          );
                        } catch (err: any) {
                          setError(err.message);
                        }
                      }}
                    >
                      חישוב השפעה כספית
                    </Button>
                    {cancelPreview && (
                      <dl className="financial">
                        <dt>זיכוי</dt>
                        <dd>{money(cancelPreview.creditCents)}</dd>
                        <dt>החזר שממתין לביצוע</dt>
                        <dd>{money(cancelPreview.refundCents)}</dd>
                        <dt>יתרת חוב</dt>
                        <dd>{money(cancelPreview.debtCents)}</dd>
                      </dl>
                    )}
                    <p className="hint">
                      תביעות היסטוריות נשמרות. החזר יירשם כדרישה שטרם בוצעה.
                    </p>
                  </>
                )}
                {modal.kind === "case" && (
                  <>
                    <Field label="נושא">
                      <input name="subject" required />
                    </Field>
                    <Field label="תיאור פנייה">
                      <textarea name="description" required />
                    </Field>
                    <Field label="דחיפות">
                      <select name="priority">
                        <option value="NORMAL">רגילה</option>
                        <option value="HIGH">גבוהה</option>
                        <option value="URGENT">דחופה</option>
                      </select>
                    </Field>
                  </>
                )}
                {modal.kind === "case-status" && (
                  <Field label="סיכום טיפול / סיבת פתיחה מחדש">
                    <textarea name="reason" required />
                  </Field>
                )}
                {modal.kind === "task" && (
                  <>
                    <Field label="תיאור משימה">
                      <input name="title" required />
                    </Field>
                    <Field label="מועד יעד">
                      <input
                        name="dueAt"
                        type="date"
                        defaultValue={isoToday()}
                        required
                      />
                    </Field>
                  </>
                )}
                {modal.kind === "task-complete" && (
                  <p>
                    סימון המשימה ״{modal.data.title}״ כהושלמה ושמירת הפעולה
                    ביומן.
                  </p>
                )}
                {["suspend", "reinstate"].includes(modal.kind) && (
                  <>
                    <p className="hint">
                      השינוי חל מהיום. השעיה מונעת כיסוי לאירועים בתקופת ההשעיה;
                      החיוב השנתי נשאר לפי כלל הסימולציה.
                    </p>
                    <Field label="סיבה">
                      <textarea name="reason" required />
                    </Field>
                  </>
                )}
                {modal.kind === "product-version" && (
                  <>
                    <p className="hint">
                      נוצרת גרסה חדשה. תנאי פוליסות קיימות נשארים ללא שינוי.
                    </p>
                    <Field label="שם מוצר">
                      <input
                        name="name"
                        defaultValue={modal.data.name}
                        required
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="פרמיה שנתית בש״ח">
                        <input
                          name="premium"
                          type="number"
                          min="1"
                          step="0.01"
                          defaultValue={modal.data.premiumCents / 100}
                          required
                        />
                      </Field>
                      <Field label="תקרה שנתית בש״ח">
                        <input
                          name="limit"
                          type="number"
                          min="1"
                          step="0.01"
                          defaultValue={modal.data.annualLimitCents / 100}
                          required
                        />
                      </Field>
                      <Field label="השתתפות עצמית בש״ח">
                        <input
                          name="deductible"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={modal.data.deductibleCents / 100}
                          required
                        />
                      </Field>
                      <Field label="שיעור החזר באחוזים">
                        <input
                          name="reimbursement"
                          type="number"
                          min="0.01"
                          max="100"
                          step="0.01"
                          defaultValue={modal.data.reimbursementBps / 100}
                          required
                        />
                      </Field>
                      <Field label="אכשרה בימים">
                        <input
                          name="waitingDays"
                          type="number"
                          min="0"
                          max="365"
                          defaultValue={modal.data.waitingDays}
                          required
                        />
                      </Field>
                    </div>
                    <h3>כיסויים ותקרות משנה</h3>
                    {modal.data.coverages.map((c: any) => (
                      <div className="coverage-edit" key={c.code}>
                        <label className="checkbox">
                          <input
                            name={"include-" + c.code}
                            type="checkbox"
                            defaultChecked
                          />
                          {c.name}
                        </label>
                        <Field label="תקרת משנה בש״ח">
                          <input
                            name={"coverage-" + c.code}
                            type="number"
                            min="1"
                            step="0.01"
                            defaultValue={c.limitCents / 100}
                          />
                        </Field>
                      </div>
                    ))}
                  </>
                )}
                {modal.kind === "document" && (
                  <iframe
                    title={modal.data.title}
                    src={`/api/v1/documents/${modal.data.id}/preview`}
                  />
                )}
                {modal.kind === "sign" && (
                  <>
                    <p>חתימה על {modal.data.title}</p>
                    <label className="checkbox">
                      <input name="accepted" type="checkbox" required />
                      אני מאשר רישום חתימה מדומה. אין לה תוקף של חתימה מאומתת
                      משפטית.
                    </label>
                  </>
                )}
              </div>
              <footer>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  סגירה
                </Button>
                {!["assessment", "document"].includes(modal.kind) && (
                  <Button
                    disabled={
                      busy || (modal.kind === "cancel" && !cancelPreview)
                    }
                  >
                    {busy
                      ? "שומר…"
                      : ["pay", "activate", "cancel", "sign"].includes(
                            modal.kind,
                          )
                        ? "אישור וביצוע"
                        : "שמירה"}
                  </Button>
                )}
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
const modalTitles: Record<string, string> = {
  customer: "פתיחת לקוח",
  "customer-edit": "עדכון פרטי לקוח",
  pet: "הוספת בעל חיים",
  policy: "הצעת ביטוח חדשה",
  activate: "אישור והפעלת פוליסה",
  underwrite: "החלטת חיתום",
  claim: "פתיחת תביעה רפואית",
  assessment: "בדיקת זכאות וכיסויים",
  decide: "החלטה בתביעה",
  pay: "ביצוע תשלום מדומה",
  collect: "גבייה מדומה",
  cancel: "ביטול פוליסה",
  case: "פתיחת פנייה",
  "case-status": "עדכון מצב פנייה",
  document: "תצוגת מסמך",
  sign: "חתימה מדומה",
  task: "משימת המשך חדשה",
  "task-complete": "השלמת משימה",
  suspend: "השעיית כיסוי",
  reinstate: "הפעלה מחדש",
  "product-version": "גרסת מוצר חדשה",
};
function actionName(action: string) {
  return (
    (
      {
        "customer.create": "פתיחת לקוח",
        "customer.update": "עדכון פרטי לקוח",
        "pet.create": "הוספת בעל חיים",
        "policy.quote": "יצירת הצעת ביטוח",
        "policy.activate": "הפעלת פוליסה",
        "underwriting.decision": "החלטת חיתום",
        "claim.submit": "הגשת תביעה",
        "claim.decision": "החלטה בתביעה",
        "payment.execute_simulated": "ביצוע תשלום מדומה",
        "charge.collect_simulated": "גבייה מדומה",
        "policy.cancel": "ביטול פוליסה",
        "case.create": "פתיחת פנייה",
        "case.status": "עדכון פנייה",
        "document.sign_simulated": "חתימה מדומה",
        "task.create": "יצירת משימה",
        "task.complete": "השלמת משימה",
        "policy.suspend": "השעיית כיסוי",
        "policy.reinstate": "הפעלת כיסוי מחדש",
      } as Record<string, string>
    )[action] || "פעולה תפעולית"
  );
}
createRoot(document.getElementById("root")!).render(<App />);
