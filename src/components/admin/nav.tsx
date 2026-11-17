"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/app/login/actions";

type Item = { href: string; label: string; icon: string; adminOnly?: boolean };
const GROUPS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ href: "/admin", label: "Επισκόπηση", icon: "🏠" }] },
  {
    title: "Κρατήσεις",
    items: [
      { href: "/admin/parties", label: "Παιδικά πάρτι", icon: "🎂" },
      { href: "/admin/ceremonies", label: "Γάμοι & Βαπτίσεις", icon: "💍" },
      { href: "/admin/events", label: "Όλες οι εκδηλώσεις", icon: "📅" },
    ],
  },
  {
    title: "Οικονομικά",
    items: [
      { href: "/admin/finance", label: "Έσοδα – Έξοδα", icon: "💶", adminOnly: true },
      { href: "/admin/registers", label: "Ταμεία ημέρας", icon: "🧾" },
      { href: "/admin/reports", label: "Αναφορές πωλήσεων", icon: "📊" },
    ],
  },
  {
    title: "Κατάλογος & αποθήκη",
    items: [
      { href: "/admin/menu", label: "Μενού", icon: "🍔" },
      { href: "/admin/modifiers", label: "Επιλογές ειδών", icon: "➕" },
      { href: "/admin/inventory", label: "Αποθήκη", icon: "📦" },
    ],
  },
  {
    title: "Χώρος",
    items: [
      { href: "/admin/floor", label: "Κάτοψη", icon: "🗺️" },
      { href: "/admin/tables", label: "Τραπέζια", icon: "🪑" },
      { href: "/admin/qr", label: "QR & Παραλαβές", icon: "📱" },
    ],
  },
  {
    title: "Σύστημα",
    items: [
      { href: "/admin/staff", label: "Προσωπικό", icon: "👥", adminOnly: true },
      { href: "/admin/printers", label: "Εκτυπωτές", icon: "🖨️" },
      { href: "/admin/partners", label: "Συνεταίροι", icon: "🤝", adminOnly: true },
      { href: "/admin/settings", label: "Ρυθμίσεις", icon: "⚙️", adminOnly: true },
      { href: "/admin/audit", label: "Ιστορικό", icon: "🕘" },
    ],
  },
];

const KEY = "nido.nav.collapsed";

export function AdminNav({ role, userName }: { role: string; userName: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ανάγνωση προτίμησης από τη συσκευή μετά το πρώτο render
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch {
      /* χωρίς αποθήκευση */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* χωρίς αποθήκευση */
      }
      return !c;
    });
  };
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((l) => !l.adminOnly || role === "admin") })).filter((g) => g.items.length);
  const link = (l: Item, compact: boolean) => (
    <Link
      href={l.href}
      title={l.label}
      aria-current={isActive(l.href) ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
        isActive(l.href) ? "bg-brand text-white shadow-sm" : "text-ink-2 hover:bg-white/70"
      } ${compact ? "justify-center px-0" : ""}`}
    >
      <span aria-hidden className="text-base leading-none">
        {l.icon}
      </span>
      {!compact && <span>{l.label}</span>}
    </Link>
  );

  return (
    <nav aria-label="Διαχείριση" className={`print:hidden border-b lg:border-b-0 lg:border-r border-line bg-white/40 backdrop-blur-xl lg:shrink-0 transition-[width] duration-200 ${collapsed ? "lg:w-16" : "lg:w-60"}`}>
      {/* Κινητό: οριζόντια γραμμή */}
      <ul className="flex lg:hidden gap-1 p-2 overflow-x-auto">
        {groups.flatMap((g) => g.items).map((l) => (
          <li key={l.href} className="shrink-0">
            {link(l, false)}
          </li>
        ))}
        <li className="shrink-0">
          <form action={logoutAction}>
            <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-danger whitespace-nowrap">↪ Έξοδος</button>
          </form>
        </li>
      </ul>

      {/* Υπολογιστής/tablet: πλαϊνό μενού με ομάδες, κουμπί σύμπτυξης και έξοδο κάτω */}
      <div className="hidden lg:flex flex-col sticky top-12 h-[calc(100dvh-3rem)]">
        <div className={`flex ${collapsed ? "justify-center" : "justify-end"} p-2`}>
          <button type="button" onClick={toggle} className="rounded-lg px-2 py-1 text-ink-3 hover:bg-white/70 hover:text-ink" aria-label={collapsed ? "Άνοιγμα μενού" : "Κλείσιμο μενού"} title={collapsed ? "Άνοιγμα μενού" : "Κλείσιμο μενού"}>
            {collapsed ? "»" : "«"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.title && !collapsed && <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">{g.title}</div>}
              {g.title && collapsed && <div className="mx-3 mb-2 border-t border-line" />}
              <ul className="space-y-0.5">
                {g.items.map((l) => (
                  <li key={l.href}>{link(l, collapsed)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-2">
          {!collapsed && (
            <div className="px-3 pb-1.5">
              <div className="text-sm font-semibold truncate">{userName}</div>
              <div className="text-[11px] text-ink-3">{role === "admin" ? "Διαχειριστής" : "Υπεύθυνος"}</div>
            </div>
          )}
          <form action={logoutAction}>
            <button className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft ${collapsed ? "justify-center px-0" : ""}`} title="Έξοδος">
              <span aria-hidden>↪</span>
              {!collapsed && <span>Έξοδος</span>}
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
