/* Λογότυπο Nido Village (καμάρα). Τα αρχεία παράγονται από scripts/brand/make-logos.py στο public/brand. */

/** Πλήρες λογότυπο (εικονογράφηση + NIDO VILLAGE). */
export function Logo({ className = "", width = 220 }: { className?: string; width?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/logo.webp" alt="Nido Village" width={width} height={Math.round((width * 861) / 939)} className={className} draggable={false} />;
}

/** Σήμα (μόνο η καμάρα), για κεφαλίδες. */
export function Mark({ className = "", height = 32, tone = "color" }: { className?: string; height?: number; tone?: "light" | "color" }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={tone === "light" ? "/brand/mark-light.webp" : "/brand/mark.webp"} alt="" aria-hidden width={Math.round((height * 360) / 387)} height={height} className={className} draggable={false} />;
}

/** Κάρτα λογότυπου για σκούρα φόντα (login, συνεταίροι). */
export function LogoCard({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mx-auto w-fit rounded-3xl bg-[#f3f1ec] px-6 pt-4 pb-3 shadow-2xl">
      <Logo width={210} />
      {subtitle && <div className="text-center text-[11px] tracking-[0.25em] uppercase text-[#5d6253] mt-1">{subtitle}</div>}
    </div>
  );
}
