"use client";
import { useState } from "react";
import { Badge, EmptyState, Field, Modal } from "@/components/ui";
import { FormModal, InfoBox, PageHeader, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { fmtDateTime } from "@/components/admin/format";
import { cancelPrintJobAction, checkStationHealthAction, printTestPageAction, retryPrintJobAction, saveStationAction } from "./actions";

type Station = {
  id: number;
  name: string;
  kind: string;
  kindLabel: string;
  driver: string;
  host: string | null;
  port: number;
  codepage: string;
  columns: number;
  cutter: boolean;
  drawerKick: boolean;
  enabled: boolean;
  sort: number;
  lastOkAt: string | null;
  lastError: string | null;
};
type Job = {
  id: number;
  stationName: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  printedAt: string | null;
  renderedText: string | null;
};
type StationModal = { mode: "new" } | { mode: "edit"; station: Station } | null;

const JOB_KIND: Record<string, string> = {
  kitchen_ticket: "Δελτίο κουζίνας",
  void_ticket: "Ακύρωση",
  bill: "Λογαριασμός",
  receipt: "Απόδειξη",
  test: "Δοκιμή",
  report: "Αναφορά",
};
const JOB_STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "brand" }> = {
  queued: { label: "Σε αναμονή", tone: "warn" },
  printing: { label: "Εκτυπώνεται", tone: "brand" },
  done: { label: "Ολοκληρώθηκε", tone: "ok" },
  failed: { label: "Απέτυχε", tone: "danger" },
};

export function PrintersManager({ stations, jobs, kinds }: { stations: Station[]; jobs: Job[]; kinds: { value: string; label: string }[] }) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const [modal, setModal] = useState<StationModal>(null);
  const [driver, setDriver] = useState<string>("console");
  const [preview, setPreview] = useState<Job | null>(null);

  const openModal = (m: StationModal) => {
    setDriver(m?.mode === "edit" ? m.station.driver : "console");
    setModal(m);
  };

  const submit = (fd: FormData) => {
    const v = formValues(fd);
    const id = modal?.mode === "edit" ? modal.station.id : undefined;
    run(
      () =>
        saveStationAction({
          id,
          name: v.str("name"),
          kind: v.str("kind"),
          driver: v.str("driver"),
          host: v.str("host"),
          port: v.int("port", 9100),
          codepage: v.str("codepage"),
          columns: v.int("columns", 42),
          cutter: v.bool("cutter"),
          drawerKick: v.bool("drawerKick"),
          enabled: v.bool("enabled"),
          sort: v.int("sort"),
        }),
      { success: id ? "Ο σταθμός ενημερώθηκε" : "Ο σταθμός δημιουργήθηκε", onSuccess: () => setModal(null) },
    );
  };

  const editing = modal?.mode === "edit" ? modal.station : null;

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader
        title="Εκτυπωτές"
        subtitle="Σταθμοί εκτύπωσης (κουζίνα, μπαρ, ταμείο) και ουρά εκτύπωσης."
        actions={
          <button className="btn-primary btn-sm" onClick={() => openModal({ mode: "new" })}>
            + Νέος σταθμός
          </button>
        }
      />

      <InfoBox>
        <strong>Driver «console»</strong>: το δελτίο γράφεται στο log του server (για δοκιμές/ανάπτυξη). <strong>Driver «tcp»</strong>: στέλνει ESC/POS στον
        εκτυπωτή δικτύου στη διεύθυνση IP:9100. Οι ελληνικοί χαρακτήρες απαιτούν κωδικοσελίδα που υποστηρίζει ο εκτυπωτής (συνήθως cp737 ή cp1253).
      </InfoBox>

      <Section title="Σταθμοί" flush>
        {stations.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Όνομα</th>
                <th>Τύπος</th>
                <th>Driver</th>
                <th>Διεύθυνση</th>
                <th>Κωδικοσελίδα</th>
                <th>Στήλες</th>
                <th>Κόπτης</th>
                <th>Συρτάρι</th>
                <th>Κατάσταση</th>
                <th>Τελευταία επιτυχία</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => (
                <tr key={s.id} className={s.enabled ? "" : "opacity-60"}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-ink-2">{s.kindLabel}</td>
                  <td className="num">{s.driver}</td>
                  <td className="num text-ink-2">{s.driver === "tcp" ? `${s.host ?? "—"}:${s.port}` : "—"}</td>
                  <td className="num text-ink-2">{s.codepage}</td>
                  <td className="num text-ink-2">{s.columns}</td>
                  <td>{s.cutter ? "Ναι" : "Όχι"}</td>
                  <td>{s.drawerKick ? "Ναι" : "Όχι"}</td>
                  <td>
                    <div className="flex flex-col gap-1">
                      {!s.enabled ? <Badge>Ανενεργός</Badge> : s.lastError ? <Badge tone="danger">Σφάλμα</Badge> : <Badge tone="ok">OK</Badge>}
                      {s.lastError && <span className="text-xs text-danger max-w-48 truncate" title={s.lastError}>{s.lastError}</span>}
                    </div>
                  </td>
                  <td className="num text-ink-3">{fmtDateTime(s.lastOkAt)}</td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      className="btn-ghost btn-sm"
                      disabled={pending}
                      onClick={() => run(() => printTestPageAction(s.id), { success: `Δοκιμαστική εκτύπωση στάλθηκε στο «${s.name}»` })}
                    >
                      Δοκιμαστική εκτύπωση
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      disabled={pending}
                      onClick={() =>
                        run(() => checkStationHealthAction(s.id), {
                          onSuccess: (ok) => toast(ok ? `«${s.name}»: ο εκτυπωτής απαντά` : `«${s.name}»: ο εκτυπωτής δεν απαντά`, ok ? "ok" : "danger"),
                        })
                      }
                    >
                      Έλεγχος
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => openModal({ mode: "edit", station: s })}>
                      Επεξεργασία
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4">
            <EmptyState title="Δεν υπάρχουν σταθμοί εκτύπωσης" hint="Χρειάζεται τουλάχιστον ένας σταθμός τύπου «Ταμείο / Απόδειξη» για λογαριασμούς." />
          </div>
        )}
      </Section>

      <Section title="Ουρά εκτύπωσης" flush>
        {jobs.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>#</th>
                <th>Σταθμός</th>
                <th>Είδος</th>
                <th>Κατάσταση</th>
                <th>Προσπ.</th>
                <th>Σφάλμα</th>
                <th>Δημιουργία</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const st = JOB_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
                return (
                  <tr key={j.id}>
                    <td className="num text-ink-3">{j.id}</td>
                    <td className="font-medium">{j.stationName}</td>
                    <td className="text-ink-2">{JOB_KIND[j.kind] ?? j.kind}</td>
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="num text-ink-2">{j.attempts}</td>
                    <td className="text-xs text-danger max-w-56 truncate" title={j.lastError ?? undefined}>
                      {j.lastError ?? <span className="text-ink-3">—</span>}
                    </td>
                    <td className="num text-ink-3">{fmtDateTime(j.createdAt)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost btn-sm" onClick={() => setPreview(j)} disabled={!j.renderedText}>
                        Προεπισκόπηση
                      </button>
                      {j.status === "failed" && (
                        <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => retryPrintJobAction(j.id), { success: `Η εργασία #${j.id} μπήκε ξανά στην ουρά` })}>
                          Επανάληψη
                        </button>
                      )}
                      {j.status === "queued" && (
                        <button className="btn-ghost btn-sm text-danger" disabled={pending} onClick={() => run(() => cancelPrintJobAction(j.id), { success: `Η εργασία #${j.id} ακυρώθηκε` })}>
                          Ακύρωση
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4 text-sm text-ink-3">Η ουρά είναι άδεια.</div>
        )}
      </Section>

      <FormModal open={modal !== null} onClose={() => setModal(null)} title={editing ? "Επεξεργασία σταθμού" : "Νέος σταθμός εκτύπωσης"} onSubmit={submit} pending={pending} wide>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Όνομα">
            <input name="name" className="input" required defaultValue={editing?.name ?? ""} autoFocus />
          </Field>
          <Field label="Τύπος">
            <select name="kind" className="input" defaultValue={editing?.kind ?? "kitchen"}>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Driver">
            <select name="driver" className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="console">console (log server)</option>
              <option value="tcp">tcp (εκτυπωτής δικτύου)</option>
            </select>
          </Field>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Field label="Διεύθυνση IP">
              <input name="host" className="input num" defaultValue={editing?.host ?? ""} placeholder="192.168.1.50" disabled={driver !== "tcp"} required={driver === "tcp"} />
            </Field>
            <Field label="Θύρα">
              <input name="port" type="number" className="input num" defaultValue={editing?.port ?? 9100} min={1} max={65535} />
            </Field>
          </div>
          <Field label="Κωδικοσελίδα">
            <select name="codepage" className="input" defaultValue={editing?.codepage ?? "cp737"}>
              <option value="cp737">cp737 (Ελληνικά, συνηθέστερο)</option>
              <option value="cp1253">cp1253 (Windows Greek)</option>
              <option value="iso8859-7">iso8859-7</option>
            </select>
          </Field>
          <Field label="Στήλες" hint="42 για χαρτί 58mm, 48 για 80mm">
            <select name="columns" className="input" defaultValue={editing?.columns ?? 42}>
              <option value={42}>42</option>
              <option value={48}>48</option>
            </select>
          </Field>
          <Field label="Σειρά">
            <input name="sort" type="number" className="input num" defaultValue={editing?.sort ?? stations.length + 1} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Toggle name="cutter" defaultChecked={editing?.cutter ?? true} label="Κόπτης χαρτιού" />
          <Toggle name="drawerKick" defaultChecked={editing?.drawerKick ?? false} label="Άνοιγμα συρταριού" />
          <Toggle name="enabled" defaultChecked={editing?.enabled ?? true} label="Ενεργός" />
        </div>
      </FormModal>

      <Modal open={preview !== null} onClose={() => setPreview(null)} title={preview ? `Προεπισκόπηση #${preview.id} · ${preview.stationName}` : ""}>
        <pre className="font-mono text-xs leading-5 bg-surface-3 rounded-xl p-4 overflow-x-auto whitespace-pre">{preview?.renderedText ?? ""}</pre>
      </Modal>
    </div>
  );
}
