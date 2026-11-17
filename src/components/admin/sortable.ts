/**
 * Ταξινόμηση πινάκων με κλικ στην επικεφαλίδα (για όλους τους πίνακες του TableWrap).
 * Δουλεύει πάνω στο DOM: διαβάζει το κείμενο των κελιών και καταλαβαίνει αριθμούς, ποσά (1.234,56 €),
 * ημερομηνίες (17/11/2026 14:05) και κείμενο (ελληνική αλφαβητική σειρά). Με MutationObserver
 * ξαναεφαρμόζεται όταν αλλάζουν οι γραμμές (νέα εγγραφή, φίλτρο).
 */

type Dir = "asc" | "desc";

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/;
const NUM_RE = /^[−\-+]?\s*[\d.]+(?:,\d+)?/;

/** Τιμή ταξινόμησης κελιού: αριθμός (για ποσά/ημερομηνίες) ή κείμενο. */
export function sortValue(raw: string): number | string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || t === "—" || t === "–" || t === "-") return "";
  const d = DATE_RE.exec(t);
  if (d) return Date.UTC(+d[3], +d[2] - 1, +d[1], d[4] ? +d[4] : 0, d[5] ? +d[5] : 0);
  const n = NUM_RE.exec(t.replace(/^[€$]/, ""));
  if (n && n[0].replace(/[−\-+\s]/g, "").length && /^[−\-+]?\s*[\d.,]+\s*(€|%|x|×|τεμ|γρ|ml|kg|λ|άτομα|παιδιά)?\b/i.test(t)) {
    const neg = /^[−-]/.test(n[0]);
    const num = Number(n[0].replace(/[−\-+\s]/g, "").replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(num)) return neg ? -num : num;
  }
  return t.toLocaleLowerCase("el");
}

export function compareValues(a: number | string, b: number | string): number {
  if (a === "" && b !== "") return 1; // κενά πάντα στο τέλος
  if (b === "" && a !== "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "el", { numeric: true, sensitivity: "base" });
}

/** Ενεργοποιεί την ταξινόμηση σε έναν πίνακα· επιστρέφει συνάρτηση καθαρισμού. */
export function attachSorting(table: HTMLTableElement): () => void {
  let col = -1;
  let dir: Dir = "asc";
  let applying = false;

  const headers = () => Array.from(table.tHead?.rows[0]?.cells ?? []);
  const sortable = (th: HTMLTableCellElement) => th.textContent?.trim() && !th.hasAttribute("data-nosort");

  headers().forEach((th) => {
    if (!sortable(th)) return;
    th.classList.add("th-sortable");
    th.setAttribute("role", "button");
    th.tabIndex = 0;
    th.title = "Ταξινόμηση";
  });

  function apply() {
    if (col < 0) return;
    applying = true;
    for (const body of Array.from(table.tBodies)) {
      const rows = Array.from(body.rows);
      // Γραμμές που «ανήκουν» στην προηγούμενη (π.χ. ανοιχτές λεπτομέρειες) μετακινούνται μαζί της.
      const groups: HTMLTableRowElement[][] = [];
      for (const r of rows) {
        if (r.hasAttribute("data-sort-follow") && groups.length) groups[groups.length - 1].push(r);
        else groups.push([r]);
      }
      const keyed = groups.map((g, i) => ({ g, i, v: sortValue(g[0].cells[col]?.textContent ?? "") }));
      keyed.sort((a, b) => compareValues(a.v, b.v) * (dir === "asc" ? 1 : -1) || a.i - b.i);
      const frag = document.createDocumentFragment();
      for (const k of keyed) for (const r of k.g) frag.appendChild(r);
      body.appendChild(frag);
    }
    headers().forEach((th, i) => {
      th.removeAttribute("aria-sort");
      if (i === col) th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
    });
    queueMicrotask(() => (applying = false));
  }

  function onClick(e: Event) {
    const th = (e.target as HTMLElement).closest("th");
    if (!th || !table.tHead?.contains(th) || !sortable(th as HTMLTableCellElement)) return;
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const i = (th as HTMLTableCellElement).cellIndex;
    if (i === col) dir = dir === "asc" ? "desc" : "asc";
    else {
      col = i;
      dir = "asc";
    }
    apply();
  }

  const obs = new MutationObserver(() => {
    if (!applying) apply();
  });
  for (const body of Array.from(table.tBodies)) obs.observe(body, { childList: true, subtree: true, characterData: true });

  table.tHead?.addEventListener("click", onClick);
  table.tHead?.addEventListener("keydown", onClick);
  return () => {
    obs.disconnect();
    table.tHead?.removeEventListener("click", onClick);
    table.tHead?.removeEventListener("keydown", onClick);
  };
}
