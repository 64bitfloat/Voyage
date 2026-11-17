"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, MapPin, Plus, Clock, Edit3 } from "lucide-react";
import type { DayRow, SpotRow } from "@/lib/model/types";
import type { SpotTiming } from "@/lib/schedule/compute";
import { toTokyoHHMM } from "@/lib/datetime";
import { searchPlaces, type GeocodeResult } from "@/lib/geo/geocode";

const CATEGORY_COLOR: Record<SpotRow["category"], string> = {
  sightseeing: "#2563eb",
  onsen: "#e11d48",
  meal: "#ea580c",
  lodging: "#7c3aed",
  transport: "#0891b2",
  shopping: "#db2777",
  other: "#4b5563",
};

function makeNumberIcon(num: number, color: string, status: SpotRow["status"]) {
  const border = status === "decided" ? "#ffffff" : status === "candidate" ? "#fde047" : "#9ca3af";
  const opacity = status === "undecided" ? 0.65 : 1;
  return L.divIcon({
    className: "voyage-pin",
    html: `<div style="
      width:28px;height:28px;border-radius:9999px;
      background:${color};color:#fff;font-weight:700;font-size:13px;
      display:flex;align-items:center;justify-content:center;
      border:2.5px solid ${border};opacity:${opacity};
      box-shadow:0 2px 6px rgba(0,0,0,0.35);
    ">${num}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const departureIcon = L.divIcon({
  className: "voyage-pin-dep",
  html: `<div style="
    width:26px;height:26px;border-radius:6px;
    background:#16a34a;color:#fff;font-weight:700;font-size:11px;
    display:flex;align-items:center;justify-content:center;
    border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);
  ">発</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const pendingIcon = L.divIcon({
  className: "voyage-pin-pending",
  html: `<div style="
    width:30px;height:30px;border-radius:9999px;
    background:#ef4444;color:#fff;font-weight:700;font-size:16px;
    display:flex;align-items:center;justify-content:center;
    border:3px solid #fff;box-shadow:0 2px 8px rgba(239,68,68,0.55);
  ">＋</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function MapFlyTo({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
    }
  }, [map, target]);
  return null;
}

/** 登録されているすべてのピンが画面にちょうどよく収まるよう自動調整する */
function MapFitBounds({ pointsKey, points }: { pointsKey: string; points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(points, { paddingTopLeft: [48, 84], paddingBottomRight: [48, 48], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pointsKey]);
  return null;
}

/**
 * マーカーがタップされて吹き出し（Popup）が開いたとき、
 * 上部の検索バーに隠れないよう、ピンが画面のやや下（吹き出しが画面中央）に来るように地図を移動する
 */
function MapPanToMarker({
  target,
}: {
  target: { lat: number; lng: number; seq: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    const zoom = map.getZoom();
    const point = map.project([target.lat, target.lng], zoom);
    const size = map.getSize();
    // 画面高さの約18%分だけ中心を北（画面上方向）へずらす → ピンが画面下寄りになり、上の吹き出しが画面中央に来る
    const offsetY = Math.min(130, Math.round(size.y * 0.18));
    const shiftedCenter = map.unproject([point.x, point.y - offsetY], zoom);
    map.panTo(shiftedCenter, { animate: true, duration: 0.4 });
  }, [map, target]);
  return null;
}

export interface PendingPin {
  lat: number;
  lng: number;
  name: string;
  address: string;
  opening_hours?: string | null;
}

interface TripMapProps {
  day: DayRow;
  spots: SpotRow[];
  timings?: Record<string, SpotTiming>;
  checkoutSpot?: SpotRow | null;
  onPickPlace: (pin: PendingPin) => void;
  onSelectSpot: (spot: SpotRow) => void;
}

export default function TripMap({
  day,
  spots,
  timings,
  checkoutSpot,
  onPickPlace,
  onSelectSpot,
}: TripMapProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<PendingPin | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [panTarget, setPanTarget] = useState<{ lat: number; lng: number; seq: number } | null>(null);

  const depLat = day.departure_lat ?? checkoutSpot?.lat ?? null;
  const depLng = day.departure_lng ?? checkoutSpot?.lng ?? null;
  const depName = day.departure_point || checkoutSpot?.name || "出発地点";

  const pinnedSpots = spots.filter((s) => s.lat !== null && s.lng !== null);
  const defaultCenter: [number, number] =
    pinnedSpots.length > 0
      ? [pinnedSpots[0].lat!, pinnedSpots[0].lng!]
      : depLat !== null && depLng !== null
        ? [depLat, depLng]
        : [35.6812, 139.7671];

  const polylinePoints: [number, number][] = [
    ...(depLat !== null && depLng !== null ? ([[depLat, depLng]] as [number, number][]) : []),
    ...pinnedSpots.map((s) => [s.lat!, s.lng!] as [number, number]),
  ];
  const pointsKey = `${day.day_index}:${polylinePoints.map((p) => p.join(",")).join("|")}`;

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await searchPlaces(query);
      setResults(r);
      if (r[0]) {
        const p = {
          lat: r[0].lat,
          lng: r[0].lng,
          name: r[0].name,
          address: r[0].address,
          opening_hours: r[0].opening_hours ?? null,
        };
        setPending(p);
        setFlyTarget({ lat: p.lat, lng: p.lng });
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="relative h-full w-full select-none isolate overflow-hidden">
      {/* 地図上の場所名検索バー（誤タップ防止のため地図タップ追加は廃止し、位置確認＆検索のみに集中） */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-[1000] flex flex-col gap-1.5 pointer-events-auto">
        <form onSubmit={handleSearch} className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="場所名を検索して位置関係を確認..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-white/95 text-neutral-900 shadow-md border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? "..." : "検索"}
          </button>
        </form>

        {results.length > 0 && (
          <div className="bg-white/95 rounded-xl shadow-lg border border-neutral-200 max-h-44 overflow-y-auto divide-y divide-neutral-100">
            {results.map((r, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  const p = {
                    lat: r.lat,
                    lng: r.lng,
                    name: r.name,
                    address: r.address,
                    opening_hours: r.opening_hours ?? null,
                  };
                  setPending(p);
                  setFlyTarget({ lat: r.lat, lng: r.lng });
                  setResults([]);
                }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-start gap-2"
              >
                <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-neutral-900 truncate">{r.name}</div>
                  <div className="text-[11px] text-neutral-500 truncate">{r.address}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 検索結果プレビュー時の下部フローティングバー */}
      {pending && (
        <div className="absolute bottom-2.5 left-2.5 right-2.5 z-[1000] bg-white/95 backdrop-blur rounded-xl shadow-lg border border-neutral-200 p-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-neutral-900 truncate">{pending.name}</div>
            <div className="text-[11px] text-neutral-500 truncate">{pending.address}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-lg"
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={() => {
                onPickPlace(pending);
                setPending(null);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
            >
              <Plus className="w-3.5 h-3.5" />
              しおりに追加
            </button>
          </div>
        </div>
      )}

      <MapContainer
        center={defaultCenter}
        zoom={12}
        className="h-full w-full z-0"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapFitBounds pointsKey={pointsKey} points={polylinePoints} />
        <MapFlyTo target={flyTarget} />
        <MapPanToMarker target={panTarget} />

        {depLat !== null && depLng !== null && (
          <Marker position={[depLat, depLng]} icon={departureIcon}>
            <Popup autoPanPaddingTopLeft={[20, 84]}>
              <div className="text-xs font-semibold">出発: {depName}</div>
            </Popup>
          </Marker>
        )}

        {spots.map((s, idx) => {
          if (s.lat === null || s.lng === null) return null;
          const timing = timings?.[s.id];
          const nextSpot = spots[idx + 1];
          const nextTiming = nextSpot ? timings?.[nextSpot.id] : undefined;
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={makeNumberIcon(idx + 1, CATEGORY_COLOR[s.category], s.status)}
              eventHandlers={{
                click: () =>
                  setPanTarget((prev) => ({
                    lat: s.lat!,
                    lng: s.lng!,
                    seq: (prev?.seq ?? 0) + 1,
                  })),
              }}
            >
              <Popup autoPanPaddingTopLeft={[20, 84]} autoPanPaddingBottomRight={[20, 24]}>
                <div className="min-w-[190px] max-w-[240px] space-y-1.5 py-0.5">
                  <div className="text-xs font-extrabold text-slate-900 leading-snug">
                    {idx + 1}. {s.name}
                  </div>
                  {s.category === "lodging" && (s.check_in || s.check_out) ? (
                    <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-purple-800">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        IN {s.check_in ? toTokyoHHMM(s.check_in) : "未定"} / OUT{" "}
                        {s.check_out ? toTokyoHHMM(s.check_out) : "未定"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-blue-700">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        {timing?.arrival && timing?.departure
                          ? `${toTokyoHHMM(timing.arrival)} 〜 ${toTokyoHHMM(timing.departure)}（${s.stay_minutes}分）`
                          : `滞在予定 ${s.stay_minutes}分`}
                      </span>
                    </div>
                  )}
                  {nextTiming?.must_leave_prev_by && nextSpot && (
                    <div className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-900">
                      🕒 {nextTiming.must_leave_prev_by} までにここを出発
                      <div className="text-[10px] font-normal text-emerald-700 truncate">
                        （次: {nextSpot.name}）
                      </div>
                    </div>
                  )}
                  {s.address && (
                    <div className="text-[10px] text-neutral-500 line-clamp-2">{s.address}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectSpot(s)}
                    className="w-full mt-1 py-1.5 px-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 inline-flex items-center justify-center gap-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>このスポットを編集</span>
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {pending && <Marker position={[pending.lat, pending.lng]} icon={pendingIcon} />}

        {polylinePoints.length >= 2 && (
          <Polyline
            positions={polylinePoints}
            pathOptions={{ color: "#2563eb", weight: 3, dashArray: "6 6" }}
          />
        )}
      </MapContainer>
    </div>
  );
}
