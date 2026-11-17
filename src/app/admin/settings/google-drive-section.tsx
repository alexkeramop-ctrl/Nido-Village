"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { InfoBox, Section, useActionRunner } from "@/components/admin/common";
import { fmtDateTime } from "@/components/admin/format";
import { disconnectDriveAction, testDriveUploadAction } from "./drive-actions";

export type DriveSectionProps = {
  status: { configured: boolean; connected: boolean; needsReconnect: boolean; email: string | null; connectedAt: string | null };
  /** Το ακριβές redirect URI που πρέπει να δηλωθεί στο Google Cloud: <origin>/api/google/callback. */
  redirectUri: string;
  /** Μήνυμα μετά την επιστροφή από τη Google. */
  flash: { ok: boolean; text: string } | null;
  ai: { configured: boolean; model: string };
};

type Result = { ok: true; text: string; url?: string; name?: string } | { ok: false; text: string };

export function GoogleDriveSection({ status, redirectUri, flash, ai }: DriveSectionProps) {
  const { run, pending, toastElement } = useActionRunner();
  const [result, setResult] = useState<Result | null>(flash ? { ok: flash.ok, text: flash.text } : null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const active = status.configured && status.connected && !status.needsReconnect;

  // Το ?drive=… της επιστροφής από τη Google φεύγει από τη διεύθυνση, ώστε μια ανανέωση να μη δείξει ξανά το ίδιο μήνυμα.
  useEffect(() => {
    if (flash && window.location.search.includes("drive=")) window.history.replaceState(null, "", `${window.location.pathname}#google-drive`);
  }, [flash]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ο χρήστης το αντιγράφει με το χέρι */
    }
  };

  const test = () => {
    setResult(null);
    run(() => testDriveUploadAction(), {
      onSuccess: (f) => setResult({ ok: true, text: "Το δοκιμαστικό αρχείο ανέβηκε στον φάκελο «Nido Τιμολόγια».", url: f.url, name: f.name }),
      onError: (error) => setResult({ ok: false, text: error }),
    });
  };

  const disconnect = () => {
    setResult(null);
    run(() => disconnectDriveAction(), {
      onSuccess: () => {
        setConfirmOff(false);
        setResult({ ok: true, text: "Το Google Drive αποσυνδέθηκε. Τα αρχεία που έχουν ήδη ανέβει μένουν στο Drive." });
      },
      onError: (error) => setResult({ ok: false, text: error }),
    });
  };

  const badge = !status.configured ? (
    <Badge tone="warn">Λείπουν τα κλειδιά</Badge>
  ) : !status.connected ? (
    <Badge>Δεν έχει συνδεθεί</Badge>
  ) : status.needsReconnect ? (
    <Badge tone="danger">Χρειάζεται επανασύνδεση</Badge>
  ) : (
    <Badge tone="ok">Συνδεδεμένο</Badge>
  );

  return (
    <Section title="Google Drive" className="lg:col-span-2">
      {toastElement}
      <div id="google-drive" className="space-y-3 text-sm scroll-mt-24" data-testid="drive-section">
        <div className="flex flex-wrap items-center gap-2" data-testid="drive-status">
          {badge}
          <span className="text-ink-2 min-w-0 break-all">
            {!status.configured
              ? "Δεν έχουν οριστεί τα GOOGLE_CLIENT_ID και GOOGLE_CLIENT_SECRET στον server."
              : !status.connected
                ? "Τα κλειδιά υπάρχουν. Πάτησε «Σύνδεση» και διάλεξε τον λογαριασμό Google όπου θα αποθηκεύονται τα τιμολόγια."
                : `Συνδεδεμένο ως ${status.email ?? "λογαριασμός Google"}${status.connectedAt ? ` · από ${fmtDateTime(status.connectedAt)}` : ""}`}
          </span>
        </div>

        <p className="text-ink-2">
          Τα παραστατικά που επισυνάπτεις στα <strong>Έσοδα – Έξοδα</strong> ανεβαίνουν στο Drive σου, στον φάκελο{" "}
          <span className="font-medium text-ink">Nido Τιμολόγια / έτος / μήνας</span>. Η εφαρμογή ζητά μόνο το δικαίωμα <code>drive.file</code>: βλέπει και αλλάζει{" "}
          <strong>μόνο τα αρχεία που ανέβασε η ίδια</strong>, τίποτα άλλο από το Drive σου.
        </p>

        {status.connected && status.needsReconnect && status.configured && (
          <InfoBox tone="danger">
            Η Google απέρριψε την αποθηκευμένη σύνδεση (έληξε ή ανακλήθηκε). Πάτησε «Σύνδεση ξανά». Αν συμβαίνει κάθε 7 ημέρες, η εφαρμογή στο Google Cloud είναι σε κατάσταση
            «Testing»: άνοιξε Google Auth Platform → Audience και πάτησε «Publish app».
          </InfoBox>
        )}
        {status.connected && !status.configured && (
          <InfoBox tone="warn">Υπάρχει αποθηκευμένη σύνδεση, αλλά λείπουν τα κλειδιά του server — μέχρι να οριστούν ξανά, τα αρχεία δεν ανεβαίνουν.</InfoBox>
        )}

        {result && (
          <div data-testid="drive-result">
            <InfoBox tone={result.ok ? "ok" : "danger"}>
              {result.text}
              {result.ok && result.url && (
                <>
                  {" "}
                  <a href={result.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 font-medium break-all">
                    Άνοιγμα: {result.name}
                  </a>
                </>
              )}
            </InfoBox>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {status.configured && !active && (
            // Κανονικός σύνδεσμος (όχι <Link>): η σελίδα φεύγει ολόκληρη προς τη Google.
            <a href="/api/google/connect" className="btn-primary btn-sm" data-testid="drive-connect">
              {status.connected ? "Σύνδεση ξανά" : "Σύνδεση"}
            </a>
          )}
          {status.configured && status.connected && (
            <button type="button" className={`${active ? "btn-primary" : "btn-secondary"} btn-sm`} onClick={test} disabled={pending} data-testid="drive-test">
              {pending ? "Περίμενε…" : "Δοκιμαστικό ανέβασμα"}
            </button>
          )}
          {status.connected &&
            (confirmOff ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-ink-2">Να αποσυνδεθεί; Τα αρχεία μένουν στο Drive.</span>
                <button type="button" className="btn-danger btn-sm" onClick={disconnect} disabled={pending} data-testid="drive-disconnect-confirm">
                  Ναι, αποσύνδεση
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmOff(false)} disabled={pending}>
                  Άκυρο
                </button>
              </span>
            ) : (
              <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setConfirmOff(true)} disabled={pending} data-testid="drive-disconnect">
                Αποσύνδεση
              </button>
            ))}
        </div>

        <details className="rounded-xl bg-surface-3 px-4 py-3" open={!status.configured} data-testid="drive-steps">
          <summary className="cursor-pointer font-medium">{status.configured ? "Οδηγίες ρύθμισης στο Google Cloud" : "Τι χρειάζεται: 6 βήματα στο Google Cloud (μία φορά)"}</summary>
          <ol className="list-decimal pl-5 mt-2 space-y-1.5 text-ink-2">
            <li>
              Άνοιξε το <span className="num">console.cloud.google.com</span> με τον λογαριασμό Google που θα κρατά τα τιμολόγια και φτιάξε ένα έργο (π.χ. «Nido PDA»).
            </li>
            <li>
              <strong>APIs &amp; Services → Library</strong> → γράψε «Google Drive API» → <strong>Enable</strong>.
            </li>
            <li>
              <strong>Google Auth Platform</strong> (παλιά «OAuth consent screen») → Get started: όνομα εφαρμογής, το email σου, τύπος <strong>External</strong>. Στο{" "}
              <strong>Audience</strong> πάτησε <strong>Publish app</strong> (αλλιώς, σε «Testing», η σύνδεση λήγει κάθε 7 ημέρες και πρέπει να είσαι στους «Test users»).
            </li>
            <li>
              <strong>Clients → Create client</strong> (ή Credentials → Create credentials → OAuth client ID) → Application type: <strong>Web application</strong>. Στο{" "}
              <strong>Authorized redirect URIs</strong> βάλε ακριβώς:
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="num rounded-lg bg-white px-2 py-1 text-ink break-all" data-testid="drive-redirect-uri">
                  {redirectUri}
                </code>
                <button type="button" className="btn-secondary btn-sm" onClick={copy}>
                  {copied ? "✓ Αντιγράφηκε" : "Αντιγραφή"}
                </button>
              </div>
            </li>
            <li>
              Αντέγραψε το <strong>Client ID</strong> και το <strong>Client secret</strong> και όρισέ τα στον server ως <code>GOOGLE_CLIENT_ID</code> και <code>GOOGLE_CLIENT_SECRET</code>:
              στο Cloudflare από Workers &amp; Pages → nido-pda-app → Settings → Variables and Secrets (τύπος <strong>Secret</strong>) ή με{" "}
              <code>npx wrangler secret put GOOGLE_CLIENT_ID</code> και <code>npx wrangler secret put GOOGLE_CLIENT_SECRET</code>· σε δικό σου server, στις μεταβλητές περιβάλλοντος και
              επανεκκίνηση.
            </li>
            <li>
              Γύρνα σε αυτή τη σελίδα, πάτησε <strong>Σύνδεση</strong>, διάλεξε τον λογαριασμό και δώσε την άδεια. Μετά πάτησε <strong>Δοκιμαστικό ανέβασμα</strong> για έλεγχο.
            </li>
          </ol>
          <p className="mt-2 text-xs text-ink-3">
            Το κλειδί της σύνδεσης (refresh token) αποθηκεύεται κρυπτογραφημένο με το <code>NIDO_SECRET</code>. Αν αλλάξει το <code>NIDO_SECRET</code>, θα χρειαστεί νέα «Σύνδεση».
          </p>
        </details>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3" data-testid="ai-status">
          <Badge tone={ai.configured ? "ok" : "neutral"}>{ai.configured ? "Ανάγνωση τιμολογίων: ενεργή" : "Ανάγνωση τιμολογίων: ανενεργή"}</Badge>
          <span className="text-ink-2 min-w-0">
            {ai.configured ? (
              <>
                Στη φόρμα τιμολογίου εμφανίζεται το «Ανάγνωση τιμολογίου» (μοντέλο <span className="num">{ai.model}</span>). Στέλνεται μόνο το αρχείο· τα στοιχεία απλώς προσυμπληρώνουν τη
                φόρμα.
              </>
            ) : (
              <>
                Προαιρετικό: όρισε το Secret <code>ANTHROPIC_API_KEY</code> στον server για να προσυμπληρώνεται η φόρμα από τη φωτογραφία ή το PDF του τιμολογίου.
              </>
            )}
          </span>
        </div>
      </div>
    </Section>
  );
}
