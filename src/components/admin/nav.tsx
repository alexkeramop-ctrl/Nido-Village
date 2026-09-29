"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/admin", label: "Επισκόπηση" },
  { href: "/admin/menu", label: "Μενού" },
  { href: "/admin/modifiers", label: "Επιλογές" },
  { href: "/admin/tables", label: "Τραπέζια" },
  { href: "/admin/floor", label: "Χάρτης" },
  { href: "/admin/staff", label: "Προσωπικό", adminOnly: true },
  { href: "/admin/printers", label: "Εκτυπωτές" },
  { href: "/admin/qr", label: "QR & Παραλαβές" },
  { href: "/admin/events", label: "Εκδηλώσεις" },
  { href: "/admin/inventory", label: "Αποθήκη" },
  { href: "/admin/recipes", label: "Συνταγές" },
  { href: "/admin/reports", label: "Αναφορές" },
  { href: "/admin/partners", label: "Συνεταίροι", adminOnly: true },
  { href: "/admin/settings", label: "Ρυθμίσεις", adminOnly: true },
  { href: "/admin/audit", label: "Ιστορικό" },
];

export function AdminNav({ role }: { role: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));
  const links = LINKS.filter((l) => !l.adminOnly || role === "admin");
  return (
    <nav aria-label="Διαχείριση" className="print:hidden bg-surface-2 border-b lg:border-b-0 lg:border-r border-line lg:w-52 lg:shrink-0">
      <ul className="flex lg:flex-col gap-1 p-2 overflow-x-auto lg:overflow-visible lg:sticky lg:top-12">
        {links.map((l) => (
          <li key={l.href} className="shrink-0">
            <Link
              href={l.href}
              className={`block px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                isActive(l.href) ? "bg-brand-soft text-brand-2" : "text-ink-2 hover:bg-surface-3"
              }`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
