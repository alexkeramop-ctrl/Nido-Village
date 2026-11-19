import { readRegisterCookie } from "@/server/register-cookie";
import { listRegisters, type RegisterRow } from "./registers";

/**
 * Το ταμείο αυτής της συσκευής: αυτό που διάλεξε (cookie) αν είναι ακόμη ενεργό·
 * αλλιώς, αν υπάρχει μόνο ΕΝΑ ενεργό ταμείο, αυτό (δεν χρειάζεται ερώτηση).
 */
export async function deviceRegister(): Promise<{ registers: RegisterRow[]; register: RegisterRow | null }> {
  const [registers, cookieId] = await Promise.all([listRegisters(), readRegisterCookie()]);
  const register = registers.find((r) => r.id === cookieId) ?? (registers.length === 1 ? registers[0] : null);
  return { registers, register };
}
