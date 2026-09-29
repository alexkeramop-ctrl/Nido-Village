"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { cancelPrintJob, checkStationHealth, printTestPage, retryPrintJob, upsertStation } from "@/server/services/printers";
import type { Codepage, PrintDriver, StationKind } from "@/db/schema";

const KINDS: StationKind[] = ["kitchen", "bar", "receipt"];
const DRIVERS: PrintDriver[] = ["console", "tcp"];
const CODEPAGES: Codepage[] = ["cp737", "cp1253", "iso8859-7"];

export async function saveStationAction(input: {
  id?: number;
  name: string;
  kind: string;
  driver: string;
  host: string;
  port: number;
  codepage: string;
  columns: number;
  cutter: boolean;
  drawerKick: boolean;
  enabled: boolean;
  sort: number;
}) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!KINDS.includes(input.kind as StationKind)) throw new Error("Μη έγκυρος τύπος σταθμού");
    if (!DRIVERS.includes(input.driver as PrintDriver)) throw new Error("Μη έγκυρος driver");
    if (!CODEPAGES.includes(input.codepage as Codepage)) throw new Error("Μη έγκυρη κωδικοσελίδα");
    if (input.port < 1 || input.port > 65535) throw new Error("Μη έγκυρη θύρα");
    await upsertStation({
      id: input.id,
      name: input.name,
      kind: input.kind as StationKind,
      driver: input.driver as PrintDriver,
      host: input.host,
      port: input.port,
      codepage: input.codepage as Codepage,
      columns: input.columns,
      cutter: input.cutter,
      drawerKick: input.drawerKick,
      enabled: input.enabled,
      sort: input.sort,
    });
    revalidatePath("/admin/printers");
    revalidatePath("/admin/menu");
  });
}

export async function printTestPageAction(stationId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    const job = await printTestPage(stationId);
    revalidatePath("/admin/printers");
    return job.id;
  });
}

export async function checkStationHealthAction(stationId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    const ok = await checkStationHealth(stationId);
    revalidatePath("/admin/printers");
    return ok;
  });
}

export async function retryPrintJobAction(jobId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    await retryPrintJob(jobId);
    revalidatePath("/admin/printers");
  });
}

export async function cancelPrintJobAction(jobId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    await cancelPrintJob(jobId);
    revalidatePath("/admin/printers");
  });
}
