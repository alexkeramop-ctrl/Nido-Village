/* Λογότυπο Nido Village. Τα αρχεία είναι στο public/brand (διαφανές WebP). */

/** Πλήρες λογότυπο (εικονογράφηση + NIDO VILLAGE). */
export function Logo({ className = "", width = 220 }: { className?: string; width?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/logo.webp" alt="Nido Village" width={width} height={Math.round(width * 0.763)} className={className} draggable={false} />;
}

/** Σήμα (μόνο η εικονογράφηση), για κεφαλίδες. */
export function Mark({ className = "", height = 32 }: { className?: string; height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/mark.webp" alt="" aria-hidden width={Math.round(height * 2.23)} height={height} className={className} draggable={false} />;
}

/** Κάρτα λογότυπου για σκούρα φόντα (login, συνεταίροι). */
export function LogoCard({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mx-auto w-fit rounded-3xl bg-[#f8f7f2] px-6 pt-4 pb-3 shadow-lg">
      <Logo width={210} />
      {subtitle && <div className="text-center text-[11px] tracking-[0.25em] uppercase text-[#6b6a5f] mt-1">{subtitle}</div>}
    </div>
  );
}
