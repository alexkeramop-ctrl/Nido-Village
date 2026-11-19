/**
 * Προεπισκόπηση συνδέσμων (WhatsApp, Viber, Messenger, Facebook, X).
 * Η εικόνα είναι στατικό αρχείο στο public/brand: το σερβίρει το Cloudflare χωρίς σύνδεση και χωρίς να μεγαλώνει ο worker.
 * Αδιαφανές φόντο, γιατί σε διάφανη εικόνα το WhatsApp βάζει από κάτω το χρώμα της φούσκας του.
 */
import type { Metadata } from "next";

/** Η δημόσια διεύθυνση της εφαρμογής. Αλλάζει με τη μεταβλητή NIDO_PUBLIC_URL (π.χ. για άλλο domain). */
export function siteUrl(): URL {
  const fallback = "https://pda.nidovillage.gr";
  try {
    return new URL(process.env.NIDO_PUBLIC_URL || fallback);
  } catch {
    return new URL(fallback);
  }
}

export const SITE_NAME = "Nido Village";
export const OG_IMAGE = { url: "/brand/og-image.png", width: 1200, height: 630, type: "image/png", alt: "Nido Village · nature meets fun" };

export function shareMeta(title: string, description: string): Pick<Metadata, "description" | "openGraph" | "twitter"> {
  return {
    description,
    openGraph: { type: "website", siteName: SITE_NAME, locale: "el_GR", title, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}
