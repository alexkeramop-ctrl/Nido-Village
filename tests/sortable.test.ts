import { describe, expect, it } from "vitest";
import { compareValues, sortValue } from "@/components/admin/sortable";

describe("ταξινόμηση πινάκων", () => {
  it("καταλαβαίνει ποσά, αριθμούς και ημερομηνίες", () => {
    expect(sortValue("1.234,50 €")).toBe(1234.5);
    expect(sortValue("−2.500,00 €")).toBe(-2500);
    expect(sortValue("48")).toBe(48);
    expect(sortValue("13%")).toBe(13);
    expect(sortValue("17/11/2026")).toBeGreaterThan(sortValue("16/11/2026") as number);
    expect(sortValue("Coca-Cola 330ml")).toBe("coca-cola 330ml");
  });
  it("ελληνική αλφαβητική σειρά, κενά στο τέλος", () => {
    const names = ["Ωμέγα", "Άλφα", "", "Βήτα"].map(sortValue).sort(compareValues);
    expect(names).toEqual(["άλφα", "βήτα", "ωμέγα", ""]);
  });
});
