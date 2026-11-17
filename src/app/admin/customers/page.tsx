import { requirePageUser } from "@/server/page-auth";
import { upcomingBirthdays } from "@/server/services/birthdays";
import { linkUnlinkedEvents, listCustomers } from "@/server/services/customers";
import { todayAthens } from "@/server/services/reports";
import { getSettings } from "@/server/services/settings";
import { CustomersView } from "./customers-view";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requirePageUser("manager", "admin");
  // Κρατήσεις που έγιναν πριν από το πελατολόγιο συνδέονται με πελάτη από το τηλέφωνό τους (δεν κάνει τίποτα όταν είναι όλες συνδεδεμένες).
  await linkUnlinkedEvents();
  const today = todayAthens();
  const [customers, birthdays, settings] = await Promise.all([listCustomers(), upcomingBirthdays(60, today), getSettings()]);
  return <CustomersView customers={customers} birthdays={birthdays} today={today} isAdmin={user.role === "admin"} venueName={settings.venueName} />;
}
