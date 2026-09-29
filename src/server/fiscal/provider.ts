/**
 * Διεπαφή προς πάροχο ΥΠΑΗΕΣ (ή ΦΗΜ).
 *
 * Στη Φάση 1 χρησιμοποιείται ο NoopFiscalProvider: καταγράφει ΤΙ θα έπρεπε να
 * εκδοθεί (δελτίο παραγγελίας 8.6, απόδειξη 11.1) χωρίς να εκδίδει τίποτα.
 * Η νόμιμη απόδειξη βγαίνει από την υπάρχουσα ταμειακή μέχρι να συνδεθεί πάροχος.
 *
 * Όταν επιλεγεί πάροχος, υλοποιείται αυτή η διεπαφή (π.χ. EpsilonDigitalProvider)
 * και αλλάζει μόνο το getFiscalProvider().
 */

export type FiscalLine = {
  name: string;
  qty: number;
  unitPriceCents: number; // με ΦΠΑ
  vatRatePct: number;
  mydataVatCategory: number | null;
};

export type OrderSlipRequest = {
  sessionId: number;
  orderId: number;
  tableName: string;
  employeeName: string;
  lines: FiscalLine[];
  issuedAt: Date;
};

export type ReceiptRequest = {
  sessionId: number;
  tableName: string;
  lines: FiscalLine[];
  discountCents: number;
  totalCents: number;
  payments: { method: "cash" | "card" | "other"; amountCents: number; posTransactionId?: string | null }[];
  issuedAt: Date;
};

export type FiscalResult =
  | { status: "not_required"; provider: string; note: string }
  | {
      status: "issued";
      provider: string;
      series?: string;
      number?: string;
      mark?: string;
      uid?: string;
      qrUrl?: string;
      raw?: unknown;
    }
  | { status: "failed"; provider: string; error: string };

export interface FiscalProvider {
  readonly name: string;
  issueOrderSlip(req: OrderSlipRequest): Promise<FiscalResult>;
  issueReceipt(req: ReceiptRequest): Promise<FiscalResult>;
}

export class NoopFiscalProvider implements FiscalProvider {
  readonly name = "none";
  async issueOrderSlip(): Promise<FiscalResult> {
    return {
      status: "not_required",
      provider: this.name,
      note: "Δεν έχει συνδεθεί πάροχος. Το δελτίο παραγγελίας εκδίδεται από την ταμειακή.",
    };
  }
  async issueReceipt(): Promise<FiscalResult> {
    return {
      status: "not_required",
      provider: this.name,
      note: "Δεν έχει συνδεθεί πάροχος. Η απόδειξη εκδίδεται από την ταμειακή.",
    };
  }
}

let current: FiscalProvider | null = null;

export function getFiscalProvider(): FiscalProvider {
  if (!current) current = new NoopFiscalProvider();
  return current;
}

/** Για tests ή για μελλοντική ρύθμιση παρόχου. */
export function setFiscalProvider(p: FiscalProvider | null) {
  current = p;
}
