/**
 * Παραγωγή bytes ESC/POS από TicketDoc.
 * Ελληνικά: επιλογή κωδικοσελίδας στον εκτυπωτή (ESC t n) και κωδικοποίηση με iconv-lite.
 * Οι αριθμοί κωδικοσελίδας ακολουθούν τον πίνακα Epson (οι περισσότεροι κλώνοι τον σέβονται).
 */
import iconv from "iconv-lite";
import type { Codepage } from "@/db/schema";
import { renderText, upperGreek, wrap, type TicketDoc } from "./ticket";

const ESC = 0x1b;
const GS = 0x1d;

const CODEPAGE_NUMBER: Record<Codepage, number> = {
  cp737: 14, // PC737 Greek
  cp1253: 47, // WPC1253 Greek
  "iso8859-7": 15,
};

const ICONV_NAME: Record<Codepage, string> = {
  cp737: "cp737",
  cp1253: "win1253",
  "iso8859-7": "iso88597",
};

export type EscposOptions = {
  codepage: Codepage;
  columns: number;
  cutter: boolean;
  drawerKick: boolean;
};

function sanitize(text: string, codepage: Codepage): string {
  let t = text.normalize("NFC");
  if (codepage === "cp737") t = t.replace(/€/g, "EUR");
  // Τόνοι σε κεφαλαία δεν υπάρχουν σε κάποιες σελίδες· τα NFC κεφαλαία με τόνο (Ά, Έ…) υπάρχουν στο cp737.
  return t;
}

export function encodeText(text: string, codepage: Codepage): Buffer {
  return iconv.encode(sanitize(text, codepage), ICONV_NAME[codepage]);
}

class Bytes {
  private chunks: Buffer[] = [];
  push(...b: (number[] | Buffer)[]) {
    for (const x of b) this.chunks.push(Buffer.isBuffer(x) ? x : Buffer.from(x));
    return this;
  }
  build() {
    return Buffer.concat(this.chunks);
  }
}

export function buildEscpos(doc: TicketDoc, opt: EscposOptions): Buffer {
  const b = new Bytes();
  const cp = opt.codepage;
  b.push([ESC, 0x40]); // init
  b.push([ESC, 0x74, CODEPAGE_NUMBER[cp]]); // ESC t n
  b.push([ESC, 0x52, 0x00]); // international charset: USA (χωρίς αντικαταστάσεις)

  const setAlign = (a: "left" | "center" | "right" = "left") =>
    b.push([ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0]);
  const setBold = (on: boolean) => b.push([ESC, 0x45, on ? 1 : 0]);
  const setSize = (size: 1 | 2 | 3) => b.push([GS, 0x21, size === 3 ? 0x22 : size === 2 ? 0x11 : 0x00]);
  const setUnderline = (on: boolean) => b.push([ESC, 0x2d, on ? 1 : 0]);
  const line = (txt: string) => b.push(encodeText(txt, cp), [0x0a]);

  for (const l of doc.lines) {
    switch (l.t) {
      case "text": {
        const size = l.size ?? 1;
        const w = Math.max(8, Math.floor(opt.columns / (size >= 2 ? 2 : 1)));
        setAlign(l.align);
        setBold(!!l.bold);
        setSize(size);
        setUnderline(!!l.underline);
        for (const t of wrap(size >= 2 ? upperGreek(l.text) : l.text, w)) line(t);
        setUnderline(false);
        setSize(1);
        setBold(false);
        setAlign("left");
        break;
      }
      case "row": {
        // Χρησιμοποιούμε την ίδια λογική στοίχισης με το κείμενο ώστε ό,τι βλέπεις στην προεπισκόπηση να τυπώνεται.
        const size = l.size ?? 1;
        setAlign("left");
        setBold(!!l.bold);
        setSize(size);
        const txt = renderText({ lines: [{ t: "row", left: l.left, right: l.right, size }] }, opt.columns);
        for (const t of txt.split("\n")) line(t);
        setSize(1);
        setBold(false);
        break;
      }
      case "hr":
        line((l.char ?? "-").repeat(opt.columns));
        break;
      case "feed":
        b.push([ESC, 0x64, Math.min(255, Math.max(1, l.n ?? 1))]);
        break;
      case "qr": {
        const data = Buffer.from(l.data, "utf8");
        const size = Math.min(16, Math.max(1, l.size ?? 6));
        setAlign("center");
        b.push([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); // model 2
        b.push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]); // module size
        b.push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]); // error correction M
        const len = data.length + 3;
        b.push([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30], data); // store
        b.push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]); // print
        setAlign("left");
        break;
      }
      case "image": {
        // GS v 0: raster bitmap, 1 bit ανά pixel, γραμμές πλάτους ceil(width/8) bytes.
        const bytesPerRow = Math.ceil(l.width / 8);
        const data = Buffer.from(l.data, "base64");
        if (data.length !== bytesPerRow * l.height) break;
        setAlign("center");
        b.push([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, l.height & 0xff, (l.height >> 8) & 0xff], data);
        b.push([0x0a]);
        setAlign("left");
        break;
      }
      case "cut":
        b.push([ESC, 0x64, 0x04]);
        if (opt.cutter) b.push([GS, 0x56, 0x01]); // partial cut
        break;
      case "drawer":
        if (opt.drawerKick) b.push([ESC, 0x70, 0x00, 0x19, 0xfa]);
        break;
      case "beep":
        b.push([ESC, 0x42, 0x02, 0x02]); // ESC B n t (υποστηρίζεται από πολλούς κλώνους, αγνοείται από τους υπόλοιπους)
        break;
    }
  }
  return b.build();
}
