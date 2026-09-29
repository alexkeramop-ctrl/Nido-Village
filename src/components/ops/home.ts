/** Αρχική οθόνη ανά ρόλο μετά τη σύνδεση. Καθαρή συνάρτηση (όχι server action). */
export function homeFor(role: string): string {
  switch (role) {
    case "kitchen":
      return "/pda";
    case "cashier":
      return "/cashier";
    case "waiter":
      return "/pda";
    default:
      return "/admin";
  }
}
