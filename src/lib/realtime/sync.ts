"use client";

import { useEffect, useRef } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

let sbClient: SupabaseClient | null = null;

function getBrowserSupabase(): SupabaseClient | null {
  if (sbClient) return sbClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  sbClient = createClient(url, anon, { auth: { persistSession: false } });
  return sbClient;
}

/**
 * リアルタイム共同編集の同期フック（Supabase Realtime Broadcast + BroadcastChannel）
 * - Supabase 設定時: Realtime Broadcast チャンネル `trip:${tripId}` で全端末に通知
 * - 未設定時（ローカル開発）: ブラウザの BroadcastChannel で別タブ間を即座に同期
 */
export function useTripSync(tripId: string, onRemoteChange: () => void) {
  const senderIdRef = useRef<string>("");
  const supaChannelRef = useRef<RealtimeChannel | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const cbRef = useRef(onRemoteChange);

  useEffect(() => {
    cbRef.current = onRemoteChange;
  }, [onRemoteChange]);

  useEffect(() => {
    senderIdRef.current = crypto.randomUUID();
    const channelName = `trip:${tripId}`;

    // 同一ブラウザの別タブ同期
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(channelName);
      bc.onmessage = (ev) => {
        if (ev.data?.senderId && ev.data.senderId !== senderIdRef.current) {
          cbRef.current();
        }
      };
      bcRef.current = bc;
    }

    // Supabase Realtime Broadcast（複数端末間）
    const sb = getBrowserSupabase();
    if (sb) {
      const ch = sb.channel(channelName, { config: { broadcast: { self: false } } });
      ch.on("broadcast", { event: "trip-updated" }, (payload) => {
        if (payload?.payload?.senderId !== senderIdRef.current) {
          cbRef.current();
        }
      }).subscribe();
      supaChannelRef.current = ch;
    }

    // 定期ポーリング（4秒ごと・タブがアクティブな時のみ）で確実に双方のブラウザを同期
    const pollTimer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        cbRef.current();
      }
    }, 4000);

    return () => {
      clearInterval(pollTimer);
      bcRef.current?.close();
      bcRef.current = null;
      if (supaChannelRef.current && sb) {
        sb.removeChannel(supaChannelRef.current);
        supaChannelRef.current = null;
      }
    };
  }, [tripId]);

  const notifyChange = () => {
    const msg = { senderId: senderIdRef.current, ts: Date.now() };
    bcRef.current?.postMessage(msg);
    supaChannelRef.current?.send({
      type: "broadcast",
      event: "trip-updated",
      payload: msg,
    });
  };

  return { notifyChange };
}
