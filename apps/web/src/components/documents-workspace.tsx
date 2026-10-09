import React, { useEffect, useState } from "react";
import { api, localDate } from "../api";
import { Button } from "./ui/button";
const statuses: Record<string, string> = {
  PENDING: "בתור להפקה",
  PROCESSING: "בתהליך הפקה",
  READY: "PDF מוכן",
  FAILED: "ההפקה נכשלה",
};
export function DocumentsWorkspace({
  session,
  onCustomer,
}: {
  session: any;
  onCustomer: (id: string) => void;
}) {
  const [documents, setDocuments] = useState<any[]>([]),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<any>(null);
  const load = () =>
    api("/documents?q=" + encodeURIComponent(query) + "&status=" + status)
      .then(setDocuments)
      .catch((e) => setError(e.message));
  useEffect(() => {
    let active = true;
    const poll = () =>
      api("/documents?q=" + encodeURIComponent(query) + "&status=" + status)
        .then((d) => {
          if (active) setDocuments(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    const initial = setTimeout(poll, 200);
    const timer = setInterval(poll, 4000);
    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [query, status]);
  const canRetry = session.permissions.some(
    (p: string) => p === "*" || p === "document.generate",
  );
  return (
    <section>
      <header className="page-title">
        <div>
          <h1>מרכז מסמכים</h1>
          <p>הפקה ברקע · קובצי PDF קבועים · בדיקת שלמות SHA-256</p>
        </div>
        <Button variant="secondary" onClick={load}>
          עדכון הרשימה
        </Button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="document-filters">
        <label className="field">
          <span>חיפוש שם או מספר מסמך</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="field">
          <span>מצב הפקה</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">כל המצבים</option>
            {Object.entries(statuses).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>מסמך</th>
              <th>שם</th>
              <th>הפקה</th>
              <th>מצב PDF</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>{d.number}</td>
                <td>
                  {d.title}
                  {d.signedAt && (
                    <span className="subtext">חתימה מדומה רשומה</span>
                  )}
                </td>
                <td>{localDate(d.createdAt)}</td>
                <td>
                  <span className="badge">
                    {statuses[d.artifact?.status] || "טרם התבקשה הפקת PDF"}
                  </span>
                  {d.artifact?.pdfHash && (
                    <details>
                      <summary>בדיקת שלמות</summary>
                      <code className="integrity-hash">
                        {d.artifact.pdfHash}
                      </code>
                    </details>
                  )}
                </td>
                <td>
                  <div className="actions">
                    <Button variant="secondary" onClick={() => setSelected(d)}>
                      תצוגת מסמך
                    </Button>
                    <a
                      className="button secondary"
                      href={"/api/v1/documents/" + d.id + "/pdf"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF
                    </a>
                    <Button
                      variant="secondary"
                      onClick={() => onCustomer(d.customerId)}
                    >
                      תיק לקוח
                    </Button>
                    {canRetry && d.artifact?.status === "FAILED" && (
                      <Button
                        onClick={async () => {
                          try {
                            await api(
                              "/documents/" + d.id + "/retry-pdf",
                              "POST",
                              {},
                              crypto.randomUUID(),
                            );
                            await load();
                          } catch (e: any) {
                            setError(e.message);
                          }
                        }}
                      >
                        ניסיון הפקה חוזר
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!documents.length && (
          <p className="empty">אין מסמכים התואמים לסינון.</p>
        )}
        <p className="subtext">מוצגים עד 100 מסמכים אחרונים לפי ההרשאות.</p>
      </div>
      {selected && (
        <div className="overlay">
          <section
            className="dialog wide"
            role="dialog"
            aria-modal="true"
            aria-label="תצוגת מסמך"
          >
            <header>
              <h2>{selected.title}</h2>
              <Button variant="secondary" onClick={() => setSelected(null)}>
                סגירה
              </Button>
            </header>
            <div className="dialog-body">
              <iframe
                title="מסמך ביטוחה"
                src={"/api/v1/documents/" + selected.id + "/preview"}
              />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
