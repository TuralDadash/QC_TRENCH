"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TileLayer, LayersControl, GeoJSON } from "react-leaflet";
import { createLeafletContext, LeafletContext } from "@react-leaflet/core";
import L from "leaflet";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type { PathOptions } from "leaflet";
import type { PhotoRecord } from "@/lib/store";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

const CAT_COLORS = {
  cat1:    "#22c55e",
  cat2:    "#f59e0b",
  cat3:    "#ef4444",
  cat4:    "#a855f7",
  pending: "#64748b",
} as const;

const TRENCH_TYPES: Array<{ color: string; label: string; pct: number }> = [
  { color: "#FE0DFF", label: "Hausanschluss",         pct: 41 },
  { color: "#0D15FF", label: "Künette versiegelt",    pct: 27 },
  { color: "#3B3B3B", label: "Pressung",              pct: 14 },
  { color: "#1B7CBD", label: "Künette unversiegelt",  pct: 13 },
  { color: "#958CCF", label: "Querung offen",         pct:  4 },
  { color: "#CC6E84", label: "Privatstraße",          pct:  1 },
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

function propsTable(props: GeoJsonProperties, keys: string[]) {
  if (!props) return "";
  const rows = keys
    .filter((k) => props[k] != null && props[k] !== "")
    .map((k) => `<tr><td style="color:#8b9ab0;padding-right:8px;font-size:10px;white-space:nowrap">${k}</td><td style="color:#e2e8f2;font-size:11px">${String(props[k])}</td></tr>`)
    .join("");
  return `<table style="border-collapse:collapse">${rows}</table>`;
}

function trenchStyle(feature?: Feature<Geometry, GeoJsonProperties>): PathOptions {
  const color = (feature?.properties?.fillColor as string | undefined) ?? "#3b82f6";
  return { color, weight: 5, opacity: 0.9, lineCap: "round", lineJoin: "round" };
}

function fcpPolygonStyle(feature?: Feature<Geometry, GeoJsonProperties>): PathOptions {
  const color = (feature?.properties?.fillColor as string | undefined) ?? "#586cde";
  return { color, weight: 1.5, fillColor: color, fillOpacity: 0.1, opacity: 0.5 };
}

const clusterStyle: PathOptions = {
  color: "#7fb347",
  weight: 2,
  fillOpacity: 0.03,
  dashArray: "8 5",
  opacity: 0.7,
};

function markerColor(p: PhotoRecord): string {
  if (!p.hasGps || !p.analysis) return CAT_COLORS.pending;
  const a = p.analysis as Record<string, unknown>;
  if (a.isDuplicate || a.gpsOnSite === false) return CAT_COLORS.cat4;
  const keys = ["trench", "measuringStick", "sandBedding", "warningTape", "sideView"];
  if (keys.every((k) => a[k])) return CAT_COLORS.cat1;
  if (!a.trench || !a.sideView) return CAT_COLORS.cat3;
  return CAT_COLORS.cat2;
}

function markerCategory(p: PhotoRecord): string {
  if (!p.hasGps) return "No GPS";
  if (!p.analysis) return "Pending";
  const a = p.analysis as Record<string, unknown>;
  if (a.isDuplicate || a.gpsOnSite === false) return "Cat 4 · Suspect";
  const keys = ["trench", "measuringStick", "sandBedding", "warningTape", "sideView"];
  if (keys.every((k) => a[k])) return "Cat 1 · Pass";
  if (!a.trench || !a.sideView) return "Cat 3 · Critical";
  return "Cat 2 · Partial";
}

function makeFcpIcon(name: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:48px;height:48px;
      background:#586cde;
      border:2.5px solid rgba(255,255,255,0.85);
      border-radius:6px;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      font-family:'Instrument Sans',system-ui,sans-serif;
      box-shadow:0 4px 16px rgba(0,0,0,0.6);
      gap:1px;
    ">
      <div style="font-size:7px;font-weight:700;color:rgba(255,255,255,0.65);letter-spacing:0.12em;line-height:1">FCP</div>
      <div style="font-size:12px;font-weight:800;color:white;line-height:1;letter-spacing:-0.02em">${name}</div>
    </div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -28],
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

function NetworkPanel({ layers, photos, exceptionMode, onToggleException }: {
  layers: GeoLayers;
  photos: PhotoRecord[];
  exceptionMode: boolean;
  onToggleException: () => void;
}) {
  const stats = useMemo(() => {
    const fcpCount = layers.fcps?.features.length ?? 0;
    let totalBuildings = 0;
    let totalHomes = 0;
    for (const f of layers.fcps?.features ?? []) {
      totalBuildings += (f.properties?.countBuildings as number) ?? 0;
      totalHomes += (f.properties?.countHomes as number) ?? 0;
    }
    let trenchLengthM = 0;
    for (const f of layers.trenches?.features ?? []) {
      trenchLengthM += (f.properties?.length as number) ?? 0;
    }
    const clusterDesc = layers.siteCluster?.features[0]?.properties?.kmlDescriptionSimple ?? "";
    const routeId = clusterDesc.split(",")[0]?.trim() ?? "CLP20417A";

    const analysed = photos.filter((p) => p.analysis != null);
    let cat1 = 0, cat2 = 0, cat3 = 0, cat4 = 0;
    for (const p of photos) {
      const c = markerColor(p);
      if (c === CAT_COLORS.cat1) cat1++;
      else if (c === CAT_COLORS.cat2) cat2++;
      else if (c === CAT_COLORS.cat3) cat3++;
      else if (c === CAT_COLORS.cat4) cat4++;
    }
    const noGps = photos.filter((p) => !p.hasGps).length;

    return {
      fcpCount,
      totalBuildings,
      totalHomes,
      trenchLengthKm: (trenchLengthM / 1000).toFixed(1),
      trenchSections: layers.trenches?.features.length ?? 0,
      routeId,
      photoTotal: photos.length,
      analysedTotal: analysed.length,
      cat1, cat2, cat3, cat4, noGps,
    };
  }, [layers, photos]);

  return (
    <div className="map-network-panel">
      <div className="mnp-header">
        <div>
          <div className="mnp-route">{stats.routeId}</div>
          <div className="mnp-subtitle">Maria Rain · Kärnten</div>
        </div>
        <button
          className={`mnp-exception-btn ${exceptionMode ? "active" : ""}`}
          onClick={onToggleException}
        >
          {exceptionMode ? "Exceptions only" : "All layers"}
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
          <div className="mnp-key">Gebäude</div>
        </div>
        <div className="mnp-divider" />
        <div className="mnp-stat">
          <div className="mnp-val">{stats.totalHomes}</div>
          <div className="mnp-key">Homes</div>
        </div>
        <div className="mnp-divider" />
        <div className="mnp-stat">
          <div className="mnp-val">{stats.trenchLengthKm}<span className="mnp-unit">km</span></div>
          <div className="mnp-key">Trench</div>
        </div>
      </div>

      {stats.photoTotal > 0 && (
        <div className="mnp-qc">
          <div className="mnp-qc-label">Photo QC — {stats.photoTotal} uploaded · {stats.analysedTotal} analysed</div>
          <div className="mnp-qc-bar">
            {stats.cat1 > 0 && <div style={{ background: CAT_COLORS.cat1, flex: stats.cat1 }} className="mnp-qc-seg" title={`Cat 1 Pass: ${stats.cat1}`} />}
            {stats.cat2 > 0 && <div style={{ background: CAT_COLORS.cat2, flex: stats.cat2 }} className="mnp-qc-seg" title={`Cat 2 Partial: ${stats.cat2}`} />}
            {stats.cat3 > 0 && <div style={{ background: CAT_COLORS.cat3, flex: stats.cat3 }} className="mnp-qc-seg" title={`Cat 3 Critical: ${stats.cat3}`} />}
            {stats.cat4 > 0 && <div style={{ background: CAT_COLORS.cat4, flex: stats.cat4 }} className="mnp-qc-seg" title={`Cat 4 Suspect: ${stats.cat4}`} />}
            {(stats.photoTotal - stats.cat1 - stats.cat2 - stats.cat3 - stats.cat4) > 0 && (
              <div style={{ background: CAT_COLORS.pending, flex: stats.photoTotal - stats.cat1 - stats.cat2 - stats.cat3 - stats.cat4 }} className="mnp-qc-seg" />
            )}
          </div>
          <div className="mnp-qc-breakdown">
            <span style={{ color: CAT_COLORS.cat1 }}>{stats.cat1} Pass</span>
            <span style={{ color: CAT_COLORS.cat2 }}>{stats.cat2} Partial</span>
            <span style={{ color: CAT_COLORS.cat3 }}>{stats.cat3} Critical</span>
            {stats.noGps > 0 && <span style={{ color: CAT_COLORS.pending }}>{stats.noGps} No GPS</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function MapLegend() {
  return (
    <div className="map-legend-panel">
      <div className="mlp-section-label">Trench Types</div>
      {TRENCH_TYPES.map((t) => (
        <div key={t.color} className="mlp-row">
          <span className="mlp-line" style={{ background: t.color }} />
          <span className="mlp-label">{t.label}</span>
          <span className="mlp-pct">{t.pct}%</span>
        </div>
      ))}
      <div className="mlp-divider" />
      <div className="mlp-section-label">Photo QC</div>
      {[
        { color: CAT_COLORS.cat1, label: "Cat 1 · Pass" },
        { color: CAT_COLORS.cat2, label: "Cat 2 · Partial" },
        { color: CAT_COLORS.cat3, label: "Cat 3 · Critical" },
        { color: CAT_COLORS.cat4, label: "Cat 4 · Suspect" },
        { color: CAT_COLORS.pending, label: "Pending" },
      ].map((item) => (
        <div key={item.label} className="mlp-row">
          <span className="mlp-dot" style={{ background: item.color }} />
          <span className="mlp-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function MapView() {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [layers, setLayers] = useState<GeoLayers>({});
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exceptionMode, setExceptionMode] = useState(false);
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
    return () => { cancelled = true; };
  }, []);

  const geoPhotos = useMemo(
    () => photos.filter((p) => p.hasGps && p.latitude != null && p.longitude != null),
    [photos],
  );

  const visiblePhotos = useMemo(() => {
    if (!exceptionMode) return photos;
    return photos.filter((p) => !p.hasGps || (p.analysis as Record<string,unknown> | null)?.isDuplicate);
  }, [photos, exceptionMode]);

  const visibleGeoPhotos = useMemo(
    () => visiblePhotos.filter((p) => p.hasGps && p.latitude != null && p.longitude != null),
    [visiblePhotos],
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

  const zoom = layers.siteCluster ? 14 : geoPhotos.length > 0 ? 10 : 7;

  function flyToPhoto(p: PhotoRecord) {
    if (p.latitude == null || p.longitude == null) return;
    mapRef.current?.flyTo([p.latitude, p.longitude], 17, { duration: 0.8 });
  }

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
              attribution='&copy; Esri'
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
                onEachFeature={(f, layer) => layer.bindPopup(propsTable(f.properties, ["kmlDescriptionSimple", "type", "externalID"]))}
              />
            </LayersControl.Overlay>
          )}

          {layers.fcpPolygons && (
            <LayersControl.Overlay checked name="FCP service areas">
              <GeoJSON
                data={layers.fcpPolygons}
                style={fcpPolygonStyle}
                onEachFeature={(f, layer) => layer.bindPopup(propsTable(f.properties, ["kmlDescriptionSimple", "externalID"]))}
              />
            </LayersControl.Overlay>
          )}

          {layers.trenches && (
            <LayersControl.Overlay checked name={`Trenches (${layers.trenches.features.length})`}>
              <GeoJSON
                data={layers.trenches}
                style={trenchStyle}
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
                  const name = (feature.properties?.fcpName as string) ?? (feature.properties?.name as string) ?? "FCP";
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

          <LayersControl.Overlay checked name={`Photos (${visibleGeoPhotos.length})`}>
            <GeoJSON
              key={`photos-${visibleGeoPhotos.length}-${exceptionMode}`}
              data={({
                type: "FeatureCollection",
                features: visibleGeoPhotos.map((p) => ({
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
                const color = (feature.properties?.color as string) ?? CAT_COLORS.pending;
                return L.circleMarker(latlng, {
                  radius: 8,
                  color: "rgba(0,0,0,0.5)",
                  weight: 2,
                  fillColor: color,
                  fillOpacity: 0.95,
                  zIndexOffset: 1000,
                });
              }}
              onEachFeature={(f, layer) => {
                const p = f.properties ?? {};
                const color = (p.color as string) ?? CAT_COLORS.pending;
                layer.bindPopup(
                  `<img src="/api/photos/${p.id}" class="popup-thumb" />
                   <div class="popup-name">${p.name}</div>
                   <div class="popup-meta">
                     <span style="color:${color};font-weight:700">${p.category}</span>
                     ${p.project ? `<br/>Projekt: ${p.project}` : ""}
                     ${p.lotId ? ` · Los: ${p.lotId}` : ""}
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
        exceptionMode={exceptionMode}
        onToggleException={() => setExceptionMode((v) => !v)}
      />

      <MapLegend />

      {photos.length > 0 && (
        <div className="photo-panel">
          <button
            className="photo-panel-toggle"
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? "Close" : `Photos (${visiblePhotos.length})`}
          </button>

          {panelOpen && (
            <div className="photo-panel-list">
              <div className="photo-panel-header">
                <span className="photo-panel-header-title">
                  {exceptionMode ? `Exceptions · ${visiblePhotos.length}` : `All photos · ${photos.length}`}
                </span>
              </div>
              {visiblePhotos.map((p) => (
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
                      {(p.analysis as Record<string,unknown> | null)?.isDuplicate && (
                        <span className="ppbadge" style={{ color: "var(--cat4)", borderColor: "var(--cat4-border)", background: "var(--cat4-bg)" }}>Duplicate</span>
                      )}
                    </div>
                  </div>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: markerColor(p), flexShrink: 0, marginTop: 4 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
