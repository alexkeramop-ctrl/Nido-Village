/**
 * Μοντέλο εγγράφου εκτύπωσης, ανεξάρτητο από εκτυπωτή.
 * Από αυτό παράγονται (α) απλό κείμενο για προεπισκόπηση/console και (β) bytes ESC/POS.
 */
export type Align = "left" | "center" | "right";

export type TicketLine =
  | { t: "text"; text: string; align?: Align; bold?: boolean; size?: 1 | 2 | 3; underline?: boolean }
  | { t: "row"; left: string; right: string; bold?: boolean; size?: 1 | 2 }
  | { t: "hr"; char?: string }
  | { t: "feed"; n?: number }
  | { t: "qr"; data: string; size?: number }
  | { t: "image"; width: number; height: number; data: string; label?: string }
  | { t: "cut" }
  | { t: "drawer" }
  | { t: "beep" };

export type TicketDoc = { lines: TicketLine[] };

export class Ticket {
  readonly lines: TicketLine[] = [];
  text(text: string, o: Omit<Extract<TicketLine, { t: "text" }>, "t" | "text"> = {}) {
    this.lines.push({ t: "text", text, ...o });
    return this;
  }
  title(text: string) {
    return this.text(text, { align: "center", bold: true, size: 2 });
  }
  center(text: string, bold = false) {
    return this.text(text, { align: "center", bold });
  }
  row(left: string, right: string, o: { bold?: boolean; size?: 1 | 2 } = {}) {
    this.lines.push({ t: "row", left, right, ...o });
    return this;
  }
  hr(char = "-") {
    this.lines.push({ t: "hr", char });
    return this;
  }
  feed(n = 1) {
    this.lines.push({ t: "feed", n });
    return this;
  }
  qr(data: string, size = 6) {
    this.lines.push({ t: "qr", data, size });
    return this;
  }
  image(img: { width: number; height: number; data: string; label?: string }) {
    this.lines.push({ t: "image", ...img });
    return this;
  }
  cut() {
    this.lines.push({ t: "cut" });
    return this;
  }
  drawer() {
    this.lines.push({ t: "drawer" });
    return this;
  }
  beep() {
    this.lines.push({ t: "beep" });
    return this;
  }
  doc(): TicketDoc {
    return { lines: [...this.lines] };
  }
}

/** Κεφαλαία χωρίς τόνους, όπως γράφονται τα ελληνικά κεφαλαία σε τίτλους. */
export function upperGreek(text: string): string {
  return text.toUpperCase().normalize("NFD").replace(/[\u0301\u0308\u0342]/g, "").normalize("NFC");
}

/** Σπάει κείμενο σε γραμμές μέγιστου πλάτους (σε χαρακτήρες). */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      if (w.length > width) {
        if (line) {
          out.push(line);
          line = "";
        }
        for (let i = 0; i < w.length; i += width) out.push(w.slice(i, i + width));
        continue;
      }
      if ((line + " " + w).trim().length > width) {
        out.push(line);
        line = w;
      } else line = (line ? line + " " : "") + w;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

function pad(text: string, width: number, align: Align): string {
  if (text.length >= width) return text.slice(0, width);
  const space = width - text.length;
  if (align === "right") return " ".repeat(space) + text;
  if (align === "center") {
    const l = Math.floor(space / 2);
    return " ".repeat(l) + text + " ".repeat(space - l);
  }
  return text + " ".repeat(space);
}

/** Απόδοση σε απλό κείμενο (για console driver, προεπισκόπηση, tests). */
export function renderText(doc: TicketDoc, columns: number): string {
  const out: string[] = [];
  for (const l of doc.lines) {
    switch (l.t) {
      case "text": {
        const size = l.size ?? 1;
        const w = Math.max(8, Math.floor(columns / (size >= 2 ? 2 : 1)));
        const txt = size >= 2 ? upperGreek(l.text) : l.text;
        for (const line of wrap(txt, w)) out.push(pad(line, w, l.align ?? "left").replace(/\s+$/, ""));
        break;
      }
      case "row": {
        const w = l.size === 2 ? Math.floor(columns / 2) : columns;
        const right = l.right;
        const leftW = Math.max(1, w - right.length - 1);
        const leftLines = wrap(l.left, leftW);
        leftLines.forEach((ll, i) => {
          if (i === leftLines.length - 1) out.push(pad(ll, leftW, "left") + " " + right);
          else out.push(ll);
        });
        break;
      }
      case "hr":
        out.push((l.char ?? "-").repeat(columns));
        break;
      case "feed":
        for (let i = 0; i < (l.n ?? 1); i++) out.push("");
        break;
      case "qr":
        out.push(`[QR: ${l.data}]`);
        break;
      case "image":
        out.push(pad(`[${l.label ?? "ΕΙΚΟΝΑ"} ${l.width}x${l.height}]`, columns, "center").replace(/\s+$/, ""));
        break;
      case "cut":
        out.push("~~~~~~~~ ✂ ~~~~~~~~");
        break;
      case "drawer":
        out.push("[ΣΥΡΤΑΡΙ]");
        break;
      case "beep":
        out.push("[BEEP]");
        break;
    }
  }
  return out.join("\n");
}
