"use client";
import { useEffect } from "react";

/** Καταχώρηση του service worker (εγκατάσταση ως εφαρμογή + σελίδα «εκτός σύνδεσης»). */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
