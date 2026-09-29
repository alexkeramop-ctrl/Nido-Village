/**
 * Οδηγοί εξόδου: TCP (raw 9100) για πραγματικούς εκτυπωτές, console για ανάπτυξη.
 */
import net from "node:net";

export type PrintTarget = { driver: "tcp"; host: string; port: number } | { driver: "console"; name: string };

export async function sendToPrinter(target: PrintTarget, bytes: Buffer, text: string): Promise<void> {
  if (target.driver === "console") {
    console.log(`\n┌── ΕΚΤΥΠΩΣΗ [${target.name}] ──\n${text}\n└──────────────────\n`);
    return;
  }
  await sendTcp(target.host, target.port, bytes, 6000);
}

export function sendTcp(host: string, port: number, bytes: Buffer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`Timeout προς ${host}:${port}`)));
    socket.once("error", (e) => finish(e));
    socket.connect(port, host, () => {
      socket.write(bytes, (e) => {
        if (e) return finish(e);
        socket.end(() => finish());
      });
    });
  });
}

/** Γρήγορος έλεγχος υγείας: ανοίγει και κλείνει σύνδεση. */
export function checkTcp(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const end = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => end(false));
    socket.once("error", () => end(false));
    socket.connect(port, host, () => end(true));
  });
}
