"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TileLayer, LayersControl, GeoJSON } from "react-leaflet";
import { createLeafletContext, LeafletContext } from "@react-leaflet/core";
import L from "leaflet";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type { PathOptions } from "leaflet";
import type { PhotoRecord } from "@/lib/store";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];
const COVERAGE_RADIUS_M = 80;

type TrenchStatus = "complete" | "partial" | "missing";

const QC_COLORS: Record<TrenchStatus, string> = {
  complete: "#22c55e",
  partial:  "#f59e0b",
  missing:  "#ef4444",
};

const QC_LABELS: Record<TrenchStatus, string> = {
  complete: "Complete",
  partial:  "Partial",
  missing:  "Missing",
};

const QC_DESC: Record<TrenchStatus, string> = {
  complete: "Compliant photos, GPS & depth confirmed",
  partial:  "Photos present but quality insufficient",
  missing:  "No compliant photos available",
};

const TRENCH_TYPES: Array<{ color: string; label: string }> = [
  { color: "#FE0DFF", label: "Hausanschluss" },
  { color: "#0D15FF", label: "Künette versiegelt" },
  { color: "#3B3B3B", label: "Pressung" },
  { color: "#1B7CBD", label: "Künette unversiegelt" },
  { color: "#958CCF", label: "Querung offen" },
  { color: "#CC6E84", label: "Privatstraße" },
];

const GEOJSON_FILES = {
  siteCluster: "/geojson/CLP20417A-P1-B00_SiteCluster_Polygons.geojson",
  fcpPolygons: "/geojson/CLP20417A-P1-B00_FCP_Polygons.geojson",
  fcps:        "/geojson/CLP20417A-P1-B00_FCPs.geojson",
  trenches:    "/geojson/CLP20417A-P1-B00_Trenches.geojson",
} as const;

type GeoLayers = {
  siteCluster?: FeatureCollection;
  fcpPolygons?: FeatureCollection;
  fcps?: FeatureCollection;
  trenches?: FeatureCollection;
};

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function minDistToLineString(pLat: number, pLon: number, coords: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineM(pLat, pLon, coords[i][1], coords[i][0]);
    if (d < best) best = d;
    if (i < coords.length - 1) {
      const midLat = (coords[i][1] + coords[i + 1][1]) / 2;
      const midLon = (coords[i][0] + coords[i + 1][0]) / 2;
      const dm = haversineM(pLat, pLon, midLat, midLon);
      if (dm < best) best = dm;
    }
  }
  return best;
}

function computeStatus(coords: number[][], geoPhotos: PhotoRecord[]): TrenchStatus {
  const lats = coords.map((c) => c[1]);
  const lons = coords.map((c) => c[0]);
  const pad = 0.001;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLon = Math.min(...lons) - pad;
  const maxLon = Math.max(...lons) + pad;

  const nearby = geoPhotos.filter(
    (p) =>
      p.latitude! >= minLat &&
      p.latitude! <= maxLat &&
      p.longitude! >= minLon &&
      p.longitude! <= maxLon &&
      minDistToLineString(p.latitude!, p.longitude!, coords) <= COVERAGE_RADIUS_M,
  );

  if (nearby.length === 0) return "missing";
  const analysed = nearby.filter((p) => p.analysis);
  if (analysed.length === 0) return "partial";
  const passing = analysed.filter((p) => {
    const a = p.analysis as Record<string, unknown>;
    return a.trench && a.measuringStick && a.sideView;
  });
  return passing.length / analysed.length >= 0.5 ? "complete" : "partial";
}

function propsTable(props: GeoJsonProperties, keys: string[]) {
  if (!props) return "";
  const rows = keys
    .filter((k) => props[k] != null && props[k] !== "")
    .map(
      (k) =>
        `<tr><td style="color:#59636e;padding-right:8px;font-size:10px;white-space:nowrap">${k}</td><td style="color:#1f2328;font-size:11px">${String(props[k])}</td></tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse">${rows}</table>`;
}

function fcpPolygonStyle(feature?: Feature<Geometry, GeoJsonProperties>): PathOptions {
  const color = (feature?.properties?.fillColor as string | undefined) ?? "#7c3aed";
  return { color, weight: 1.5, fillColor: color, fillOpacity: 0.08, opacity: 0.45 };
}

const clusterStyle: PathOptions = {
  color: "#7fb347",
  weight: 2,
  fillOpacity: 0.02,
  dashArray: "8 5",
  opacity: 0.6,
};

function markerColor(p: PhotoRecord): string {
  if (!p.hasGps || !p.analysis) return "#94a3b8";
  const a = p.analysis as Record<string, unknown>;
  if (a.isDuplicate || a.gpsOnSite === false) return QC_COLORS.missing;
  const keys = ["trench", "measuringStick", "sandBedding", "warningTape", "sideView"];
  if (keys.every((k) => a[k])) return QC_COLORS.complete;
  if (!a.trench || !a.sideView) return QC_COLORS.missing;
  return QC_COLORS.partial;
}

function markerCategory(p: PhotoRecord): string {
  if (!p.hasGps) return "No GPS";
  if (!p.analysis) return "Pending";
  const a = p.analysis as Record<string, unknown>;
  if (a.isDuplicate || a.gpsOnSite === false) return "Missing · Suspect";
  const keys = ["trench", "measuringStick", "sandBedding", "warningTape", "sideView"];
  if (keys.every((k) => a[k])) return "Complete";
  if (!a.trench || !a.sideView) return "Missing · Critical";
  return "Partial";
}

function makeFcpIcon(name: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:44px;height:44px;
      background:#7c3aed;
      border:2.5px solid rgba(255,255,255,0.95);
      border-radius:8px;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      font-family:'Space Grotesk',system-ui,sans-serif;
      box-shadow:0 4px 20px rgba(124,58,237,0.4),0 2px 8px rgba(0,0,0,0.3);
      gap:1px;
    ">
      <div style="font-size:6px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:0.12em;line-height:1;text-transform:uppercase">FCP</div>
      <div style="font-size:13px;font-weight:700;color:white;line-height:1;letter-spacing:-0.02em">${name}</div>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -26],
  });
}

function MapCore({
  center, zoom, onReady, children,
}: {
  center: [number, number];
  zoom: number;
  onReady: (map: L.Map) => void;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [ctx, setCtx] = useState<ReturnType<typeof createLeafletContext> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (mapInstanceRef.current) return;
    try { delete (el as HTMLElement & { _leaflet_id?: number })._leaflet_id; }
    catch { (el as HTMLElement & { _leaflet_id?: unknown })._leaflet_id = undefined; }
    const map = L.map(el, { scrollWheelZoom: true, zoomControl: true });
    map.setView(center, zoom);
    mapInstanceRef.current = map;
    onReady(map);
    setCtx(createLeafletContext(map));
    return () => {
      try { map.remove(); } catch { }
      mapInstanceRef.current = null;
      setCtx(null);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%" }}>
      {ctx && <LeafletContext.Provider value={ctx}>{children}</LeafletContext.Provider>}
    </div>
  );
}

function formatCoords(p: PhotoRecord): string {
  if (p.latitude == null || p.longitude == null) return "";
  return `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`;
}

function NetworkPanel({
  layers, photos, trenchStats, qcMode, onToggleMode,
}: {
  layers: GeoLayers;
  photos: PhotoRecord[];
  trenchStats: { complete: number; partial: number; missing: number; total: number };
  qcMode: boolean;
  onToggleMode: () => void;
}) {
  const stats = useMemo(() => {
    const fcpCount = layers.fcps?.features.length ?? 0;
    let totalBuildings = 0;
    for (const f of layers.fcps?.features ?? []) {
      totalBuildings += (f.properties?.countBuildings as number) ?? 0;
    }
    let trenchLengthM = 0;
    for (const f of layers.trenches?.features ?? []) {
      trenchLengthM += (f.properties?.length as number) ?? 0;
    }
    return {
      fcpCount,
      totalBuildings,
      trenchLengthKm: (trenchLengthM / 1000).toFixed(1),
      photoTotal: photos.length,
      analysedTotal: photos.filter((p) => p.analysis).length,
    };
  }, [layers, photos]);

  const pct = (n: number) => trenchStats.total === 0 ? 0 : Math.round((n / trenchStats.total) * 100);

  return (
    <div className="map-network-panel">
      <div className="mnp-header">
        <div>
          <div className="mnp-route">CLP20417A</div>
          <div className="mnp-subtitle">Maria Rain · Kärnten</div>
        </div>
        <button
          className={`mnp-mode-btn ${qcMode ? "qc" : ""}`}
          onClick={onToggleMode}
        >
          {qcMode ? "QC Status" : "Trench Types"}
        </button>
      </div>

      <div className="mnp-stats-row">
        <div className="mnp-stat">
          <div className="mnp-val">{stats.fcpCount}</div>
          <div className="mnp-key">FCPs</div>
        </div>
        <div className="mnp-divider" />
        <div className="mnp-stat">
          <div className="mnp-val">{stats.totalBuildings}</div>
          <div className="mnp-key">Buildings</div>
        </div>
        <div className="mnp-divider" />
        <div className="mnp-stat">
          <div className="mnp-val">{stats.trenchLengthKm}<span className="mnp-unit">km</span></div>
          <div className="mnp-key">Trench</div>
        </div>
        <div className="mnp-divider" />
        <div className="mnp-stat">
          <div className="mnp-val">{stats.photoTotal}</div>
          <div className="mnp-key">Photos</div>
        </div>
      </div>

      {trenchStats.total > 0 && (
        <div className="mnp-qc">
          <div className="mnp-qc-label">Coverage by segment · {trenchStats.total} sections</div>
          <div className="mnp-qc-bar">
            {trenchStats.complete > 0 && (
              <div
                style={{ background: QC_COLORS.complete, flex: trenchStats.complete }}
                className="mnp-qc-seg"
                title={`Complete: ${trenchStats.complete}`}
              />
            )}
            {trenchStats.partial > 0 && (
              <div
                style={{ background: QC_COLORS.partial, flex: trenchStats.partial }}
                className="mnp-qc-seg"
                title={`Partial: ${trenchStats.partial}`}
              />
            )}
            {trenchStats.missing > 0 && (
              <div
                style={{ background: QC_COLORS.missing, flex: trenchStats.missing }}
                className="mnp-qc-seg"
                title={`Missing: ${trenchStats.missing}`}
              />
            )}
          </div>
          <div className="mnp-qc-breakdown">
            <span style={{ color: QC_COLORS.complete }}>{pct(trenchStats.complete)}% Complete</span>
            <span style={{ color: QC_COLORS.partial }}>{pct(trenchStats.partial)}% Partial</span>
            <span style={{ color: QC_COLORS.missing }}>{pct(trenchStats.missing)}% Missing</span>
          </div>
        </div>
      )}

      {trenchStats.total === 0 && stats.photoTotal === 0 && (
        <div className="mnp-qc">
          <div className="mnp-qc-label" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
            Upload photos to see QC coverage
          </div>
        </div>
      )}
    </div>
  );
}

function MapLegend({ qcMode }: { qcMode: boolean }) {
  return (
    <div className="map-legend-panel">
      {qcMode ? (
        <>
          <div className="mlp-section-label">Trench QC Status</div>
          {(["complete", "partial", "missing"] as TrenchStatus[]).map((s) => (
            <div key={s} className="mlp-row">
              <span className="mlp-line" style={{ background: QC_COLORS[s] }} />
              <div>
                <div className="mlp-label" style={{ fontWeight: 600, color: QC_COLORS[s] }}>{QC_LABELS[s]}</div>
                <div className="mlp-desc">{QC_DESC[s]}</div>
              </div>
            </div>
          ))}
          <div className="mlp-divider" />
          <div className="mlp-section-label">Photo markers</div>
          {[
            { color: QC_COLORS.complete, label: "Pass · all checks" },
            { color: QC_COLORS.partial,  label: "Partial · some fail" },
            { color: QC_COLORS.missing,  label: "Critical / No GPS" },
            { color: "#94a3b8",           label: "Pending analysis" },
          ].map((item) => (
            <div key={item.label} className="mlp-row">
              <span className="mlp-dot" style={{ background: item.color }} />
              <span className="mlp-label">{item.label}</span>
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="mlp-section-label">Trench Types</div>
          {TRENCH_TYPES.map((t) => (
            <div key={t.color} className="mlp-row">
              <span className="mlp-line" style={{ background: t.color }} />
              <span className="mlp-label">{t.label}</span>
            </div>
          ))}
        </>
      )}
      <div className="mlp-divider" />
      <div className="mlp-row">
        <span style={{ width: 16, height: 16, background: "#7c3aed", borderRadius: 3, display: "inline-block", flexShrink: 0 }} />
        <span className="mlp-label">FCP · distribution hub</span>
      </div>
    </div>
  );
}

export default function MapView() {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [layers, setLayers] = useState<GeoLayers>({});
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qcMode, setQcMode] = useState(true);
  const mapRef = useRef<L.Map | null>(null);

  const handleMapReady = useCallback((map: L.Map) => { mapRef.current = map; }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const loadLayer = async (url: string): Promise<FeatureCollection | undefined> => {
        try {
          const r = await fetch(url);
          return r.ok ? ((await r.json()) as FeatureCollection) : undefined;
        } catch { return undefined; }
      };
      const [photosData, siteCluster, fcpPolygons, fcps, trenches] = await Promise.all([
        fetch("/api/photos").then((r) => r.json()).then((d) => d.photos as PhotoRecord[]).catch(() => [] as PhotoRecord[]),
        loadLayer(GEOJSON_FILES.siteCluster),
        loadLayer(GEOJSON_FILES.fcpPolygons),
        loadLayer(GEOJSON_FILES.fcps),
        loadLayer(GEOJSON_FILES.trenches),
      ]);
      if (cancelled) return;
      setPhotos(photosData);
      setLayers({ siteCluster, fcpPolygons, fcps, trenches });
      setLoading(false);
    }
    load();
    const poll = setInterval(() => {
      fetch("/api/photos").then((r) => r.json()).then((d) => setPhotos(d.photos || [])).catch(() => {});
    }, 5000);
    return () => { cancelled = true; clearInterval(poll); };
  }, []);

  const geoPhotos = useMemo(
    () => photos.filter((p) => p.hasGps && p.latitude != null && p.longitude != null),
    [photos],
  );

  const trenchStatusMap = useMemo(() => {
    const map = new Map<string, TrenchStatus>();
    if (!layers.trenches) return map;
    for (const f of layers.trenches.features) {
      if (f.geometry.type !== "LineString") continue;
      const coords = f.geometry.coordinates as number[][];
      const id = (f.properties?.externalID as string) ?? JSON.stringify(coords[0]);
      map.set(id, computeStatus(coords, geoPhotos));
    }
    return map;
  }, [layers.trenches, geoPhotos]);

  const trenchStats = useMemo(() => {
    let complete = 0, partial = 0, missing = 0;
    for (const s of trenchStatusMap.values()) {
      if (s === "complete") complete++;
      else if (s === "partial") partial++;
      else missing++;
    }
    return { complete, partial, missing, total: complete + partial + missing };
  }, [trenchStatusMap]);

  const makeTrenchStyle = useCallback(
    (feature?: Feature<Geometry, GeoJsonProperties>): PathOptions => {
      const base: PathOptions = { weight: 5, opacity: 0.9, lineCap: "round", lineJoin: "round" };
      if (!qcMode) {
        return { ...base, color: (feature?.properties?.fillColor as string) ?? "#3b82f6" };
      }
      const id = (feature?.properties?.externalID as string) ?? "";
      const status = trenchStatusMap.get(id) ?? "missing";
      return { ...base, color: QC_COLORS[status], weight: 4 };
    },
    [qcMode, trenchStatusMap],
  );

  const center: [number, number] = useMemo(() => {
    const cluster = layers.siteCluster?.features?.[0];
    if (cluster?.geometry.type === "Polygon") {
      const ring = (cluster.geometry.coordinates as number[][][])[0];
      const lats = ring.map((c) => c[1]);
      const lons = ring.map((c) => c[0]);
      return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
    }
    if (geoPhotos.length > 0) {
      return [
        geoPhotos.reduce((s, p) => s + p.latitude!, 0) / geoPhotos.length,
        geoPhotos.reduce((s, p) => s + p.longitude!, 0) / geoPhotos.length,
      ];
    }
    return AUSTRIA_CENTER;
  }, [layers.siteCluster, geoPhotos]);

  const zoom = layers.siteCluster ? 14 : geoPhotos.length > 0 ? 12 : 7;

  function flyToPhoto(p: PhotoRecord) {
    if (p.latitude == null || p.longitude == null) return;
    mapRef.current?.flyTo([p.latitude, p.longitude], 17, { duration: 0.8 });
  }

  const trenchKey = `trenches-${qcMode ? "qc" : "type"}-${trenchStatusMap.size}-${geoPhotos.length}`;

  if (loading) return <div className="empty">Loading map…</div>;

  return (
    <div className="map-wrapper">
      <MapCore center={center} zoom={zoom} onReady={handleMapReady}>
        <LayersControl position="bottomright">
          <LayersControl.BaseLayer checked name="Map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              attribution="&copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Dark">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>

          {layers.siteCluster && (
            <LayersControl.Overlay checked name="Site boundary">
              <GeoJSON
                data={layers.siteCluster}
                style={() => clusterStyle}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(propsTable(f.properties, ["kmlDescriptionSimple", "type", "externalID"]))
                }
              />
            </LayersControl.Overlay>
          )}

          {layers.fcpPolygons && (
            <LayersControl.Overlay checked name="FCP service areas">
              <GeoJSON
                data={layers.fcpPolygons}
                style={fcpPolygonStyle}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(propsTable(f.properties, ["kmlDescriptionSimple", "externalID"]))
                }
              />
            </LayersControl.Overlay>
          )}

          {layers.trenches && (
            <LayersControl.Overlay checked name={`Trenches (${layers.trenches.features.length})`}>
              <GeoJSON
                key={trenchKey}
                data={layers.trenches}
                style={makeTrenchStyle}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    propsTable(f.properties, ["masterItem", "executionState", "ductMainFull", "length", "ductType", "externalID"]),
                    { maxWidth: 280 },
                  )
                }
              />
            </LayersControl.Overlay>
          )}

          {layers.fcps && (
            <LayersControl.Overlay checked name={`FCPs (${layers.fcps.features.length})`}>
              <GeoJSON
                data={layers.fcps}
                pointToLayer={(feature, latlng) => {
                  const name =
                    (feature.properties?.fcpName as string) ??
                    (feature.properties?.name as string) ??
                    "FCP";
                  return L.marker(latlng, { icon: makeFcpIcon(name), zIndexOffset: 500 });
                }}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    propsTable(f.properties, ["fcpName", "kmlDescriptionSimple", "executionState", "countBuildings", "countHomes", "plannedCores"]),
                    { maxWidth: 260 },
                  )
                }
              />
            </LayersControl.Overlay>
          )}

          <LayersControl.Overlay checked name={`Photos (${geoPhotos.length})`}>
            <GeoJSON
              key={`photos-${geoPhotos.length}`}
              data={({
                type: "FeatureCollection",
                features: geoPhotos.map((p) => ({
                  type: "Feature",
                  properties: {
                    id: p.id,
                    name: p.originalName,
                    takenAt: p.takenAt,
                    project: p.project,
                    lotId: p.lotId,
                    color: markerColor(p),
                    category: markerCategory(p),
                  },
                  geometry: { type: "Point", coordinates: [p.longitude!, p.latitude!] },
                })),
              }) as FeatureCollection}
              pointToLayer={(feature, latlng) => {
                const color = (feature.properties?.color as string) ?? "#94a3b8";
                return L.circleMarker(latlng, {
                  radius: 7,
                  color: "rgba(255,255,255,0.9)",
                  weight: 1.5,
                  fillColor: color,
                  fillOpacity: 1,
                  zIndexOffset: 1000,
                });
              }}
              onEachFeature={(f, layer) => {
                const p = f.properties ?? {};
                const color = (p.color as string) ?? "#94a3b8";
                layer.bindPopup(
                  `<img src="/api/photos/${p.id}" class="popup-thumb" />
                   <div class="popup-name">${p.name}</div>
                   <div class="popup-meta">
                     <span style="color:${color};font-weight:700">${p.category}</span>
                     ${p.project ? `<br/>Project: ${p.project}` : ""}
                     ${p.lotId ? ` · Lot: ${p.lotId}` : ""}
                     ${p.takenAt ? `<br/>${new Date(p.takenAt).toLocaleString("de-AT")}` : ""}
                   </div>`,
                  { maxWidth: 240 },
                );
                layer.on("click", () => setSelectedId(p.id));
              }}
            />
          </LayersControl.Overlay>
        </LayersControl>
      </MapCore>

      <NetworkPanel
        layers={layers}
        photos={photos}
        trenchStats={trenchStats}
        qcMode={qcMode}
        onToggleMode={() => setQcMode((v) => !v)}
      />

      <MapLegend qcMode={qcMode} />

      {photos.length > 0 && (
        <div className="photo-panel">
          <button className="photo-panel-toggle" onClick={() => setPanelOpen((v) => !v)}>
            {panelOpen ? "Close" : `Photos (${photos.length})`}
          </button>
          {panelOpen && (
            <div className="photo-panel-list">
              <div className="photo-panel-header">
                <span className="photo-panel-header-title">Photos · {photos.length}</span>
              </div>
              {photos.map((p) => (
                <div
                  key={p.id}
                  className={`photo-panel-item ${selectedId === p.id ? "selected" : ""} ${p.hasGps ? "has-gps" : ""}`}
                  onClick={() => { setSelectedId(p.id); flyToPhoto(p); }}
                >
                  <img src={`/api/photos/${p.id}`} alt="" className="photo-panel-thumb" />
                  <div className="photo-panel-info">
                    <div className="photo-panel-name">{p.originalName}</div>
                    {p.takenAt && (
                      <div className="photo-panel-meta">
                        {new Date(p.takenAt).toLocaleString("de-AT")}
                      </div>
                    )}
                    <div className="photo-panel-badges">
                      {p.hasGps ? (
                        <span className="ppbadge gps">GPS {formatCoords(p)}</span>
                      ) : (
                        <span className="ppbadge no-gps">No GPS</span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: markerColor(p),
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
