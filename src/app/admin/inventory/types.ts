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
};

export type Supplier = { id: number; name: string; vatNumber: string | null; phone: string | null; email: string | null; notes: string | null; active: boolean };
