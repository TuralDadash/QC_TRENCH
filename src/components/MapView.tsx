"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  LayersControl,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from "geojson";
import type { PathOptions } from "leaflet";
import type { PhotoRecord } from "@/lib/store";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

const COLOR_ACCENT = "#009b9b";
const COLOR_ACCENT_BORDER = "rgba(255,255,255,0.65)";
const COLOR_TRENCH_DEFAULT = "#5ba4cf";
const COLOR_FCP_DEFAULT = "#22c55e";
const COLOR_CLUSTER = "#f59e0b";

const GEOJSON_FILES = {
  siteCluster: "/geojson/CLP20417A-P1-B00_SiteCluster_Polygons.geojson",
  fcpPolygons: "/geojson/CLP20417A-P1-B00_FCP_Polygons.geojson",
  fcps: "/geojson/CLP20417A-P1-B00_FCPs.geojson",
  trenches: "/geojson/CLP20417A-P1-B00_Trenches.geojson",
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
    .map((k) => `<tr><td><b>${k}</b></td><td>${String(props[k])}</td></tr>`)
    .join("");
  return `<table style="font-size:11px;color:#e2e8f0">${rows}</table>`;
}

function trenchStyle(feature?: Feature<Geometry, GeoJsonProperties>): PathOptions {
  const color = (feature?.properties?.fillColor as string | undefined) ?? COLOR_TRENCH_DEFAULT;
  return { color, weight: 3, opacity: 0.85 };
}

function fcpPolygonStyle(feature?: Feature<Geometry, GeoJsonProperties>): PathOptions {
  const color = (feature?.properties?.fillColor as string | undefined) ?? COLOR_FCP_DEFAULT;
  return { color, weight: 1, fillColor: color, fillOpacity: 0.12 };
}

const clusterStyle: PathOptions = {
  color: COLOR_CLUSTER,
  weight: 2,
  fillOpacity: 0.04,
  dashArray: "6 4",
};

function MapController({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onReady(map); }, [map, onReady]);
  return null;
}


function formatCoords(p: PhotoRecord): string {
  if (p.latitude == null || p.longitude == null) return "";
  return `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`;
}

export default function MapView() {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [layers, setLayers] = useState<GeoLayers>({});
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const loadLayer = async (url: string): Promise<FeatureCollection | undefined> => {
        try {
          const r = await fetch(url);
          return r.ok ? ((await r.json()) as FeatureCollection) : undefined;
        } catch {
          return undefined;
        }
      };

      const [photosData, siteCluster, fcpPolygons, fcps, trenches] = await Promise.all([
        fetch("/api/photos")
          .then((r) => r.json())
          .then((d) => d.photos as PhotoRecord[])
          .catch(() => [] as PhotoRecord[]),
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

  const center: [number, number] = useMemo(() => {
    const cluster = layers.siteCluster?.features?.[0];
    if (cluster?.geometry.type === "Polygon") {
      const ring = (cluster.geometry.coordinates as number[][][])[0];
      const lats = ring.map((c) => c[1]);
      const lons = ring.map((c) => c[0]);
      return [
        (Math.min(...lats) + Math.max(...lats)) / 2,
        (Math.min(...lons) + Math.max(...lons)) / 2,
      ];
    }
    if (geoPhotos.length > 0) {
      const avgLat = geoPhotos.reduce((s, p) => s + p.latitude!, 0) / geoPhotos.length;
      const avgLon = geoPhotos.reduce((s, p) => s + p.longitude!, 0) / geoPhotos.length;
      return [avgLat, avgLon];
    }
    return AUSTRIA_CENTER;
  }, [layers.siteCluster, geoPhotos]);

  const zoom = layers.siteCluster ? 14 : geoPhotos.length > 0 ? 10 : 7;

  function flyToPhoto(p: PhotoRecord) {
    if (p.latitude == null || p.longitude == null) return;
    mapRef.current?.flyTo([p.latitude, p.longitude], 17, { duration: 0.8 });
  }

  if (loading) return <div className="empty">Loading map data...</div>;

  return (
    <div className="map-wrapper">
      <MapContainer center={center} zoom={zoom} scrollWheelZoom>
        <MapController onReady={handleMapReady} />
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Carto Voyager">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="OSM Humanitarian">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors, Tiles courtesy of Humanitarian OSM Team'
              url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>

          {layers.siteCluster && (
            <LayersControl.Overlay checked name="Site cluster">
              <GeoJSON
                data={layers.siteCluster}
                style={() => clusterStyle}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    propsTable(f.properties, [
                      "kmlDescriptionSimple",
                      "type",
                      "externalID",
                    ]),
                  )
                }
              />
            </LayersControl.Overlay>
          )}

          {layers.fcpPolygons && (
            <LayersControl.Overlay checked name="FCP polygons">
              <GeoJSON
                data={layers.fcpPolygons}
                style={fcpPolygonStyle}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    propsTable(f.properties, [
                      "kmlName",
                      "kmlDescriptionSimple",
                      "type",
                      "externalID",
                    ]),
                  )
                }
              />
            </LayersControl.Overlay>
          )}

          {layers.trenches && (
            <LayersControl.Overlay
              checked
              name={`Trenches (${layers.trenches.features.length})`}
            >
              <GeoJSON
                data={layers.trenches}
                style={trenchStyle}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    propsTable(f.properties, [
                      "userLabel",
                      "executionState",
                      "ductMainFull",
                      "length",
                      "ductType",
                      "externalID",
                    ]),
                  )
                }
              />
            </LayersControl.Overlay>
          )}

          {layers.fcps && (
            <LayersControl.Overlay
              checked
              name={`FCPs (${layers.fcps.features.length})`}
            >
              <GeoJSON
                data={layers.fcps}
                pointToLayer={(feature, latlng) => {
                  const color =
                    (feature.properties?.fillColor as string | undefined) ?? COLOR_FCP_DEFAULT;
                  return L.circleMarker(latlng, {
                    radius: 7,
                    color: "#fff",
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 1,
                  });
                }}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    propsTable(f.properties, [
                      "fcpName",
                      "kmlDescriptionSimple",
                      "address",
                      "city",
                      "zipCode",
                      "executionState",
                      "countBuildings",
                      "countHomes",
                      "plannedCores",
                    ]),
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
                  },
                  geometry: {
                    type: "Point",
                    coordinates: [p.longitude!, p.latitude!],
                  },
                })),
              }) as FeatureCollection}
              pointToLayer={(_, latlng) =>
                L.circleMarker(latlng, {
                  radius: 8,
                  color: COLOR_ACCENT_BORDER,
                  weight: 2,
                  fillColor: COLOR_ACCENT,
                  fillOpacity: 0.9,
                })
              }
              onEachFeature={(f, layer) => {
                const p = f.properties ?? {};
                layer.bindPopup(
                  `<img src="/api/photos/${p.id}" class="popup-thumb" />
                   <div class="popup-name">${p.name}</div>
                   <div class="popup-meta">
                     ${p.project ? `Project: ${p.project}` : ""}
                     ${p.lotId ? ` &middot; Lot: ${p.lotId}` : ""}
                     ${p.takenAt ? `<br/>Taken: ${new Date(p.takenAt).toLocaleString()}` : ""}
                   </div>`,
                  { maxWidth: 240 },
                );
                layer.on("click", () => setSelectedId(p.id));
              }}
            />
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>

      <div className="map-overlay">
        <div className="map-overlay-title">APG Photo Audit</div>
        <div className="map-overlay-stats">
          <div>
            <div className="map-stat-num">{photos.length}</div>
            <div className="map-stat-label">Photos</div>
          </div>
          <div>
            <div className="map-stat-num gps">{geoPhotos.length}</div>
            <div className="map-stat-label">With GPS</div>
          </div>
          <div>
            <div className="map-stat-num warn">{photos.length - geoPhotos.length}</div>
            <div className="map-stat-label">No GPS</div>
          </div>
        </div>
      </div>

      {photos.length > 0 && (
        <div className={`photo-panel ${panelOpen ? "open" : ""}`}>
          <button
            className="photo-panel-toggle"
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? "Hide photos" : "Show photos"}
          >
            {panelOpen ? "✕" : `Photos (${photos.length})`}
          </button>

          {panelOpen && (
            <div className="photo-panel-list">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className={`photo-panel-item ${selectedId === p.id ? "selected" : ""} ${p.hasGps ? "has-gps" : ""}`}
                  onClick={() => {
                    setSelectedId(p.id);
                    flyToPhoto(p);
                  }}
                >
                  <img
                    src={`/api/photos/${p.id}`}
                    alt=""
                    className="photo-panel-thumb"
                  />
                  <div className="photo-panel-info">
                    <div className="photo-panel-name">{p.originalName}</div>
                    {p.takenAt && (
                      <div className="photo-panel-meta">
                        {new Date(p.takenAt).toLocaleString()}
                      </div>
                    )}
                    <div className="photo-panel-badges">
                      {p.hasGps ? (
                        <span className="ppbadge gps">
                          GPS {formatCoords(p)}
                        </span>
                      ) : (
                        <span className="ppbadge no-gps">No GPS</span>
                      )}
                      {p.project && (
                        <span className="ppbadge neutral">{p.project}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
