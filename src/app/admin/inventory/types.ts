export type Ingredient = {
  id: number;
  name: string;
  unit: string;
  unitLabel: string;
  stock: number;
  min: number;
  cost: number;
  low: boolean;
  stockValueCents: number;
  supplierId: number | null;
  supplierName: string | null;
  active: boolean;
  /** Συσκευασία (π.χ. μπουκάλι 700 ml) και μερίδα (π.χ. ποτό 60 ml), αν έχουν οριστεί. */
  packSize: number | null;
  packName: string | null;
  portionQty: number | null;
  portionName: string | null;
  /** Απόθεμα σε συσκευασίες / μερίδες (null αν δεν έχει οριστεί συσκευασία / μερίδα). */
  stockPacks: number | null;
  stockPortions: number | null;
};

export type Supplier = { id: number; name: string; vatNumber: string | null; phone: string | null; email: string | null; notes: string | null; active: boolean };
