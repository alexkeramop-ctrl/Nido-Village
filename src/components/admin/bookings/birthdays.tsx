"use client";
import { Badge } from "@/components/ui";
import { Section } from "@/components/admin/common";
import { fmtDayShort, fmtIsoDate } from "@/components/admin/format";
import { birthdayText, type BirthdayRow } from "@/components/admin/bookings/meta";
import { formatPhone, telHref, whatsappHref } from "@/lib/phone";

function whenLabel(days: number): string {
  if (days === 0) return "σήμερα";
  if (days === 1) return "αύριο";
  return `σε ${days} ημέρες`;
}

/**
 * «Γενέθλια που πλησιάζουν»: παιδιά που έκαναν πάρτι εδώ, η επέτειος του πάρτι τους πλησιάζει και δεν έχουν κλείσει ξανά.
 * Στοιχεία επικοινωνίας φαίνονται ΜΟΝΟ όταν ο πελάτης έχει δώσει συγκατάθεση για ενημερώσεις·
 * οι υπόλοιπες γραμμές είναι γκρι, με ένδειξη «χωρίς συγκατάθεση» και χωρίς συνδέσμους.
 */
export function BirthdaysSection({ rows, venueName, days = 60, className = "" }: { rows: BirthdayRow[]; venueName: string; days?: number; className?: string }) {
  const withConsent = rows.filter((r) => r.consent).length;
  return (
    <Section
      flush
      className={className}
      title={
        <span>
          🎂 Γενέθλια που πλησιάζουν{" "}
          <span className="text-ink-3 font-normal num">
            · {rows.length}
            {rows.length > 0 && ` · ${withConsent} με συγκατάθεση`}
          </span>
        </span>
      }
    >
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-ink-3">
          Κανένα παιδί με επέτειο πάρτι τις επόμενες {days} ημέρες που να μην έχει ήδη κλείσει ξανά. Η λίστα γεμίζει από τα πάρτι που έχουν «Όνομα παιδιού».
        </div>
      ) : (
        <>
          <div className="px-4 py-2 text-xs text-ink-3 border-b border-line">
            Παιδιά που έκαναν πάρτι εδώ και η επέτειος πέφτει στις επόμενες {days} ημέρες, χωρίς νέα κράτηση για φέτος. Επικοινωνούμε μόνο με όσους έχουν δώσει συγκατάθεση για ενημερώσεις (Πελατολόγιο).
          </div>
          <ul className="divide-y divide-line" data-testid="birthday-list">
            {rows.map((r) => {
              const tel = r.consent ? telHref(r.phone) : null;
              const wa = r.consent ? whatsappHref(r.phone, birthdayText(r, venueName)) : null;
              return (
                <li
                  key={r.eventId}
                  data-testid="birthday-row"
                  data-consent={r.consent ? "yes" : "no"}
                  className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${r.consent ? "" : "opacity-55 grayscale"}`}
                >
                  <div className="sm:w-32 shrink-0 flex sm:block items-baseline gap-2">
                    <div className="font-semibold num">{fmtDayShort(r.anniversary)}</div>
                    <div className="text-xs text-ink-3 num">{whenLabel(r.daysUntil)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words">
                      {r.childName}
                      {r.turningAge != null && <span className="text-ink-2 font-normal num"> · γίνεται {r.turningAge}</span>}
                    </div>
                    <div className="text-xs text-ink-3 break-words">
                      {r.parentName ? `Γονιός: ${r.parentName}` : "Χωρίς όνομα γονιού"} · <span className="num">τελευταίο πάρτι {fmtIsoDate(r.lastPartyDate)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {!r.consent ? (
                      <Badge>χωρίς συγκατάθεση</Badge>
                    ) : (
                      <>
                        {tel && (
                          <a href={tel} className="btn-secondary btn-sm num" data-testid="birthday-tel" aria-label={`Κλήση ${r.parentName || r.childName}`}>
                            📞 {formatPhone(r.phone)}
                          </a>
                        )}
                        {wa && (
                          <a href={wa} target="_blank" rel="noreferrer" className="btn-primary btn-sm" data-testid="birthday-whatsapp" aria-label={`Μήνυμα WhatsApp για τα γενέθλια: ${r.childName}`}>
                            💬 WhatsApp
                          </a>
                        )}
                        {!tel && !wa && <Badge>χωρίς τηλέφωνο</Badge>}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Section>
  );
}
