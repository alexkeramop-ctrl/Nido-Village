import { requirePageUser } from "@/server/page-auth";
import { hasRole } from "@/server/auth";
import { getMenu, menuVersion } from "@/server/services/catalog";
import { deviceRegister } from "@/server/services/device-register";
import { tillSnapshot, topProducts } from "@/server/services/till";
import { Shell } from "@/components/shell";
import { OpenShiftPanel, RegisterPicker } from "./shift-panels";
import { TillScreen } from "./till-screen";

export const dynamic = "force-dynamic";

/**
 * Ταμείο self-service. Τρεις καταστάσεις: (1) η συσκευή δεν έχει διαλέξει ταμείο, (2) το ταμείο δεν έχει ανοιχτή βάρδια,
 * (3) γρήγορη πώληση. Ο κατάλογος φορτώνεται εδώ ΜΙΑ φορά και μένει στον browser.
 */
export default async function CashierPage() {
  const user = await requirePageUser("cashier", "manager", "admin");
  const { registers, register } = await deviceRegister();
  if (!register) {
    return (
      <Shell user={user} active="/cashier" title="Ταμείο">
        <RegisterPicker
          isAdmin={user.role === "admin"}
          registers={registers.map((r) => ({ id: r.id, name: r.name, openShift: r.openShift ? { openedAt: r.openShift.openedAt.toISOString(), openedBy: r.openShift.openedBy } : null }))}
        />
      </Shell>
    );
  }
  if (!register.openShift) {
    return (
      <Shell user={user} active="/cashier" title="Ταμείο">
        <OpenShiftPanel key={register.id} register={{ id: register.id, name: register.name }} canSwitch={registers.length > 1} />
      </Shell>
    );
  }
  // Το αποτύπωμα διαβάζεται ΠΡΙΝ από το μενού: αν αλλάξει κάτι ενδιάμεσα, το ταμείο θα δει διαφορά και θα ξαναφορτώσει
  // (το αντίθετο θα «σφράγιζε» παλιό μενού με νέο αποτύπωμα και η αλλαγή θα χανόταν).
  const catalogVersion = await menuVersion();
  const [menu, frequentIds, snapshot] = await Promise.all([getMenu(), topProducts(), tillSnapshot(register.id)]);
  return (
    <Shell user={user} active="/cashier" title="Ταμείο">
      <TillScreen
        key={`${register.id}-${register.openShift.id}`}
        register={{ id: register.id, name: register.name }}
        userName={user.name}
        canDiscount={hasRole(user, "manager")}
        menu={menu}
        catalogVersion={catalogVersion}
        frequentIds={frequentIds}
        initial={snapshot}
      />
    </Shell>
  );
}
