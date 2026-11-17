import { cookies } from "next/headers";

/** Το ταμείο που έχει επιλεγεί σε αυτή τη συσκευή (π.χ. το tablet του «Ταμείο 1» ανοίγει πάντα στο ταμείο του). */
export const REGISTER_COOKIE = "nido_register";

export async function readRegisterCookie(): Promise<number | null> {
  const raw = (await cookies()).get(REGISTER_COOKIE)?.value;
  const id = Number(raw);
  return raw && Number.isInteger(id) && id > 0 ? id : null;
}
