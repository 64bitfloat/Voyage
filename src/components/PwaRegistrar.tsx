"use client";

import { useEffect } from "react";

export default function PwaRegistrar() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // 既存の Service Worker キャッシュが原因で This page couldn't load になるのを防ぐため解除
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) {
          void r.unregister();
        }
      });
    }
  }, []);
  return null;
}
