/**
 * Nido Village – σχήμα βάσης δεδομένων (Drizzle ORM, PostgreSQL).
 *
 * Συμβάσεις:
 *  - Χρήματα: ακέραια λεπτά (cents) για να μην υπάρχουν σφάλματα κινητής υποδιαστολής.
 *  - Ποσότητες αποθήκης: numeric(14,3) (π.χ. γραμμάρια, ml, τεμάχια).
 *  - Ώρες: timestamptz. Οι αναφορές μετατρέπουν σε Europe/Athens.
 *  - Ό,τι είναι φορολογικά ευαίσθητο (ακυρώσεις, εκπτώσεις) καταγράφεται στο audit_log.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const ts = (name?: string) =>
  name
    ? timestamp(name, { withTimezone: true, mode: "date" })
    : timestamp({ withTimezone: true, mode: "date" });

/* ------------------------------------------------------------------ */
/* Ρυθμίσεις                                                            */
/* ------------------------------------------------------------------ */

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: ts().notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Οργάνωση                                                             */
/* ------------------------------------------------------------------ */

export type EmployeeRole = "admin" | "manager" | "waiter" | "cashier" | "kitchen";

export const employees = pgTable("employees", {
  id: serial().primaryKey(),
  name: text().notNull(),
  role: text().$type<EmployeeRole>().notNull().default("waiter"),
  pinHash: text().notNull(),
  active: boolean().notNull().default(true),
  createdAt: ts().notNull().defaultNow(),
});

export const areas = pgTable("areas", {
  id: serial().primaryKey(),
  name: text().notNull(),
  sort: integer().notNull().default(0),
  active: boolean().notNull().default(true),
});

export const tables = pgTable(
  "tables",
  {
    id: serial().primaryKey(),
    areaId: integer()
      .notNull()
      .references(() => areas.id),
    name: text().notNull(),
    seats: integer().notNull().default(4),
    sort: integer().notNull().default(0),
    active: boolean().notNull().default(true),
  },
  (t) => [index("tables_area_idx").on(t.areaId)],
);

/* ------------------------------------------------------------------ */
/* Εκτυπωτές / σταθμοί                                                  */
/* ------------------------------------------------------------------ */

export type PrintDriver = "console" | "tcp";
export type StationKind = "kitchen" | "bar" | "receipt";
export type Codepage = "cp737" | "cp1253" | "iso8859-7";

export const printStations = pgTable("print_stations", {
  id: serial().primaryKey(),
  name: text().notNull(),
  kind: text().$type<StationKind>().notNull().default("kitchen"),
  driver: text().$type<PrintDriver>().notNull().default("console"),
  host: text(),
  port: integer().notNull().default(9100),
  codepage: text().$type<Codepage>().notNull().default("cp737"),
  columns: integer().notNull().default(42),
  cutter: boolean().notNull().default(true),
  drawerKick: boolean().notNull().default(false),
  enabled: boolean().notNull().default(true),
  sort: integer().notNull().default(0),
  lastOkAt: ts(),
  lastError: text(),
});

/* ------------------------------------------------------------------ */
/* Κατάλογος                                                            */
/* ------------------------------------------------------------------ */

export const vatRates = pgTable("vat_rates", {
  id: serial().primaryKey(),
  name: text().notNull(),
  ratePct: numeric({ precision: 5, scale: 2 }).notNull(),
  /** Κατηγορία ΦΠΑ myDATA (1=24%, 2=13%, 3=6%, 7=0%/εξαιρ.). Το επιβεβαιώνει ο λογιστής. */
  mydataCategory: integer(),
  active: boolean().notNull().default(true),
});

export const categories = pgTable("categories", {
  id: serial().primaryKey(),
  name: text().notNull(),
  sort: integer().notNull().default(0),
  color: text().notNull().default("#0f766e"),
  printStationId: integer().references(() => printStations.id),
  active: boolean().notNull().default(true),
});

export const products = pgTable(
  "products",
  {
    id: serial().primaryKey(),
    categoryId: integer()
      .notNull()
      .references(() => categories.id),
    name: text().notNull(),
    priceCents: integer().notNull().default(0),
    vatRateId: integer()
      .notNull()
      .references(() => vatRates.id),
    /** Αν είναι null, χρησιμοποιείται ο σταθμός της κατηγορίας. */
    printStationId: integer().references(() => printStations.id),
    sku: text(),
    available: boolean().notNull().default(true),
    sort: integer().notNull().default(0),
    active: boolean().notNull().default(true),
  },
  (t) => [index("products_category_idx").on(t.categoryId)],
);

export const modifierGroups = pgTable("modifier_groups", {
  id: serial().primaryKey(),
  name: text().notNull(),
  minSelect: integer().notNull().default(0),
  maxSelect: integer().notNull().default(1),
  active: boolean().notNull().default(true),
});

export const modifiers = pgTable("modifiers", {
  id: serial().primaryKey(),
  groupId: integer()
    .notNull()
    .references(() => modifierGroups.id),
  name: text().notNull(),
  priceDeltaCents: integer().notNull().default(0),
  sort: integer().notNull().default(0),
  active: boolean().notNull().default(true),
});

export const productModifierGroups = pgTable(
  "product_modifier_groups",
  {
    productId: integer()
      .notNull()
      .references(() => products.id),
    groupId: integer()
      .notNull()
      .references(() => modifierGroups.id),
    sort: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

/* ------------------------------------------------------------------ */
/* Υπηρεσία: τραπέζια, παραγγελίες                                      */
/* ------------------------------------------------------------------ */

export type SessionStatus = "open" | "billed" | "closed" | "cancelled";
export type OrderType = "dine_in" | "takeaway" | "delivery";
export type ItemStatus = "sent" | "preparing" | "ready" | "served" | "voided";

export const tableSessions = pgTable(
  "table_sessions",
  {
    id: serial().primaryKey(),
    tableId: integer().references(() => tables.id),
    orderType: text().$type<OrderType>().notNull().default("dine_in"),
    /** Όνομα πελάτη για takeaway/delivery. */
    label: text(),
    covers: integer().notNull().default(0),
    status: text().$type<SessionStatus>().notNull().default("open"),
    openedBy: integer()
      .notNull()
      .references(() => employees.id),
    openedAt: ts().notNull().defaultNow(),
    closedBy: integer().references(() => employees.id),
    closedAt: ts(),
    discountCents: integer().notNull().default(0),
    discountReason: text(),
    discountBy: integer().references(() => employees.id),
    billPrintedAt: ts(),
    notes: text(),
  },
  (t) => [index("sessions_status_idx").on(t.status), index("sessions_table_idx").on(t.tableId)],
);

export const orders = pgTable(
  "orders",
  {
    id: serial().primaryKey(),
    sessionId: integer()
      .notNull()
      .references(() => tableSessions.id),
    roundNo: integer().notNull().default(1),
    employeeId: integer()
      .notNull()
      .references(() => employees.id),
    notes: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("orders_session_idx").on(t.sessionId)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial().primaryKey(),
    orderId: integer()
      .notNull()
      .references(() => orders.id),
    sessionId: integer()
      .notNull()
      .references(() => tableSessions.id),
    productId: integer()
      .notNull()
      .references(() => products.id),
    nameSnapshot: text().notNull(),
    unitPriceCents: integer().notNull(),
    qty: integer().notNull().default(1),
    vatRateId: integer()
      .notNull()
      .references(() => vatRates.id),
    vatRatePct: numeric({ precision: 5, scale: 2 }).notNull(),
    course: integer().notNull().default(1),
    notes: text(),
    status: text().$type<ItemStatus>().notNull().default("sent"),
    printStationId: integer().references(() => printStations.id),
    sentAt: ts().notNull().defaultNow(),
    readyAt: ts(),
    servedAt: ts(),
    voidedAt: ts(),
    voidedBy: integer().references(() => employees.id),
    voidReason: text(),
  },
  (t) => [
    index("order_items_session_idx").on(t.sessionId),
    index("order_items_status_idx").on(t.status),
  ],
);

export const orderItemModifiers = pgTable("order_item_modifiers", {
  id: serial().primaryKey(),
  orderItemId: integer()
    .notNull()
    .references(() => orderItems.id),
  modifierId: integer().references(() => modifiers.id),
  nameSnapshot: text().notNull(),
  priceDeltaCents: integer().notNull().default(0),
});

/* ------------------------------------------------------------------ */
/* Εκτυπώσεις                                                           */
/* ------------------------------------------------------------------ */

export type PrintJobStatus = "queued" | "printing" | "done" | "failed";
export type PrintJobKind = "kitchen_ticket" | "void_ticket" | "bill" | "receipt" | "test" | "report";

export const printJobs = pgTable(
  "print_jobs",
  {
    id: serial().primaryKey(),
    stationId: integer()
      .notNull()
      .references(() => printStations.id),
    kind: text().$type<PrintJobKind>().notNull(),
    /** Το έγγραφο εκτύπωσης (TicketDoc) σε JSON – ανεξάρτητο από εκτυπωτή. */
    payload: jsonb().notNull(),
    renderedText: text(),
    status: text().$type<PrintJobStatus>().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    nextAttemptAt: ts(),
    createdAt: ts().notNull().defaultNow(),
    printedAt: ts(),
  },
  (t) => [index("print_jobs_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/* Πληρωμές, ταμείο, φορολογικά                                         */
/* ------------------------------------------------------------------ */

export type PaymentMethod = "cash" | "card" | "other";

export const cashSessions = pgTable("cash_sessions", {
  id: serial().primaryKey(),
  openedBy: integer()
    .notNull()
    .references(() => employees.id),
  openedAt: ts().notNull().defaultNow(),
  openingFloatCents: integer().notNull().default(0),
  closedBy: integer().references(() => employees.id),
  closedAt: ts(),
  countedCashCents: integer(),
  expectedCashCents: integer(),
  notes: text(),
});

export const payments = pgTable(
  "payments",
  {
    id: serial().primaryKey(),
    sessionId: integer()
      .notNull()
      .references(() => tableSessions.id),
    cashSessionId: integer().references(() => cashSessions.id),
    method: text().$type<PaymentMethod>().notNull(),
    amountCents: integer().notNull(),
    tenderedCents: integer(),
    changeCents: integer().notNull().default(0),
    /** Συμπληρώνεται από τη γέφυρα POS όταν συνδεθεί (Α.1155/2023). */
    posTransactionId: text(),
    employeeId: integer()
      .notNull()
      .references(() => employees.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("payments_session_idx").on(t.sessionId)],
);

export type FiscalKind = "order_slip_8_6" | "receipt_11_1" | "invoice" | "credit";
export type FiscalStatus = "not_required" | "pending_provider" | "issued" | "failed";

/**
 * Κάθε παραστατικό που θα έπρεπε να εκδοθεί (ή εκδόθηκε) μέσω ΦΗΜ/παρόχου.
 * Στη Φάση 1 (χωρίς πάροχο) τα rows δημιουργούνται με status "not_required"
 * ώστε όταν συνδεθεί ο πάροχος να υπάρχει ήδη η ροή.
 */
export const fiscalDocuments = pgTable(
  "fiscal_documents",
  {
    id: serial().primaryKey(),
    sessionId: integer().references(() => tableSessions.id),
    orderId: integer().references(() => orders.id),
    kind: text().$type<FiscalKind>().notNull(),
    status: text().$type<FiscalStatus>().notNull().default("not_required"),
    provider: text().notNull().default("none"),
    series: text(),
    number: text(),
    mark: text(),
    uid: text(),
    qrUrl: text(),
    payload: jsonb(),
    error: text(),
    createdAt: ts().notNull().defaultNow(),
    issuedAt: ts(),
  },
  (t) => [index("fiscal_session_idx").on(t.sessionId)],
);

export const auditLog = pgTable("audit_log", {
  id: serial().primaryKey(),
  employeeId: integer().references(() => employees.id),
  action: text().notNull(),
  entity: text().notNull(),
  entityId: integer(),
  details: jsonb(),
  createdAt: ts().notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Αποθήκη                                                              */
/* ------------------------------------------------------------------ */

export type StockUnit = "g" | "kg" | "ml" | "l" | "pcs";
export type MovementKind = "purchase" | "sale" | "void_reversal" | "waste" | "count" | "manual";

export const suppliers = pgTable("suppliers", {
  id: serial().primaryKey(),
  name: text().notNull(),
  vatNumber: text(),
  phone: text(),
  email: text(),
  notes: text(),
  active: boolean().notNull().default(true),
});

export const ingredients = pgTable("ingredients", {
  id: serial().primaryKey(),
  name: text().notNull(),
  unit: text().$type<StockUnit>().notNull().default("pcs"),
  stockQty: numeric({ precision: 14, scale: 3 }).notNull().default("0"),
  minQty: numeric({ precision: 14, scale: 3 }).notNull().default("0"),
  /** Κόστος ανά μονάδα σε ευρώ (π.χ. 0.0085 €/g). */
  costPerUnit: numeric({ precision: 12, scale: 4 }).notNull().default("0"),
  supplierId: integer().references(() => suppliers.id),
  active: boolean().notNull().default(true),
});

export const recipeLines = pgTable(
  "recipe_lines",
  {
    id: serial().primaryKey(),
    productId: integer().references(() => products.id),
    modifierId: integer().references(() => modifiers.id),
    ingredientId: integer()
      .notNull()
      .references(() => ingredients.id),
    qty: numeric({ precision: 12, scale: 3 }).notNull(),
  },
  (t) => [index("recipe_product_idx").on(t.productId), index("recipe_modifier_idx").on(t.modifierId)],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial().primaryKey(),
    ingredientId: integer()
      .notNull()
      .references(() => ingredients.id),
    kind: text().$type<MovementKind>().notNull(),
    qtyDelta: numeric({ precision: 14, scale: 3 }).notNull(),
    unitCost: numeric({ precision: 12, scale: 4 }),
    refType: text(),
    refId: integer(),
    note: text(),
    employeeId: integer().references(() => employees.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("stock_movements_ingredient_idx").on(t.ingredientId)],
);

export const goodsReceipts = pgTable("goods_receipts", {
  id: serial().primaryKey(),
  supplierId: integer().references(() => suppliers.id),
  docNumber: text(),
  docDate: ts().notNull().defaultNow(),
  totalCents: integer().notNull().default(0),
  employeeId: integer()
    .notNull()
    .references(() => employees.id),
  notes: text(),
  createdAt: ts().notNull().defaultNow(),
});

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: serial().primaryKey(),
  receiptId: integer()
    .notNull()
    .references(() => goodsReceipts.id),
  ingredientId: integer()
    .notNull()
    .references(() => ingredients.id),
  qty: numeric({ precision: 14, scale: 3 }).notNull(),
  unitCost: numeric({ precision: 12, scale: 4 }).notNull().default("0"),
});

/* ------------------------------------------------------------------ */
/* Cloud: στατιστικά για συνεταίρους                                    */
/* ------------------------------------------------------------------ */

/** Στιγμιότυπα στατιστικών που στέλνει το κατάστημα στο cloud (ή γράφει τοπικά). */
export const statsSnapshots = pgTable("stats_snapshots", {
  key: text().primaryKey(), // "latest" ή "day:2026-09-29"
  payload: jsonb().notNull(),
  computedAt: ts().notNull(),
  receivedAt: ts().notNull().defaultNow(),
});

/** Συνεταίροι/ιδιοκτήτες με πρόσβαση μόνο ανάγνωσης στο online dashboard. */
export const partnerUsers = pgTable("partner_users", {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  active: boolean().notNull().default(true),
  lastLoginAt: ts(),
  createdAt: ts().notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Relations (για το relational query API)                              */
/* ------------------------------------------------------------------ */

export const areasRelations = relations(areas, ({ many }) => ({ tables: many(tables) }));
export const tablesRelations = relations(tables, ({ one }) => ({
  area: one(areas, { fields: [tables.areaId], references: [areas.id] }),
}));
export const categoriesRelations = relations(categories, ({ many, one }) => ({
  products: many(products),
  printStation: one(printStations, { fields: [categories.printStationId], references: [printStations.id] }),
}));
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  vatRate: one(vatRates, { fields: [products.vatRateId], references: [vatRates.id] }),
  printStation: one(printStations, { fields: [products.printStationId], references: [printStations.id] }),
  modifierGroups: many(productModifierGroups),
  recipeLines: many(recipeLines),
}));
export const modifierGroupsRelations = relations(modifierGroups, ({ many }) => ({
  modifiers: many(modifiers),
  products: many(productModifierGroups),
}));
export const modifiersRelations = relations(modifiers, ({ one }) => ({
  group: one(modifierGroups, { fields: [modifiers.groupId], references: [modifierGroups.id] }),
}));
export const productModifierGroupsRelations = relations(productModifierGroups, ({ one }) => ({
  product: one(products, { fields: [productModifierGroups.productId], references: [products.id] }),
  group: one(modifierGroups, { fields: [productModifierGroups.groupId], references: [modifierGroups.id] }),
}));
export const tableSessionsRelations = relations(tableSessions, ({ one, many }) => ({
  table: one(tables, { fields: [tableSessions.tableId], references: [tables.id] }),
  openedByEmployee: one(employees, { fields: [tableSessions.openedBy], references: [employees.id] }),
  orders: many(orders),
  items: many(orderItems),
  payments: many(payments),
}));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  session: one(tableSessions, { fields: [orders.sessionId], references: [tableSessions.id] }),
  employee: one(employees, { fields: [orders.employeeId], references: [employees.id] }),
  items: many(orderItems),
}));
export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  session: one(tableSessions, { fields: [orderItems.sessionId], references: [tableSessions.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
  modifiers: many(orderItemModifiers),
  printStation: one(printStations, { fields: [orderItems.printStationId], references: [printStations.id] }),
}));
export const orderItemModifiersRelations = relations(orderItemModifiers, ({ one }) => ({
  item: one(orderItems, { fields: [orderItemModifiers.orderItemId], references: [orderItems.id] }),
}));
export const paymentsRelations = relations(payments, ({ one }) => ({
  session: one(tableSessions, { fields: [payments.sessionId], references: [tableSessions.id] }),
  employee: one(employees, { fields: [payments.employeeId], references: [employees.id] }),
}));
export const ingredientsRelations = relations(ingredients, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [ingredients.supplierId], references: [suppliers.id] }),
  recipeLines: many(recipeLines),
  movements: many(stockMovements),
}));
export const recipeLinesRelations = relations(recipeLines, ({ one }) => ({
  product: one(products, { fields: [recipeLines.productId], references: [products.id] }),
  modifier: one(modifiers, { fields: [recipeLines.modifierId], references: [modifiers.id] }),
  ingredient: one(ingredients, { fields: [recipeLines.ingredientId], references: [ingredients.id] }),
}));
export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  ingredient: one(ingredients, { fields: [stockMovements.ingredientId], references: [ingredients.id] }),
  employee: one(employees, { fields: [stockMovements.employeeId], references: [employees.id] }),
}));
export const suppliersRelations = relations(suppliers, ({ many }) => ({ ingredients: many(ingredients) }));
export const employeesRelations = relations(employees, ({ many }) => ({ orders: many(orders) }));
export const printStationsRelations = relations(printStations, ({ many }) => ({ jobs: many(printJobs) }));
export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [goodsReceipts.supplierId], references: [suppliers.id] }),
  lines: many(goodsReceiptLines),
}));
export const goodsReceiptLinesRelations = relations(goodsReceiptLines, ({ one }) => ({
  receipt: one(goodsReceipts, { fields: [goodsReceiptLines.receiptId], references: [goodsReceipts.id] }),
  ingredient: one(ingredients, { fields: [goodsReceiptLines.ingredientId], references: [ingredients.id] }),
}));
export const printJobsRelations = relations(printJobs, ({ one }) => ({
  station: one(printStations, { fields: [printJobs.stationId], references: [printStations.id] }),
}));
