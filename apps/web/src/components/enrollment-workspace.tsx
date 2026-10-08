import React, { useEffect, useRef, useState } from "react";
import { api, money, localDate, statusText } from "../api";
import { Button } from "./ui/button";
import {
  enrollmentSteps,
  medicalDetails,
  Field,
  StepDefinition,
} from "../../../../packages/domain/src/enrollment";
const today = () => new Date().toISOString().slice(0, 10);
function SignaturePad({
  value,
  onChange,
}: {
  value: number[][][];
  onChange: (v: number[][][]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const points = useRef<number[][][]>([]);
  useEffect(() => {
    points.current = value || [];
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 800, 220);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#17283e";
    for (const stroke of points.current) {
      ctx.beginPath();
      stroke.forEach((p, i) =>
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]),
      );
      ctx.stroke();
    }
  }, [value]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(800, ((e.clientX - r.left) * 800) / r.width)),
      Math.max(0, Math.min(220, ((e.clientY - r.top) * 220) / r.height)),
    ];
  };
  return (
    <div className="signature-pad">
      <p>חתימה מדומה בלבד — ללא אימות משפטי</p>
      <canvas
        ref={ref}
        width={800}
        height={220}
        aria-label="משטח ציור חתימה מדומה"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          points.current = [...points.current, [point(e)]];
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const stroke = points.current[points.current.length - 1];
          if (stroke.length >= 2000) return;
          const p = point(e);
          const ctx = ref.current!.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(...(stroke[stroke.length - 1] as [number, number]));
          ctx.lineTo(...(p as [number, number]));
          ctx.stroke();
          stroke.push(p);
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(
            points.current.filter((s) => s.length >= 2).map((s) => [...s]),
          );
        }}
        onPointerCancel={() => {
          drawing.current = false;
          onChange(points.current.filter((s) => s.length >= 2));
        }}
      />
      <Button type="button" variant="secondary" onClick={() => onChange([])}>
        ניקוי חתימה
      </Button>
    </div>
  );
}
function Input({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: any;
  onChange: (v: any) => void;
}) {
  return (
    <label className="field">
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.type === "boolean" ? (
        <select
          aria-label={field.label + (field.required ? " *" : "")}
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) =>
            onChange(
              e.target.value === "" ? undefined : e.target.value === "true",
            )
          }
        >
          <option value="">בחירה</option>
          <option value="true">כן</option>
          <option value="false">לא</option>
        </select>
      ) : field.type === "select" ? (
        <select
          aria-label={field.label + (field.required ? " *" : "")}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">בחירה</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {(
                {
                  PHONE: "טלפון",
                  WEB: "אינטרנט",
                  AGENT: "סוכן",
                  CLINIC: "מרפאה",
                  NEW: "הצטרפות חדשה",
                  NORMAL: "רגילה",
                  HIGH: "גבוהה",
                  URGENT: "דחופה",
                  SIMULATED_ID: "מזהה בדוי",
                  SIMULATED_PASSPORT: "דרכון בדוי",
                  EMAIL: "דוא״ל",
                  HE: "עברית",
                  EN: "אנגלית",
                  AR: "ערבית",
                  DOG: "כלב",
                  CAT: "חתול",
                  MALE: "זכר",
                  FEMALE: "נקבה",
                  COMPANION: "חיית מחמד",
                  WORKING: "חיית עבודה",
                  VISIT: "ביקור",
                  SURGERY: "ניתוח",
                  HOSPITAL: "אשפוז",
                  TEST: "בדיקה",
                  MEDICATION: "תרופה",
                  ANNUAL: "שנתי",
                  MONTHLY: "חודשי",
                  SIMULATED_TRANSFER: "העברה מדומה",
                  SIMULATED_CARD: "כרטיס מדומה — ללא מספר כרטיס",
                  POLICYHOLDER: "בעל הפוליסה",
                  AUTHORIZED_REPRESENTATIVE: "נציג מורשה",
                } as Record<string, string>
              )[o] || o}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          aria-label={field.label + (field.required ? " *" : "")}
          value={value || ""}
          maxLength={4000}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          aria-label={field.label + (field.required ? " *" : "")}
          type={
            field.type === "date"
              ? "date"
              : field.type === "number"
                ? "number"
                : "text"
          }
          value={value ?? ""}
          maxLength={4000}
          onChange={(e) =>
            onChange(
              field.type === "number"
                ? e.target.value === ""
                  ? undefined
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
const clean = (def: StepDefinition, a: any) => {
  const allowed = [
    ...def.fields.map((f) => f.key),
    ...(def.questions?.map((q) => q.key) || []),
    ...(def.repeat ? ["records"] : []),
    ...(def.number === 16 ? ["strokes"] : []),
  ];
  return Object.fromEntries(
    allowed.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]),
  );
};
export function EnrollmentWorkspace({
  session,
  products,
  onCustomer,
}: {
  session: any;
  products: any[];
  onCustomer: (id: string) => void;
}) {
  const [list, setList] = useState<any[]>([]),
    [workflow, setWorkflow] = useState<any>(null),
    [number, setNumber] = useState(1),
    [answers, setAnswers] = useState<any>({}),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [customers, setCustomers] = useState<any[]>([]),
    [pets, setPets] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [panel, setPanel] = useState("form");
  const can = (p: string) =>
    session.permissions.some((x: string) => x === "*" || x === p);
  const def = (workflow?.definition || enrollmentSteps)[
    number - 1
  ] as StepDefinition;
  const latest = workflow?.steps.find((s: any) => s.number === number);
  const writable =
    can("policy.write") &&
    !["COMPLETED", "REJECTED"].includes(workflow?.status);
  const loadList = () => api("/applications").then(setList);
  useEffect(() => {
    loadList().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const warning = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, [dirty]);
  useEffect(() => {
    if (!search) return;
    let active = true;
    const timer = setTimeout(
      () =>
        api("/customers?q=" + encodeURIComponent(search))
          .then((c) => {
            if (active) setCustomers(c);
          })
          .catch((e) => setError(e.message)),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);
  const accept = (w: any, n = w.currentStep) => {
    setWorkflow(w);
    setNumber(n);
    const step = w.steps.find((s: any) => s.number === n);
    setAnswers(
      clean(
        (w.definition || enrollmentSteps)[n - 1],
        step?.answers || {
          ...(n === 7 ? { records: [] } : {}),
          ...(n === 8 || n === 10 ? { records: [] } : {}),
          ...(n === 4 ? { startDate: today() } : {}),
        },
      ),
    );
    setDirty(false);
  };
  const change = (k: string, v: any) => {
    setAnswers((a: any) => ({ ...a, [k]: v }));
    setDirty(true);
    setNotice("יש שינויים שטרם נשמרו");
  };
  async function save(complete = false) {
    if (!workflow || busy) return null;
    setBusy(true);
    setError("");
    try {
      const w = await api(
        `/applications/${workflow.id}/steps/${number}`,
        "POST",
        { version: workflow.version, answers: clean(def, answers), complete },
        crypto.randomUUID(),
      );
      accept(w, complete ? w.currentStep : number);
      setNotice(complete ? "השלב נבדק ונשמר" : "הטיוטה נשמרה בשרת");
      await loadList();
      return w;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function chooseStep(n: number) {
    if (busy) return;
    if (dirty) {
      const w = await save(false);
      if (!w) return;
      accept(w, n);
    } else accept(workflow, n);
    setPanel("form");
  }
  async function upload(file: File, kind: string) {
    if (file.size > 1048576) {
      setError("גודל הקובץ המרבי הוא 1MB");
      return;
    }
    if (dirty && !(await save(false))) return;
    setBusy(true);
    setError("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const fresh = await api("/applications/" + workflow.id);
      const w = await api(
        `/applications/${workflow.id}/attachments`,
        "POST",
        {
          version: fresh.version,
          filename: file.name,
          mediaType: file.type,
          kind,
          base64,
        },
        crypto.randomUUID(),
      );
      accept(w, number);
      setNotice("המסמך נשמר בתהליך");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!dirty || busy || !writable || number === 18) return;
    const timer = setTimeout(() => {
      void save(false);
    }, 1800);
    return () => clearTimeout(timer);
  }, [dirty, answers, number]);
  useEffect(() => {
    const customerId = workflow?.steps.find((s: any) => s.number === 2)?.answers
      ?.customerId;
    if (!customerId) {
      setPets([]);
      return;
    }
    api(`/customers/${customerId}/workspace`)
      .then((w) => setPets(w.pets || []))
      .catch((e) => setError(e.message));
  }, [workflow?.id, workflow?.application?.customerId]);
  const quote = workflow?.steps.find((s: any) => s.number === 11)?.answers
    ?.quote;
  const product = products.find(
    (p) =>
      p.id ===
      (answers.productId ||
        workflow?.steps.find((s: any) => s.number === 9)?.answers?.productId ||
        workflow?.steps.find((s: any) => s.number === 4)?.answers?.productId),
  );
  return (
    <section className="enrollment-workspace" dir="rtl">
      <header className="page-title">
        <div>
          <h1>מרכז הצטרפות וחיתום</h1>
          <p>תהליך מדורג · טיוטות שמורות · נתונים בדויים בלבד</p>
        </div>
        {can("policy.write") && (
          <Button
            disabled={busy || dirty}
            onClick={async () => {
              setBusy(true);
              try {
                const w = await api(
                  "/applications",
                  "POST",
                  {},
                  crypto.randomUUID(),
                );
                accept(w);
                await loadList();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            הצטרפות חדשה לביטוח
          </Button>
        )}
      </header>
      {error && (
        <div role="alert" className="alert error">
          {error}
          <Button
            variant="secondary"
            onClick={async () => {
              if (!workflow) return;
              if (
                dirty &&
                !window.confirm("רענון יחליף את השינויים שלא נשמרו. להמשיך?")
              )
                return;
              accept(await api("/applications/" + workflow.id), number);
              setError("");
            }}
          >
            רענון התהליך
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!workflow ? (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>בקשה</th>
                <th>מצב</th>
                <th>שלב</th>
                <th>עדכון אחרון</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id}>
                  <td>{w.application.number}</td>
                  <td>{statusText[w.status] || w.status}</td>
                  <td>{w.currentStep} / 18</td>
                  <td>{localDate(w.updatedAt)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          accept(await api("/applications/" + w.id));
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      פתיחת בקשה
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <p>אין בקשות הצטרפות</p>}
        </div>
      ) : (
        <>
          <div className="workflow-toolbar">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                if (dirty && !(await save(false))) return;
                setWorkflow(null);
                loadList();
              }}
            >
              חזרה לתור הבקשות
            </Button>
            <strong>בקשה {workflow.application.number}</strong>
            <span>{statusText[workflow.status] || workflow.status}</span>
            <span>גרסה {workflow.version}</span>
            <progress
              value={workflow.steps.filter((s: any) => s.completed).length}
              max={18}
            />
            <span>
              {workflow.steps.filter((s: any) => s.completed).length} / 18
              הושלמו
            </span>
          </div>
          <div className="workflow-layout">
            <aside className="workflow-steps" aria-label="שלבי הצטרפות">
              {enrollmentSteps.map((s) => (
                <button
                  key={s.number}
                  aria-current={number === s.number ? "step" : undefined}
                  className={number === s.number ? "selected" : ""}
                  disabled={
                    busy ||
                    (s.number > workflow.currentStep &&
                      workflow.status !== "COMPLETED")
                  }
                  onClick={() => chooseStep(s.number)}
                >
                  <span>
                    {workflow.steps.find((x: any) => x.number === s.number)
                      ?.completed
                      ? "✓"
                      : s.number}
                  </span>
                  {s.title}
                </button>
              ))}
            </aside>
            <div className="workflow-body">
              <nav className="tabs">
                <button onClick={() => setPanel("form")}>טופס ותהליך</button>
                <button onClick={() => setPanel("documents")}>
                  מסמכים ({workflow.attachments.length})
                </button>
                <button
                  onClick={async () => {
                    setPanel("history");
                    try {
                      setHistory(
                        await api(`/applications/${workflow.id}/history`),
                      );
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  גרסאות והיסטוריה
                </button>
              </nav>
              {panel === "history" ? (
                <table>
                  <thead>
                    <tr>
                      <th>שלב</th>
                      <th>גרסה</th>
                      <th>הושלם</th>
                      <th>מועד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s) => (
                      <tr key={s.id}>
                        <td>{enrollmentSteps[s.number - 1].title}</td>
                        <td>{s.revision}</td>
                        <td>{s.completed ? "כן" : "לא"}</td>
                        <td>{localDate(s.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : panel === "documents" ? (
                <div>
                  <h2>קבצים מצורפים</h2>
                  <p>
                    PDF, PNG או JPEG עד 1MB לקובץ. יש להעלות מידע בדוי בלבד.
                  </p>
                  {writable &&
                    ["MEDICAL", "CHIP", "VACCINATION", "CONSENT"].map(
                      (kind) => (
                        <label className="field" key={kind}>
                          <span>
                            {
                              {
                                MEDICAL: "מסמך רפואי",
                                CHIP: "מסמך שבב",
                                VACCINATION: "פנקס חיסונים",
                                CONSENT: "הסכמה",
                              }[kind]
                            }
                          </span>
                          <input
                            type="file"
                            accept="application/pdf,image/png,image/jpeg"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) upload(file, kind);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      ),
                    )}
                  <table>
                    <thead>
                      <tr>
                        <th>קובץ</th>
                        <th>סוג</th>
                        <th>מצב</th>
                        <th>מזהה למסמך רפואי</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workflow.attachments.map((a: any) => (
                        <tr key={a.id}>
                          <td>
                            <a href={"/api/v1/application-attachments/" + a.id}>
                              {a.filename}
                            </a>
                          </td>
                          <td>{a.kind}</td>
                          <td>
                            {(
                              {
                                RECEIVED: "התקבל",
                                APPROVED: "אושר",
                                REJECTED: "נדחה",
                              } as Record<string, string>
                            )[a.status] || a.status}
                          </td>
                          <td>
                            <code>{a.id}</code>
                            {can("underwriting.decide") &&
                              workflow.status !== "COMPLETED" &&
                              workflow.status !== "REJECTED" && (
                                <AttachmentReview
                                  workflow={workflow}
                                  attachment={a}
                                  onDone={(w) => accept(w, number)}
                                  onError={setError}
                                />
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <h2>
                    {number}. {def.title}
                  </h2>
                  <p className="muted">
                    {latest?.completed
                      ? "השלב הושלם. שינוי ושמירה יבטלו את השלמת השלבים הבאים ואת האישורים התלויים בהם."
                      : "יש להשלים את שדות החובה כדי להתקדם."}
                  </p>
                  {number === 2 && writable && (
                    <div className="customer-lookup">
                      <label>
                        חיפוש לקוח קיים לפני רישום
                        <input
                          placeholder="שם, טלפון או דוא״ל"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      {customers.slice(0, 8).map((c) => (
                        <Button
                          key={c.id}
                          variant="secondary"
                          onClick={async () => {
                            const profile = c.profile || {};
                            const parts = c.name.split(" ");
                            setAnswers({
                              ...profile,
                              customerId: c.id,
                              firstName: profile.firstName || parts[0],
                              lastName:
                                profile.lastName || parts.slice(1).join(" "),
                              identifier: c.identifier || "",
                              phone: c.phone,
                              email: c.email || "",
                              address: c.address || "",
                            });
                            setDirty(true);
                            const w = await api(`/customers/${c.id}/workspace`);
                            setPets(w.pets || []);
                          }}
                        >
                          בחירת {c.name} · {c.number}
                        </Button>
                      ))}
                    </div>
                  )}
                  {number === 3 && pets.length > 0 && (
                    <label className="field">
                      <span>בחירת חיה קיימת</span>
                      <select
                        value={answers.petId || ""}
                        onChange={(e) => {
                          const p = pets.find((p) => p.id === e.target.value);
                          if (p) {
                            setAnswers({
                              ...p.profile,
                              ...p,
                              birthDate: p.birthDate.slice(0, 10),
                              petId: p.id,
                            });
                            setDirty(true);
                          }
                        }}
                      >
                        <option value="">חיה חדשה</option>
                        {pets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <fieldset disabled={!writable || busy || number === 18}>
                    <div className="workflow-fields">
                      {def.fields.map((field) =>
                        field.key === "productId" ? (
                          <label className="field" key={field.key}>
                            <span>{field.label} *</span>
                            <select
                              aria-label={field.label + " *"}
                              value={answers.productId || ""}
                              onChange={(e) =>
                                change("productId", e.target.value)
                              }
                            >
                              <option value="">בחירת מוצר</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} · גרסה {p.version}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <Input
                            key={field.key}
                            field={field}
                            value={answers[field.key]}
                            onChange={(v) => change(field.key, v)}
                          />
                        ),
                      )}
                    </div>
                    {def.questions?.map((q) => (
                      <details
                        key={q.key}
                        open={answers[q.key]?.value === true}
                      >
                        <summary>{q.label}</summary>
                        <Input
                          field={{
                            key: q.key,
                            label: "האם קיים מצב רפואי בתחום זה?",
                            type: "boolean",
                            required: true,
                          }}
                          value={answers[q.key]?.value}
                          onChange={(v) =>
                            change(q.key, { ...answers[q.key], value: v })
                          }
                        />
                        {answers[q.key]?.value === true && (
                          <div className="workflow-fields">
                            {medicalDetails.map((field) =>
                              field.key === "attachmentId" ? (
                                <label className="field" key={field.key}>
                                  <span>מסמך רפואי *</span>
                                  <select
                                    value={answers[q.key]?.attachmentId || ""}
                                    onChange={(e) =>
                                      change(q.key, {
                                        ...answers[q.key],
                                        attachmentId: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">
                                      יש לצרף מסמך בטאב מסמכים
                                    </option>
                                    {workflow.attachments
                                      .filter((a: any) => a.kind === "MEDICAL")
                                      .map((a: any) => (
                                        <option key={a.id} value={a.id}>
                                          {a.filename}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                              ) : (
                                <Input
                                  key={field.key}
                                  field={field}
                                  value={answers[q.key]?.[field.key]}
                                  onChange={(v) =>
                                    change(q.key, {
                                      ...answers[q.key],
                                      [field.key]: v,
                                    })
                                  }
                                />
                              ),
                            )}
                          </div>
                        )}
                      </details>
                    ))}
                    {number === 10 && (
                      <div className="panel">
                        <h3>הרחבות זמינות לפי גרסת המוצר</h3>
                        {product?.riders?.length ? (
                          product.riders.map((r: any) => (
                            <label className="field" key={r.id}>
                              <span>
                                <input
                                  type="checkbox"
                                  checked={(answers.records || []).some(
                                    (x: any) => x.riderId === r.id,
                                  )}
                                  onChange={(e) =>
                                    change(
                                      "records",
                                      e.target.checked
                                        ? [
                                            ...(answers.records || []),
                                            { riderId: r.id },
                                          ]
                                        : (answers.records || []).filter(
                                            (x: any) => x.riderId !== r.id,
                                          ),
                                    )
                                  }
                                />
                                {r.name} · {money(r.premiumCents)} לשנה
                                {r.limitIncreaseCents
                                  ? " · תוספת תקרה " +
                                    money(r.limitIncreaseCents)
                                  : ""}
                              </span>
                            </label>
                          ))
                        ) : (
                          <p>אין הרחבות מוגדרות למוצר זה.</p>
                        )}
                      </div>
                    )}
                    {def.repeat && number !== 10 && (
                      <div>
                        {(answers.records || []).map((r: any, i: number) => (
                          <section className="repeat-record" key={i}>
                            <h3>רשומה {i + 1}</h3>
                            <div className="workflow-fields">
                              {def.repeat!.map((field) => (
                                <Input
                                  key={field.key}
                                  field={field}
                                  value={r[field.key]}
                                  onChange={(v) =>
                                    change(
                                      "records",
                                      answers.records.map(
                                        (x: any, j: number) =>
                                          j === i
                                            ? { ...x, [field.key]: v }
                                            : x,
                                      ),
                                    )
                                  }
                                />
                              ))}
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                change(
                                  "records",
                                  answers.records.filter(
                                    (_: any, j: number) => j !== i,
                                  ),
                                )
                              }
                            >
                              הסרת רשומה
                            </Button>
                          </section>
                        ))}
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            change("records", [...(answers.records || []), {}])
                          }
                        >
                          הוספת רשומה
                        </Button>
                      </div>
                    )}
                    {number === 16 && (
                      <SignaturePad
                        value={answers.strokes || []}
                        onChange={(v) => change("strokes", v)}
                      />
                    )}
                  </fieldset>
                  {[4, 9, 11, 13, 17].includes(number) && (
                    <div className="panel">
                      <h3>תנאי מסלולים — סימולציה</h3>
                      <table>
                        <thead>
                          <tr>
                            <th>מסלול</th>
                            <th>שנתי</th>
                            <th>חודשי להמחשה</th>
                            <th>תקרה</th>
                            <th>השתתפות</th>
                            <th>החזר</th>
                            <th>אכשרה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(quote && number > 10
                            ? [quote.product]
                            : products
                          ).map((p) => (
                            <tr
                              key={p.id}
                              className={product?.id === p.id ? "selected" : ""}
                            >
                              <td>
                                {p.name} v{p.version}
                              </td>
                              <td>{money(p.premiumCents)}</td>
                              <td>{money(Math.round(p.premiumCents / 12))}</td>
                              <td>{money(p.annualLimitCents)}</td>
                              <td>{money(p.deductibleCents)}</td>
                              <td>{p.reimbursementBps / 100}%</td>
                              <td>{p.waitingDays} ימים</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(quote?.product || product)?.coverages?.map((c: any) => (
                        <p key={c.code}>
                          {c.name} · תקרת משנה {money(c.limitCents)}
                        </p>
                      ))}
                      {quote && (
                        <p>
                          כללי תמחור סימולציה v{quote.pricingVersion}: פרמיית
                          בסיס {money(quote.baseCents)}; הרחבות{" "}
                          {money(
                            quote.adjustments.reduce(
                              (s: number, r: any) => s + r.amountCents,
                              0,
                            ),
                          )}
                          . תוקף עד {localDate(quote.validUntil)}.
                        </p>
                      )}
                    </div>
                  )}
                  {number === 12 && (
                    <div className="panel">
                      <h3>תוצאות חיתום</h3>
                      <p>
                        {latest?.answers?.evaluation?.reason ||
                          "השרת יבדוק הצהרות, היסטוריה, חיסונים ושבב בעת השלמת השלב."}
                      </p>
                      {workflow.status === "WAITING_APPROVAL" && (
                        <>
                          <p>
                            הבקשה ממתינה לחתם. יוזם הבקשה אינו רשאי לאשר אותה.
                          </p>
                          {can("underwriting.decide") && (
                            <UnderwritingDecision
                              workflow={workflow}
                              onDone={accept}
                              onError={setError}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {number === 15 && latest?.answers?.schedule && (
                    <table>
                      <thead>
                        <tr>
                          <th>חיוב</th>
                          <th>מועד</th>
                          <th>סכום</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latest.answers.schedule.map((s: any) => (
                          <tr key={s.position}>
                            <td>{s.position}</td>
                            <td>{localDate(s.dueAt)}</td>
                            <td>{money(s.amountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {number === 17 && (
                    <div className="panel">
                      <h3>סיכום לפני הפקה</h3>
                      {workflow.steps
                        .filter((s: any) => s.number < 17)
                        .map((s: any) => (
                          <p key={s.id}>
                            {enrollmentSteps[s.number - 1].title}:{" "}
                            {s.completed ? "הושלם" : "חסר"}
                          </p>
                        ))}
                      <p>
                        הפעלה תיצור פוליסה, חיובים ומסמכים באותה עסקה. גבייה
                        ותשלום בפועל אינם מבוצעים.
                      </p>
                    </div>
                  )}
                  {number === 18 && (
                    <div className="panel">
                      {workflow.status === "COMPLETED" ? (
                        <>
                          <h3>הפוליסה הופקה</h3>
                          <p>מזהה פוליסה: {workflow.application.policyId}</p>
                          <Button
                            onClick={() =>
                              onCustomer(workflow.application.customerId)
                            }
                          >
                            פתיחת תיק הלקוח
                          </Button>
                          {latest?.answers?.documents?.map((id: string) => (
                            <p key={id}>
                              <a
                                href={"/api/v1/documents/" + id + "/preview"}
                                target="_blank"
                                rel="noreferrer"
                              >
                                תצוגת מסמך
                              </a>{" "}
                              ·{" "}
                              <a href={"/api/v1/documents/" + id + "/pdf"}>
                                PDF
                              </a>
                            </p>
                          ))}
                        </>
                      ) : (
                        <>
                          <p>
                            כל השלבים הושלמו. השרת יבצע שוב בדיקות זכאות, חפיפה
                            ותוקף הצעה.
                          </p>
                          {writable && (
                            <Button
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const result = await api(
                                    `/applications/${workflow.id}/issue`,
                                    "POST",
                                    { version: workflow.version },
                                    crypto.randomUUID(),
                                  );
                                  accept(result.workflow);
                                  loadList();
                                  setNotice("הפוליסה והמסמכים נשמרו");
                                } catch (e: any) {
                                  setError(e.message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              הפקת פוליסה ומסמכים
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {writable && number < 18 && (
                    <footer className="workflow-footer">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => save(false)}
                      >
                        שמירת טיוטה
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          (workflow.status === "WAITING_APPROVAL" &&
                            number === 12)
                        }
                        onClick={() => save(true)}
                      >
                        בדיקה, שמירה והמשך
                      </Button>
                      <span>
                        {busy
                          ? "שומר…"
                          : dirty
                            ? "שינויים לא שמורים"
                            : "נשמר בשרת"}
                      </span>
                    </footer>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
function AttachmentReview({
  workflow,
  attachment,
  onDone,
  onError,
}: {
  workflow: any;
  attachment: any;
  onDone: (w: any) => void;
  onError: (e: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [status, setStatus] = useState("APPROVED"),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onDone(
            await api(
              `/applications/${workflow.id}/attachments/${attachment.id}/review`,
              "POST",
              { version: workflow.version, status, reason },
              crypto.randomUUID(),
            ),
          );
        } catch (e: any) {
          onError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        תוצאת בדיקת מסמך
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="APPROVED">אישור</option>
          <option value="REJECTED">דחייה</option>
        </select>
      </label>
      <label>
        נימוק
        <input
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <Button disabled={busy}>שמירת בדיקת מסמך</Button>
    </form>
  );
}
function UnderwritingDecision({
  workflow,
  onDone,
  onError,
}: {
  workflow: any;
  onDone: (w: any) => void;
  onError: (e: string) => void;
}) {
  const [decision, setDecision] = useState("APPROVE"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [excluded, setExcluded] = useState<string[]>([]);
  const product = workflow.steps.find((s: any) => s.number === 11)?.answers
    .quote.product;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onDone(
            await api(
              `/applications/${workflow.id}/underwrite`,
              "POST",
              {
                version: workflow.version,
                decision,
                reason,
                excludedCategories: excluded,
              },
              crypto.randomUUID(),
            ),
          );
        } catch (e: any) {
          onError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>החלטה</span>
        <select value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="APPROVE">אישור</option>
          <option value="REJECT">דחייה</option>
          <option value="MORE_INFORMATION">מידע נוסף</option>
        </select>
      </label>
      <label className="field">
        <span>נימוק חובה</span>
        <textarea
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {product.coverages.map((c: any) => (
        <label key={c.code}>
          <input
            type="checkbox"
            checked={excluded.includes(c.code)}
            onChange={(e) =>
              setExcluded(
                e.target.checked
                  ? [...excluded, c.code]
                  : excluded.filter((x) => x !== c.code),
              )
            }
          />
          החרגת {c.name}
        </label>
      ))}
      <Button disabled={busy}>שמירת החלטת חיתום</Button>
    </form>
  );
}
