import React, { useEffect, useState, useRef } from "react";
import { Button } from "./ui/button";
import { SignaturePad } from "./enrollment-workspace";
import { api, localDate } from "../api";
const labels: Record<string, string> = {
  AGREEMENT: "הסכם ותנאי פוליסה",
  HEALTH: "הצהרת בריאות",
  PAYMENT: "לוח תשלומים",
  OPENED: "הלקוח פתח את התהליך",
  DOCUMENT_VIEWED: "הלקוח צופה במסמך",
  SIGNING_STARTED: "הלקוח התחיל לחתום",
  HELP_REQUEST: "הלקוח מבקש עזרה",
  COMPLETED: "החתימה הושלמה",
  MESSAGE: "הודעה",
  PENDING: "ממתין לחתימה",
  SIGNED: "נחתם",
  REVOKED: "הקישור בוטל",
};
export function SigningPortal({ token }: { token: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [doc, setDoc] = useState(""),
    [html, setHtml] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [accepted, setAccepted] = useState(false),
    [name, setName] = useState(""),
    [strokes, setStrokes] = useState<number[][][]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const consentRecorded = useRef(false);
  const request = async (path: string, body?: any) => {
    const response = await fetch("/api/v1/signing/" + path, {
      method: body ? "POST" : "GET",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-Signing-Token": token,
        "Idempotency-Key": key.current,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const d = await response.json();
      throw new Error(d.message || "הפעולה נכשלה");
    }
    return response;
  };
  useEffect(() => {
    let active = true;
    const poll = () =>
      request("view")
        .then((r) => r.json())
        .then((d) => {
          if (active) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token]);
  const event = async (kind: string, extra: any = {}) => {
    try {
      await request("event", { kind, trackingAccepted: true, ...extra });
    } catch (e: any) {
      setError(e.message);
    }
  };
  async function openDocument(kind: string) {
    setBusy(true);
    try {
      const r = await request("document?kind=" + kind);
      setHtml(await r.text());
      setDoc(kind);
      await event("DOCUMENT_VIEWED", { document: kind });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const signed = data?.status === "SIGNED";
  return (
    <main className="signing-portal" dir="rtl">
      <header className="portal-header">
        <strong>ביטוחה</strong>
        <span>מסמכים וחתימה · אזור לקוח</span>
      </header>
      <section className="portal-card">
        <h1>{signed ? "המסמכים נחתמו בהצלחה" : "סקירת מסמכים וחתימה"}</h1>
        <p>סימולציה מקצועית בלבד, ללא חתימה בעלת תוקף משפטי נטען.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {data && (
          <>
            <div className="portal-context">
              בקשה {data.snapshot.applicationNumber} ·{" "}
              {data.snapshot.customer.firstName}{" "}
              {data.snapshot.customer.lastName} · {data.snapshot.pet.name}
            </div>
            {signed ? (
              <p role="status">
                החתימה התקבלה בתאריך {localDate(data.signedAt)}. הנציג יכול
                להמשיך להפקת הפוליסה.
              </p>
            ) : (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={async (e) => {
                      setConsent(e.target.checked);
                      if (e.target.checked && !consentRecorded.current) {
                        consentRecorded.current = true;
                        await event("OPENED");
                      }
                    }}
                  />
                  אני מסכים/ה שהנציג יראה איזה מסמך פתוח, אם התחלתי לחתום ואת
                  ההודעות שאשלח. הנציג לא רואה את המסך או הקלדות שלא נשלחו.
                </label>
                {consent && (
                  <>
                    <div className="document-selector">
                      {["AGREEMENT", "HEALTH", "PAYMENT"].map((kind) => (
                        <Button
                          variant={doc === kind ? "default" : "secondary"}
                          disabled={busy}
                          key={kind}
                          onClick={() => openDocument(kind)}
                        >
                          {labels[kind]}
                        </Button>
                      ))}
                    </div>
                    {html && (
                      <>
                        <iframe title={labels[doc]} srcDoc={html} sandbox="" />
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const r = await request(
                                "document?kind=" + doc + "&format=pdf",
                              );
                              const url = URL.createObjectURL(await r.blob());
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = "bitucha-" + doc + ".pdf";
                              a.click();
                              setTimeout(() => URL.revokeObjectURL(url), 10000);
                            } catch (e: any) {
                              setError(e.message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          הורדת PDF למסמך פתוח
                        </Button>
                      </>
                    )}
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      פתחתי וקראתי את שלושת המסמכים והפרטים נכונים.
                    </label>
                    <label className="field">
                      <span>שם החותם כפי שמופיע בבקשה</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <SignaturePad
                      value={strokes}
                      onChange={(v) => {
                        if (!strokes.length && v.length)
                          void event("SIGNING_STARTED");
                        setStrokes(v);
                      }}
                    />
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                      />
                      אני מאשר/ת את ההצהרות, התנאים והתשלומים וחותם/ת בחתימה
                      מדומה.
                    </label>
                    <Button
                      disabled={
                        busy || !accepted || !reviewed || !strokes.length
                      }
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await request("sign", {
                            signerName: name,
                            accepted,
                            strokes,
                            reviewedDocuments: reviewed,
                            trackingAccepted: consent,
                            contentHash: data.contentHash,
                          });
                          setData(await (await request("view")).json());
                        } catch (e: any) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      חתימה ואישור מסמכים
                    </Button>
                    <section className="signing-chat">
                      <h2>עזרה מהנציג</h2>
                      {data.events
                        .filter(
                          (e: any) =>
                            e.kind === "MESSAGE" || e.kind === "HELP_REQUEST",
                        )
                        .map((e: any) => (
                          <p
                            className={"chat-message " + e.actorType}
                            key={e.id}
                          >
                            <strong>
                              {e.actorType === "AGENT" ? "הנציג" : "את/ה"}:{" "}
                            </strong>
                            {e.payload.message}
                          </p>
                        ))}
                      <label className="field">
                        <span>הודעה לנציג</span>
                        <textarea
                          value={message}
                          maxLength={1000}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                      </label>
                      <Button
                        variant="secondary"
                        disabled={!message.trim()}
                        onClick={async () => {
                          await event("HELP_REQUEST", { message });
                          setMessage("");
                        }}
                      >
                        שליחת בקשת עזרה
                      </Button>
                    </section>
                  </>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
export function SigningMonitor({
  workflow,
  onSigned,
  canCreate,
  canAssist,
}: {
  workflow: any;
  canCreate: boolean;
  canAssist: boolean;
  onSigned: () => void;
}) {
  const [requests, setRequests] = useState<any[]>([]),
    [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const seen = useRef("");
  useEffect(() => {
    let active = true;
    const poll = () =>
      api(`/applications/${workflow.id}/signing-requests`)
        .then((r) => {
          if (!active) return;
          setRequests(r);
          const signed = r.find((x: any) => x.status === "SIGNED");
          if (signed && seen.current !== signed.id) {
            seen.current = signed.id;
            if (!workflow.steps.find((s: any) => s.number === 16)?.completed)
              onSigned();
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void poll();
    const timer = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workflow.id, workflow.version]);
  const current = requests[0];
  return (
    <section className="signing-monitor">
      <h3>חתימה מרחוק וליווי הלקוח</h3>
      <p>
        קישור אישי בתוקף 48 שעות. המעקב מציג מסמך פתוח, תחילת חתימה והודעות לאחר
        הסכמת הלקוח; העדכון מתקבל בתוך כ־3 שניות.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={
          !canCreate ||
          busy ||
          workflow.steps.find((s: any) => s.number === 16)?.completed
        }
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api(
              `/applications/${workflow.id}/signing-requests`,
              "POST",
              { version: workflow.version },
              crypto.randomUUID(),
            );
            if (r.token) setUrl(window.location.origin + "/#/sign/" + r.token);
            setRequests(
              await api(`/applications/${workflow.id}/signing-requests`),
            );
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        יצירת קישור חתימה ללקוח
      </Button>
      {url && (
        <label className="field">
          <span>קישור אישי לשליחה ללקוח — לשמור במקום פרטי</span>
          <input
            dir="ltr"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="secondary"
            onClick={() =>
              navigator.clipboard
                .writeText(url)
                .catch(() => setError("אפשר לסמן ולהעתיק את הקישור ידנית"))
            }
          >
            העתקת קישור
          </Button>
        </label>
      )}
      {current && (
        <>
          <p className="badge">
            {labels[current.status]} · תוקף עד {localDate(current.expiresAt)}
          </p>
          <div className="signing-events" aria-live="polite">
            {current.events.map((e: any) => (
              <div key={e.id}>
                <time>{new Date(e.createdAt).toLocaleTimeString("he-IL")}</time>{" "}
                · {labels[e.kind]}{" "}
                {e.payload.document ? labels[e.payload.document] : ""}
                {e.payload.message && (
                  <p>
                    {e.actorType === "AGENT" ? "נציג: " : "לקוח: "}
                    {e.payload.message}
                  </p>
                )}
              </div>
            ))}
          </div>
          {current.status === "PENDING" && (
            <>
              <label className="field">
                <span>הודעת עזרה ללקוח</span>
                <textarea
                  value={message}
                  maxLength={1000}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <div className="actions">
                <Button
                  disabled={!canAssist || !message.trim() || busy}
                  onClick={async () => {
                    try {
                      await api(
                        `/signing-requests/${current.id}/messages`,
                        "POST",
                        { message },
                        crypto.randomUUID(),
                      );
                      setMessage("");
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  שליחת הודעה ללקוח
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canCreate}
                  onClick={async () => {
                    try {
                      await api(
                        `/signing-requests/${current.id}/revoke`,
                        "POST",
                        {},
                        crypto.randomUUID(),
                      );
                      setUrl("");
                      setRequests(
                        await api(
                          `/applications/${workflow.id}/signing-requests`,
                        ),
                      );
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  ביטול קישור
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
