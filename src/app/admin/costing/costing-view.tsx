"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Modal, Money } from "@/components/ui";
import { InfoBox, PageHeader, Section, TableWrap, useActionRunner } from "@/components/admin/common";
import { euroToInput, fmtIsoDate, parseDecimal } from "@/components/admin/format";
import { normalizeItemKey } from "@/lib/invoice-match";
import type { StockUnit } from "@/db/schema";
import type { CostKind, CostStatus, IngredientOption, IngredientPrice, ProductCost, costingOverview } from "@/server/services/costing";
import { quickIngredientAction, saveCostTargetsAction, saveRecipeAction, saveResaleItemsAction } from "./actions";

type Data = Awaited<ReturnType<typeof costingOverview>>;

const UNIT: Record<StockUnit, string> = { g: "γρ.", kg: "κιλά", ml: "ml", l: "λίτρα", pcs: "τεμ." };
const KIND_LABEL: Record<CostKind, string> = { food: "Φαγητό", drink: "Ποτό" };

const STATUS: Record<CostStatus, { label: string; tone: "ok" | "warn" | "danger" | "neutral"; rank: number }> = {
  danger: { label: "Ακριβό", tone: "danger", rank: 0 },
  warn: { label: "Οριακό", tone: "warn", rank: 1 },
  noprice: { label: "Λείπει τιμή", tone: "warn", rank: 2 },
  norecipe: { label: "Χωρίς συνταγή", tone: "neutral", rank: 3 },
  nosaleprice: { label: "Χωρίς τιμή πώλησης", tone: "neutral", rank: 4 },
  ok: { label: "Εντός στόχου", tone: "ok", rank: 5 },
};

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function euro(v: number, digits = 2): string {
  return `${v.toLocaleString("el-GR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
}

/** Τιμή ανά κιλό/λίτρο για γραμμάρια και ml, ώστε να διαβάζεται όπως στο τιμολόγιο. */
function unitPrice(unitCost: number, unit: StockUnit): string {
  if (unit === "g") return `${euro(unitCost * 1000)}/κιλό`;
  if (unit === "ml") return `${euro(unitCost * 1000)}/λίτρο`;
  if (unit === "kg") return `${euro(unitCost)}/κιλό`;
  if (unit === "l") return `${euro(unitCost)}/λίτρο`;
  return `${euro(unitCost, unitCost < 1 ? 3 : 2)}/τεμ.`;
}

function sourceText(p: IngredientPrice): string {
  const when = p.date ? fmtIsoDate(p.date) : null;
  const old = p.stale ? " · παλιά τιμή" : "";
  if (p.source === "receipt") return [`Τιμολόγιο${p.docNumber ? ` ${p.docNumber}` : ""}`, p.supplierName, when].filter(Boolean).join(" · ") + old;
  if (p.source === "average") return `Μέσο κόστος αποθήκης${when ? ` · τελευταία παραλαβή ${when}` : ""}${old}`;
  if (p.source === "manual") return "Τιμή με το χέρι (Αποθήκη)";
  return "Χωρίς τιμή αγοράς";
}

export function CostingView({ data }: { data: Data }) {
  const runner = useActionRunner();
  const [kind, setKind] = useState<"all" | CostKind>("all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ProductCost | null>(null);
  const [editSeq, setEditSeq] = useState(0);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [resaleOpen, setResaleOpen] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("el");
    return data.products
      .filter((p) => kind === "all" || p.kind === kind)
      .filter((p) => !onlyIssues || p.status !== "ok")
      .filter((p) => !q || `${p.name} ${p.category}`.toLocaleLowerCase("el").includes(q))
      .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || (b.costPct ?? -1) - (a.costPct ?? -1) || a.name.localeCompare(b.name, "el"));
  }, [data.products, kind, onlyIssues, query]);

  // Η συνταγή που ανοίγει διαβάζεται πάντα από τα τρέχοντα δεδομένα (μετά από αποθήκευση ανανεώνονται).
  const current = editing ? (data.products.find((p) => p.productId === editing.productId) ?? editing) : null;

  const basisHref = (b: "last" | "average") => (b === "last" ? "/admin/costing" : "/admin/costing?b=average");

  return (
    <div className="space-y-4">
      {runner.toastElement}
      <PageHeader
        title="Κοστολόγηση"
        subtitle="Food cost και drink cost για κάθε προϊόν του καταλόγου, από τη συνταγή και τις τιμές των τιμολογίων"
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setResaleOpen(true)} data-testid="resale-open">
              Έτοιμα προϊόντα (τιμή/τεμ.)
            </button>
            <button className="btn-secondary btn-sm" onClick={() => setTargetsOpen(true)}>
              Στόχοι κόστους
            </button>
            <Link href="/admin/inventory?tab=receive" className="btn-primary btn-sm">
              + Παραλαβή τιμολογίου
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["food", "drink"] as const).map((k) => {
          const s = data.summary[k];
          const tone = s.costPct === null ? undefined : s.costPct <= s.targetPct ? "ok" : s.costPct <= s.targetPct + 5 ? "warn" : "danger";
          return (
            <div key={k} className="card p-4" data-testid={`summary-${k}`}>
              <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">{k === "food" ? "Food cost" : "Drink cost"}</div>
              <div className={`text-2xl font-bold mt-1 num ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink"}`}>{pct(s.costPct)}</div>
              <div className="text-xs text-ink-3 mt-1">
                Στόχος {pct(s.targetPct)} · {s.weighted ? "με βάση τις πωλήσεις 30 ημερών" : "μέσος όρος προϊόντων"}
              </div>
            </div>
          );
        })}
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">Πάνω από τον στόχο</div>
          <div className={`text-2xl font-bold mt-1 num ${data.summary.food.overTarget + data.summary.drink.overTarget ? "text-danger" : "text-ink"}`}>
            {data.summary.food.overTarget + data.summary.drink.overTarget}
          </div>
          <div className="text-xs text-ink-3 mt-1">προϊόντα με κόστος πάνω από τον στόχο</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">Χωρίς πλήρη κοστολόγηση</div>
          <div className="text-2xl font-bold mt-1 num">
            {data.summary.food.noRecipe + data.summary.drink.noRecipe + data.summary.food.missingPrices + data.summary.drink.missingPrices}
          </div>
          <div className="text-xs text-ink-3 mt-1">
            {data.summary.food.noRecipe + data.summary.drink.noRecipe} χωρίς συνταγή · {data.summary.food.missingPrices + data.summary.drink.missingPrices} με πρώτη ύλη χωρίς τιμή
          </div>
        </div>
      </div>

      <InfoBox>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-semibold text-ink">Τιμές αγοράς:</span>
          <span className="inline-flex rounded-lg border border-line overflow-hidden text-sm" role="group" aria-label="Βάση τιμής αγοράς">
            <Link href={basisHref("last")} className={`px-3 py-1 ${data.basis === "last" ? "bg-brand text-white" : "bg-surface-2 text-ink-2"}`} aria-current={data.basis === "last" ? "page" : undefined}>
              Τελευταία τιμή τιμολογίου
            </Link>
            <Link href={basisHref("average")} className={`px-3 py-1 border-l border-line ${data.basis === "average" ? "bg-brand text-white" : "bg-surface-2 text-ink-2"}`} aria-current={data.basis === "average" ? "page" : undefined}>
              Μέσο κόστος αποθήκης
            </Link>
          </span>
        </div>
        <p className="mt-2">
          Κάθε φορά που περνάς τιμολόγιο στην Αποθήκη › Παραλαβή, οι τιμές εδώ αλλάζουν αμέσως. Τα ποσοστά υπολογίζονται στην τιμή πώλησης χωρίς ΦΠΑ, με τιμές αγοράς χωρίς ΦΠΑ. Οι επιλογές
          των ειδών, π.χ. έξτρα τυρί, δεν μετράνε εδώ.
        </p>
      </InfoBox>

      <Section
        flush
        title={`Προϊόντα (${rows.length})`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-line overflow-hidden text-sm" role="group" aria-label="Είδος">
              {(["all", "food", "drink"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`px-3 py-1 ${k !== "all" ? "border-l border-line" : ""} ${kind === k ? "bg-brand text-white" : "bg-surface-2 text-ink-2"}`}
                >
                  {k === "all" ? "Όλα" : KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-1.5 text-sm text-ink-2">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              Μόνο όσα θέλουν προσοχή
            </label>
            <div className="w-44">
              <input className="input" placeholder="Αναζήτηση" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Αναζήτηση προϊόντος" />
            </div>
          </div>
        }
      >
        {rows.length === 0 ? (
          <div className="p-6 text-center text-ink-2">Δεν υπάρχουν προϊόντα για αυτά τα φίλτρα.</div>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Προϊόν</th>
                <th className="text-right">Τιμή</th>
                <th className="text-right">Χωρίς ΦΠΑ</th>
                <th className="text-right">Κόστος</th>
                <th className="text-right">Κόστος %</th>
                <th className="text-right">Μικτό κέρδος</th>
                <th className="text-right">Πωλήσεις 30 ημ.</th>
                <th>Κατάσταση</th>
                <th data-nosort />
              </tr>
            </thead>
            <tbody data-testid="costing-rows">
              {rows.map((p) => {
                const st = STATUS[p.status];
                const costed = p.status === "ok" || p.status === "warn" || p.status === "danger";
                return (
                  <tr
                    key={p.productId}
                    className="cursor-pointer hover:bg-surface-3"
                    onClick={() => {
                      setEditSeq((n) => n + 1);
                      setEditing(p);
                    }}
                  >
                    <td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-ink-3">
                        {p.category} · {KIND_LABEL[p.kind]}
                        {!p.available ? " · μη διαθέσιμο" : ""}
                      </div>
                    </td>
                    <td className="text-right num">
                      <Money cents={p.priceCents} />
                    </td>
                    <td className="text-right num text-ink-2">
                      <Money cents={p.netCents} />
                    </td>
                    <td className="text-right num">{p.lines.length ? <Money cents={p.costCents} /> : "—"}</td>
                    <td className={`text-right num font-semibold ${p.status === "danger" ? "text-danger" : p.status === "warn" ? "text-warn" : p.status === "ok" ? "text-ok" : ""}`}>{costed ? pct(p.costPct) : "—"}</td>
                    <td className="text-right num">{costed ? <Money cents={p.marginCents} /> : "—"}</td>
                    <td className="text-right num">{p.sold30}</td>
                    <td>
                      <Badge tone={st.tone === "neutral" ? "neutral" : st.tone}>{st.label}</Badge>
                      {(p.status === "danger" || p.status === "warn") && p.suggestedCents !== null && (
                        <div className="text-xs text-ink-3 mt-1 num">Ελάχιστη τιμή για στόχο: {euro(p.suggestedCents / 100)}</div>
                      )}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditSeq((n) => n + 1);
                          setEditing(p);
                        }}
                      >
                        Συνταγή
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {current && <RecipeEditor key={editSeq} product={current} ingredients={data.ingredients} onClose={() => setEditing(null)} runner={runner} />}
      {resaleOpen && <ResaleModal products={data.products} ingredients={data.ingredients} onClose={() => setResaleOpen(false)} runner={runner} />}
      {targetsOpen && <TargetsModal food={data.targets.food} drink={data.targets.drink} onClose={() => setTargetsOpen(false)} runner={runner} />}
    </div>
  );
}

type Runner = ReturnType<typeof useActionRunner>;
type Line = { key: number; ingredientId: number; qty: string };
let lineKey = 1;

function RecipeEditor({ product, ingredients, onClose, runner }: { product: ProductCost; ingredients: IngredientOption[]; onClose: () => void; runner: Runner }) {
  const [lines, setLines] = useState<Line[]>(() =>
    product.lines.length ? product.lines.map((l) => ({ key: lineKey++, ingredientId: l.ingredientId, qty: String(l.qty).replace(".", ",") })) : [{ key: lineKey++, ingredientId: 0, qty: "" }],
  );
  const [quickOpen, setQuickOpen] = useState(false);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const lineCents = (l: Line) => {
    const ing = byId.get(l.ingredientId);
    return ing ? parseDecimal(l.qty) * ing.price.unitCost * 100 : 0;
  };
  const costCents = Math.round(lines.reduce((s, l) => s + lineCents(l), 0));
  const costPct = product.netCents > 0 && costCents > 0 ? Math.round((costCents / product.netCents) * 1000) / 10 : null;
  const missing = lines.filter((l) => l.ingredientId && (byId.get(l.ingredientId)?.price.unitCost ?? 0) <= 0).length;
  const suggested = costCents > 0 && product.targetPct > 0 ? Math.ceil(((costCents / (product.targetPct / 100)) * (1 + product.vatPct / 100)) / 10) * 10 : null;
  const tone = costPct === null ? "" : costPct <= product.targetPct ? "text-ok" : costPct <= product.targetPct + 5 ? "text-warn" : "text-danger";

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const save = () => {
    const payload = lines.filter((l) => l.ingredientId > 0 && parseDecimal(l.qty) > 0).map((l) => ({ ingredientId: l.ingredientId, qty: parseDecimal(l.qty) }));
    runner.run(() => saveRecipeAction(product.productId, payload), { success: `Η συνταγή «${product.name}» αποθηκεύτηκε`, onSuccess: onClose });
  };

  return (
    <Modal open onClose={onClose} title={`Συνταγή · ${product.name}`} wide>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Γράψε πόσο από κάθε πρώτη ύλη μπαίνει σε <strong>μία μερίδα</strong>, στη μονάδα της πρώτης ύλης. Τιμή πώλησης <Money cents={product.priceCents} />, χωρίς ΦΠΑ{" "}
          <Money cents={product.netCents} /> (ΦΠΑ {product.vatPct.toLocaleString("el-GR")}%).
        </p>

        {product.lines.length === 0 && <ResaleQuick product={product} ingredients={ingredients} runner={runner} onDone={onClose} />}

        <div className="space-y-2" data-testid="recipe-lines">
          {lines.map((l) => {
            const ing = byId.get(l.ingredientId);
            return (
              <div key={l.key} className="rounded-xl border border-line p-2.5 space-y-1.5">
                {/* Στο κινητό η πρώτη ύλη πιάνει όλη τη σειρά και η ποσότητα πάει από κάτω· από sm και πάνω όλα σε μία σειρά. */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="basis-full sm:basis-0 sm:flex-1 min-w-0">
                    <select className="input" value={l.ingredientId || ""} onChange={(e) => update(l.key, { ingredientId: Number(e.target.value) })} aria-label="Πρώτη ύλη">
                      <option value="">Διάλεξε πρώτη ύλη…</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({UNIT[i.unit]})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28 shrink-0">
                    <input className="input num" inputMode="decimal" placeholder="Ποσότητα" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} aria-label="Ποσότητα ανά μερίδα" />
                  </div>
                  <span className="text-sm text-ink-3 w-12 shrink-0">{ing ? UNIT[ing.unit] : ""}</span>
                  <span className="text-sm font-semibold num w-20 shrink-0 text-right ml-auto sm:ml-0">{ing ? euro(lineCents(l) / 100) : ""}</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Αφαίρεση γραμμής">
                    ✕
                  </button>
                </div>
                {ing && (
                  <div className={`text-xs ${ing.price.source === "none" ? "text-warn" : "text-ink-3"}`}>
                    {ing.price.unitCost > 0 ? `${unitPrice(ing.price.unitCost, ing.unit)} · ` : ""}
                    {sourceText(ing.price)}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: lineKey++, ingredientId: 0, qty: "" }])}>
              + Πρώτη ύλη
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setQuickOpen((v) => !v)} aria-expanded={quickOpen}>
              {quickOpen ? "Κλείσιμο νέας πρώτης ύλης" : "Νέα πρώτη ύλη που δεν υπάρχει"}
            </button>
          </div>
        </div>

        {quickOpen && (
          <QuickIngredient
            runner={runner}
            onCreated={(id) => {
              setQuickOpen(false);
              setLines((ls) => {
                const empty = ls.find((x) => !x.ingredientId);
                return empty ? ls.map((x) => (x.key === empty.key ? { ...x, ingredientId: id } : x)) : [...ls, { key: lineKey++, ingredientId: id, qty: "" }];
              });
            }}
          />
        )}

        <div className="rounded-xl bg-surface-3 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-ink-3">Κόστος μερίδας</div>
            <div className="text-lg font-bold num">{euro(costCents / 100)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-3">Κόστος %</div>
            <div className={`text-lg font-bold num ${tone}`} data-testid="recipe-pct">
              {pct(costPct)}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-3">Στόχος</div>
            <div className="text-lg font-bold num">{pct(product.targetPct)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-3">Ελάχιστη τιμή για τον στόχο</div>
            <div className="text-lg font-bold num">{suggested !== null && !missing ? euro(suggested / 100) : "—"}</div>
          </div>
        </div>
        {missing > 0 && <InfoBox tone="warn">{missing === 1 ? "Μία πρώτη ύλη δεν έχει" : `${missing} πρώτες ύλες δεν έχουν`} τιμή αγοράς, οπότε το κόστος βγαίνει μικρότερο από το πραγματικό. Πέρασε το τιμολόγιο στην Παραλαβή.</InfoBox>}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={runner.pending}>
            Άκυρο
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={save} disabled={runner.pending}>
            {runner.pending ? "Αποθήκευση…" : "Αποθήκευση συνταγής"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function QuickIngredient({ runner, onCreated }: { runner: Runner; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<StockUnit>("g");
  const [packSize, setPackSize] = useState("1000");
  const [packPrice, setPackPrice] = useState("");
  const size = parseDecimal(packSize);
  const price = parseDecimal(packPrice);
  const create = () =>
    runner.run(() => quickIngredientAction({ name, unit, packSize: size, packPriceEuro: price }), {
      success: `Η πρώτη ύλη «${name.trim()}» προστέθηκε`,
      onSuccess: (r) => onCreated(r.id),
    });
  return (
    <div className="rounded-xl border border-line p-3 space-y-2">
      <div className="font-semibold text-sm">Νέα πρώτη ύλη</div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input className="input sm:col-span-2" placeholder="Όνομα, π.χ. Κιμάς μοσχαρίσιος" value={name} onChange={(e) => setName(e.target.value)} aria-label="Όνομα πρώτης ύλης" />
        <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as StockUnit)} aria-label="Μονάδα συνταγής">
          <option value="g">γραμμάρια</option>
          <option value="ml">ml</option>
          <option value="pcs">τεμάχια</option>
          <option value="kg">κιλά</option>
          <option value="l">λίτρα</option>
        </select>
        <div />
        <label className="text-xs text-ink-3 sm:col-span-2">
          Η συσκευασία έχει ({UNIT[unit]})
          <input className="input num mt-1" inputMode="decimal" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
        </label>
        <label className="text-xs text-ink-3 sm:col-span-2">
          Τιμή συσκευασίας χωρίς ΦΠΑ (€)
          <input className="input num mt-1" inputMode="decimal" placeholder="0,00" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-3 num">{size > 0 && price > 0 ? `= ${unitPrice(price / size, unit)}` : "Π.χ. 1000 γρ. στα 9,80 € σημαίνει 9,80 €/κιλό"}</span>
        <button type="button" className="btn-primary btn-sm" onClick={create} disabled={runner.pending || !name.trim() || !(size > 0)}>
          Προσθήκη
        </button>
      </div>
    </div>
  );
}

/** Η πρώτη ύλη «ίδιο όνομα, σε τεμάχια» ενός έτοιμου προϊόντος (π.χ. «Coca-Cola 330ml»), αν υπάρχει. */
function resaleIngredient(productName: string, ingredients: IngredientOption[]): IngredientOption | null {
  const key = normalizeItemKey(productName);
  return ingredients.find((i) => i.unit === "pcs" && normalizeItemKey(i.name) === key) ?? null;
}

/** Έτοιμο προϊόν: η συνταγή του είναι ακριβώς 1 τεμάχιο της ομώνυμης πρώτης ύλης. */
function isResale(p: ProductCost): boolean {
  return p.lines.length === 1 && p.lines[0].qty === 1 && p.lines[0].unit === "pcs" && normalizeItemKey(p.lines[0].name) === normalizeItemKey(p.name);
}

function initialPrice(p: ProductCost, ingredients: IngredientOption[]): string {
  const ing = resaleIngredient(p.name, ingredients);
  return ing && ing.price.unitCost > 0 ? euroToInput(ing.price.unitCost, 3) : "";
}

/** Μέσα στη συνταγή ενός προϊόντος χωρίς συνταγή: «είναι έτοιμο, κοστίζει τόσο το τεμάχιο». */
function ResaleQuick({ product, ingredients, runner, onDone }: { product: ProductCost; ingredients: IngredientOption[]; runner: Runner; onDone: () => void }) {
  const ing = resaleIngredient(product.name, ingredients);
  const [value, setValue] = useState(() => initialPrice(product, ingredients));
  const cost = parseDecimal(value, -1);
  const costPct = product.netCents > 0 && cost > 0 ? Math.round(((cost * 100) / product.netCents) * 1000) / 10 : null;
  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft p-3 space-y-2" data-testid="resale-quick">
      <div className="font-semibold text-sm">Έτοιμο προϊόν; (αναψυκτικό, νερό, μπύρα σε φιάλη…)</div>
      <p className="text-xs text-ink-2">
        Δεν χρειάζεται συνταγή: γράψε την τιμή αγοράς ανά τεμάχιο χωρίς ΦΠΑ. Δημιουργείται η πρώτη ύλη «{product.name}» σε τεμάχια (για απόθεμα και τιμολόγια) και η συνταγή 1 τεμάχιο.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-32">
          <input className="input num" inputMode="decimal" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Τιμή αγοράς ανά τεμάχιο χωρίς ΦΠΑ" />
        </div>
        <span className="text-sm text-ink-3">€/τεμ.</span>
        {costPct !== null && <span className="text-sm font-semibold num">= {pct(costPct)} της τιμής χωρίς ΦΠΑ</span>}
        <button
          type="button"
          className="btn-primary btn-sm ml-auto"
          disabled={runner.pending || !(cost >= 0) || value.trim() === ""}
          onClick={() => runner.run(() => saveResaleItemsAction([{ productId: product.productId, unitCostEuro: cost }]), { success: `«${product.name}»: έτοιμο προϊόν`, onSuccess: onDone })}
        >
          Αποθήκευση ως έτοιμο
        </button>
      </div>
      {ing && <div className="text-xs text-ink-3">Υπάρχει ήδη η πρώτη ύλη «{ing.name}»: {sourceText(ing.price)}.</div>}
    </div>
  );
}

/** Όλα τα έτοιμα προϊόντα μαζί: μία τιμή ανά τεμάχιο για καθένα, προσυμπληρωμένη από τιμολόγια/αποθήκη όπου υπάρχει. */
function ResaleModal({ products, ingredients, onClose, runner }: { products: ProductCost[]; ingredients: IngredientOption[]; onClose: () => void; runner: Runner }) {
  const [all, setAll] = useState(false);
  const candidates = useMemo(
    () => products.filter((p) => p.status === "norecipe" || isResale(p)).sort((a, b) => a.category.localeCompare(b.category, "el") || a.name.localeCompare(b.name, "el")),
    [products],
  );
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(candidates.map((p) => [p.productId, initialPrice(p, ingredients)])));
  const shown = candidates.filter((p) => all || p.kind === "drink");
  const filled = shown.filter((p) => (values[p.productId] ?? "").trim() !== "" && parseDecimal(values[p.productId], -1) >= 0);
  const save = () =>
    runner.run(() => saveResaleItemsAction(filled.map((p) => ({ productId: p.productId, unitCostEuro: parseDecimal(values[p.productId]) }))), {
      success: `Αποθηκεύτηκαν ${filled.length} έτοιμα προϊόντα`,
      onSuccess: onClose,
    });
  return (
    <Modal open onClose={onClose} title="Έτοιμα προϊόντα · τιμή αγοράς ανά τεμάχιο" wide>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          Για ό,τι πουλιέται όπως αγοράζεται (αναψυκτικά, νερά, μπύρες σε φιάλη, χυμοί σε κουτί): μόνο η τιμή αγοράς ανά τεμάχιο χωρίς ΦΠΑ. Όσα έχουν ήδη τιμή από τιμολόγιο είναι
          συμπληρωμένα. Άφησε κενό ό,τι θέλει κανονική συνταγή (π.χ. καφέδες, cocktail).
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Δείξε και τα φαγητά χωρίς συνταγή
        </label>
        {shown.length === 0 ? (
          <p className="text-sm text-ink-3 py-4 text-center">Όλα τα {all ? "" : "ποτά "}έχουν ήδη συνταγή.</p>
        ) : (
          <ul className="divide-y divide-line max-h-[55vh] overflow-y-auto" data-testid="resale-list">
            {shown.map((p) => {
              const v = values[p.productId] ?? "";
              const cost = parseDecimal(v, -1);
              const costPct = p.netCents > 0 && cost > 0 ? Math.round(((cost * 100) / p.netCents) * 1000) / 10 : null;
              const ing = resaleIngredient(p.name, ingredients);
              return (
                <li key={p.productId} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="text-xs text-ink-3">
                      {p.category} · πώληση <Money cents={p.priceCents} />
                      {ing && ing.price.unitCost > 0 ? ` · ${sourceText(ing.price)}` : ""}
                    </div>
                  </div>
                  <div className="w-28">
                    <input
                      className="input num"
                      inputMode="decimal"
                      placeholder="€/τεμ."
                      value={v}
                      onChange={(e) => setValues((cur) => ({ ...cur, [p.productId]: e.target.value }))}
                      aria-label={`Τιμή αγοράς ανά τεμάχιο: ${p.name}`}
                    />
                  </div>
                  <span className={`w-16 text-right text-sm num ${costPct === null ? "text-ink-3" : costPct <= p.targetPct ? "text-ok" : costPct <= p.targetPct + 5 ? "text-warn" : "text-danger"}`}>
                    {pct(costPct)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={runner.pending}>
            Άκυρο
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={save} disabled={runner.pending || !filled.length} data-testid="resale-save">
            {runner.pending ? "Αποθήκευση…" : `Αποθήκευση (${filled.length})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TargetsModal({ food, drink, onClose, runner }: { food: number; drink: number; onClose: () => void; runner: Runner }) {
  const [f, setF] = useState(String(food).replace(".", ","));
  const [d, setD] = useState(String(drink).replace(".", ","));
  return (
    <Modal open onClose={onClose} title="Στόχοι κόστους">
      <div className="space-y-3">
        <p className="text-sm text-ink-2">Το ποσοστό της τιμής χωρίς ΦΠΑ που επιτρέπεται να είναι κόστος πρώτων υλών. Συνηθισμένα όρια: φαγητό 28–32%, ποτά και καφές 18–25%.</p>
        <label className="block text-sm">
          Food cost (%)
          <input className="input num mt-1" inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} />
        </label>
        <label className="block text-sm">
          Drink cost (%)
          <input className="input num mt-1" inputMode="decimal" value={d} onChange={(e) => setD(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
            Άκυρο
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={runner.pending}
            onClick={() => runner.run(() => saveCostTargetsAction(parseDecimal(f), parseDecimal(d)), { success: "Οι στόχοι αποθηκεύτηκαν", onSuccess: onClose })}
          >
            Αποθήκευση
          </button>
        </div>
      </div>
    </Modal>
  );
}
