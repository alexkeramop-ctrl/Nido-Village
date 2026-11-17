/** Στοιχεία επικοινωνίας του καταστήματος στις δημόσιες σελίδες (παραγγελία QR, κατάσταση παραγγελίας). */
export type VenueContact = { venueName: string; address: string; phone: string; email: string };

export function ContactFooter({ contact, className = "" }: { contact: VenueContact; className?: string }) {
  const phone = contact.phone.trim();
  const email = contact.email.trim();
  const address = contact.address.trim();
  if (!phone && !email && !address) return null;
  const tel = phone.replace(/[^\d+]/g, "");
  return (
    <footer className={`text-center text-xs text-ink-3 space-y-1 ${className}`} aria-label="Επικοινωνία">
      <div className="font-semibold text-ink-2">{contact.venueName}</div>
      {address && <div>{address}</div>}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {phone && (
          <a href={`tel:${tel}`} className="underline underline-offset-2 num">
            Τηλ. {phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="underline underline-offset-2 break-all">
            {email}
          </a>
        )}
      </div>
    </footer>
  );
}
