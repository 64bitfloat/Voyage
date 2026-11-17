"use client";

import { useRef, useState } from "react";
import { Camera, Trash2, MapPin, Calendar } from "lucide-react";
import type { DayRow, ParticipantRow, PhotoRow, SpotRow } from "@/lib/model/types";
import { compressImageFile } from "@/lib/photo/compress";
import { toTokyoHHMM, toTokyoISO } from "@/lib/datetime";

interface PolaroidGalleryProps {
  day: DayRow;
  spots: SpotRow[];
  photos: PhotoRow[];
  participants: ParticipantRow[];
  onAddPhoto: (photo: PhotoRow) => Promise<void>;
  onDeletePhoto: (photoId: string) => Promise<void>;
}

const ROTATIONS = ["-rotate-1", "rotate-1", "-rotate-2", "rotate-2", "rotate-0"];

export default function PolaroidGallery({
  day,
  spots,
  photos,
  participants,
  onAddPhoto,
  onDeletePhoto,
}: PolaroidGalleryProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [targetSpotId, setTargetSpotId] = useState<string>(""); // 空文字 = 日程全体（day_index紐付け）
  const [caption, setCaption] = useState("");
  const [nickname, setNickname] = useState(participants[0]?.nickname ?? "");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const spotIdSet = new Set(spots.map((s) => s.id));
  const dayPhotos = photos.filter(
    (p) => (p.spot_id && spotIdSet.has(p.spot_id)) || (p.spot_id === null && p.day_index === day.day_index),
  );

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const dataUrl = await compressImageFile(file);
      const photo: PhotoRow = {
        id: crypto.randomUUID(),
        spot_id: targetSpotId || null,
        day_index: day.day_index,
        url: dataUrl,
        caption: caption.trim(),
        photographer_nickname: nickname.trim() || "メンバー",
        taken_at: toTokyoISO(new Date()),
      };
      await onAddPhoto(photo);
      setCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "写真の追加に失敗しました");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-3xl bg-amber-50/60 border border-amber-200/80 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-amber-600" />
            <span>思い出チェキ・タイムライン（{day.label}）</span>
          </h3>
          <p className="text-[11px] text-amber-800/80">
            写真は必ずスポットまたはこの日程（{day.label}）に紐付けて保存されます
          </p>
        </div>
        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900">
          {dayPhotos.length} 枚
        </span>
      </div>

      {/* 投稿バー */}
      <div className="bg-white rounded-2xl border border-amber-200 p-3 space-y-2.5 shadow-2xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
              紐付け先（スポット または 日程）*
            </label>
            <select
              value={targetSpotId}
              onChange={(e) => setTargetSpotId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="">📅 {day.label} 全体に紐付ける</option>
              {spots.map((s, idx) => (
                <option key={s.id} value={s.id}>
                  📍 {idx + 1}. {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
              投稿者ニックネーム
            </label>
            <input
              type="text"
              list={`nicknames-${day.day_index}`}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="例: りん"
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs"
            />
            <datalist id={`nicknames-${day.day_index}`}>
              {participants.map((p) => (
                <option key={p.id} value={p.nickname || p.full_name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
              一言コメント
            </label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="例: 富士山がくっきり！"
              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          {err ? <span className="text-xs text-red-600">{err}</span> : <span className="text-[11px] text-slate-400">自動でリサイズ圧縮されます</span>}
          <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-600 text-white text-xs font-bold shadow-xs hover:bg-amber-700 cursor-pointer">
            <Camera className="w-3.5 h-3.5" />
            <span>{uploading ? "圧縮・保存中..." : "チェキ写真を追加"}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* チェキ（ポラロイド）風グリッド */}
      {dayPhotos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
          {dayPhotos.map((ph, idx) => {
            const linkedSpot = ph.spot_id ? spots.find((s) => s.id === ph.spot_id) : null;
            const rot = ROTATIONS[idx % ROTATIONS.length];
            return (
              <div
                key={ph.id}
                className={`group relative bg-white p-2.5 pb-4 rounded-xl shadow-md border border-slate-200/90 transition hover:rotate-0 hover:scale-[1.02] ${rot}`}
              >
                <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ph.url}
                    alt={ph.caption || "思い出写真"}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500">
                    <span className="inline-flex items-center gap-0.5 truncate font-semibold text-amber-800">
                      {linkedSpot ? (
                        <>
                          <MapPin className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{linkedSpot.name}</span>
                        </>
                      ) : (
                        <>
                          <Calendar className="w-2.5 h-2.5 shrink-0" />
                          <span>{day.label}</span>
                        </>
                      )}
                    </span>
                    {ph.taken_at && <span className="font-mono shrink-0">{toTokyoHHMM(ph.taken_at)}</span>}
                  </div>
                  <p className="text-xs font-bold text-slate-800 line-clamp-2 min-h-[1.25rem]">
                    {ph.caption || " "}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>by {ph.photographer_nickname || "メンバー"}</span>
                    <button
                      type="button"
                      onClick={() => onDeletePhoto(ph.id)}
                      className="opacity-70 hover:opacity-100 text-red-500 p-0.5"
                      title="写真を削除"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
