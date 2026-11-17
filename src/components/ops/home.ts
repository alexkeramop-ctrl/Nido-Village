/** Αρχική οθόνη ανά ρόλο μετά τη σύνδεση. Καθαρή συνάρτηση (όχι server action). */
export function homeFor(role: string): string {
  switch (role) {
    case "kitchen":
      return "/pda";
    // Self-service: ταμίας και υπεύθυνος ξεκινούν από το ταμείο.
    case "cashier":
    case "manager":
      return "/cashier";
    case "waiter":
      return "/pda";
    default:
      return "/admin";
  }
}
