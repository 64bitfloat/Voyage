"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, MapPin, Plus } from "lucide-react";
import type { DayRow, SpotRow } from "@/lib/model/types";
import { searchPlaces, reverseGeocode, type GeocodeResult } from "@/lib/geo/geocode";

const CATEGORY_COLOR: Record<SpotRow["category"], string> = {
  sightseeing: "#2563eb",
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

function MapTapHandler({ onTap }: { onTap: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onTap(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapFlyTo({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
    }
  }, [map, target]);
  return null;
}

export interface PendingPin {
  lat: number;
  lng: number;
  name: string;
  address: string;
}

interface TripMapProps {
  day: DayRow;
  spots: SpotRow[];
  onPickPlace: (pin: PendingPin) => void;
  onSelectSpot: (spot: SpotRow) => void;
}

export default function TripMap({ day, spots, onPickPlace, onSelectSpot }: TripMapProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<PendingPin | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);

  const pinnedSpots = spots.filter((s) => s.lat !== null && s.lng !== null);
  const defaultCenter: [number, number] =
    pinnedSpots.length > 0
      ? [pinnedSpots[0].lat!, pinnedSpots[0].lng!]
      : day.departure_lat !== null && day.departure_lng !== null
        ? [day.departure_lat, day.departure_lng]
        : [35.49, 138.6]; // 精進湖周辺を既定表示

  const polylinePoints: [number, number][] = [
    ...(day.departure_lat !== null && day.departure_lng !== null
      ? ([[day.departure_lat, day.departure_lng]] as [number, number][])
      : []),
    ...pinnedSpots.map((s) => [s.lat!, s.lng!] as [number, number]),
  ];

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await searchPlaces(query);
      setResults(r);
      if (r[0]) {
        const p = { lat: r[0].lat, lng: r[0].lng, name: r[0].name, address: r[0].address };
        setPending(p);
        setFlyTarget({ lat: p.lat, lng: p.lng });
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleMapTap(lat: number, lng: number) {
    const roundedLat = Number(lat.toFixed(6));
    const roundedLng = Number(lng.toFixed(6));
    setPending({
      lat: roundedLat,
      lng: roundedLng,
      name: "選択した地点",
      address: `${roundedLat}, ${roundedLng}`,
    });
    const rev = await reverseGeocode(roundedLat, roundedLng).catch(() => null);
    if (rev) {
      setPending({
        lat: roundedLat,
        lng: roundedLng,
        name: rev.name || "選択した地点",
        address: rev.address,
      });
    }
  }

  return (
    <div className="relative h-full w-full select-none isolate overflow-hidden">
      {/* 地図上の検索バー */}
      <div className="
        absolute top-2.5 left-2.5 right-2.5 z-[1000]
        flex flex-col gap-1.5 pointer-events-auto
      ">
        <form onSubmit={handleSearch} className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="場所を検索、または地図をタップしてピン留め..."
              className="
                w-full pl-9 pr-3 py-2 text-sm rounded-xl
                bg-white/95 text-neutral-900 shadow-md border border-neutral-200
                focus:outline-none focus:ring-2 focus:ring-blue-500
              "
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="
              px-3.5 py-2 rounded-xl text-xs font-semibold
              bg-blue-600 text-white shadow-md hover:bg-blue-700 disabled:opacity-50
            "
          >
            {searching ? "..." : "検索"}
          </button>
        </form>

        {results.length > 0 && (
          <div className="bg-white/95 rounded-xl shadow-lg border border-neutral-200 max-h-40 overflow-y-auto divide-y divide-neutral-100">
            {results.map((r, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  const p = { lat: r.lat, lng: r.lng, name: r.name, address: r.address };
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

      {/* 仮ピン選択時の下部フローティングバー */}
      {pending && (
        <div className="
          absolute bottom-2.5 left-2.5 right-2.5 z-[1000]
          bg-white/95 backdrop-blur rounded-xl shadow-lg border border-neutral-200
          p-2.5 flex items-center justify-between gap-2
        ">
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
              className="
                inline-flex items-center gap-1 px-3 py-1.5 rounded-lg
                bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700
              "
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
        <MapTapHandler onTap={handleMapTap} />
        <MapFlyTo target={flyTarget} />

        {day.departure_lat !== null && day.departure_lng !== null && (
          <Marker position={[day.departure_lat, day.departure_lng]} icon={departureIcon}>
            <Popup>
              <div className="text-xs font-semibold">出発: {day.departure_point || "出発地点"}</div>
            </Popup>
          </Marker>
        )}

        {spots.map((s, idx) =>
          s.lat !== null && s.lng !== null ? (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={makeNumberIcon(idx + 1, CATEGORY_COLOR[s.category], s.status)}
              eventHandlers={{ click: () => onSelectSpot(s) }}
            >
              <Popup>
                <div className="text-xs font-bold">{idx + 1}. {s.name}</div>
                {s.address && <div className="text-[11px] text-neutral-500">{s.address}</div>}
              </Popup>
            </Marker>
          ) : null,
        )}

        {pending && (
          <Marker position={[pending.lat, pending.lng]} icon={pendingIcon} />
        )}

        {polylinePoints.length >= 2 && (
          <Polyline positions={polylinePoints} pathOptions={{ color: "#2563eb", weight: 3, dashArray: "6 6" }} />
        )}
      </MapContainer>
    </div>
  );
}
