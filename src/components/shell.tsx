import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/server/auth";
import { logoutAction } from "@/app/login/actions";
import { Mark } from "@/components/brand";

const NAV: { href: string; label: string; roles: string[] }[] = [
  // Self-service: η οθόνη σερβιτόρου (/pda) υπάρχει ακόμη αλλά δεν εμφανίζεται πια στο μενού.
  { href: "/cashier", label: "Ταμείο", roles: ["cashier", "manager", "admin"] },
  { href: "/kds", label: "Κουζίνα & Μπαρ", roles: ["manager", "admin"] },
  { href: "/admin", label: "Διαχείριση", roles: ["manager", "admin"] },
];

export function Shell({ user, children, active, dark = false, title, logoutInHeader = true }: { user: SessionUser; children: ReactNode; active: string; dark?: boolean; title?: string; logoutInHeader?: boolean }) {
  const links = NAV.filter((n) => n.roles.includes(user.role));
  return (
    <div className={`min-h-full flex-1 flex flex-col ${dark ? "bg-dark text-white" : ""}`}>
      <header className="sticky top-0 z-40 border-b border-line bg-white/60 backdrop-blur-xl print:hidden">
        <div className="flex items-center gap-2 px-3 h-12">
          <Link href="/" className="mr-2 flex items-center" aria-label="Αρχική">
            <Mark height={30} />
          </Link>
          {title && <span className={`font-semibold whitespace-nowrap ${dark ? "text-slate-200" : "text-ink"}`}>{title}</span>}
          <nav aria-label="Κύριο μενού" className="flex gap-1 ml-auto overflow-x-auto min-w-0">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${
                  active === l.href ? (dark ? "bg-dark-3 text-white" : "bg-brand-soft text-brand-2") : dark ? "text-slate-300 hover:bg-dark-3" : "text-ink-2 hover:bg-surface-3"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          {logoutInHeader ? (
            <form action={logoutAction} className="ml-1">
              <button className={`text-sm px-2 py-1.5 rounded-lg ${dark ? "text-slate-300 hover:bg-dark-3" : "text-ink-2 hover:bg-surface-3"}`} title="Αποσύνδεση">
                {user.name} ↪
              </button>
            </form>
          ) : (
            <span className="ml-1 hidden sm:inline text-sm px-2 text-ink-3 whitespace-nowrap">{user.name}</span>
          )}
        </div>
      </header>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
}
