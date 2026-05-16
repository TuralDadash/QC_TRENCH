"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  LayersControl,
  GeoJSON,
  CircleMarker,
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

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = defaultIcon;

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

// Documentation rule: one trench photo is expected every 5 m. House-connection
// (Hausanschluss) segments are not part of the trench network that needs photo
// coverage, so they are excluded from the length and expected-photo count.
const PHOTO_INTERVAL_M = 5;
const HOME_CONNECTION_MASTER_ITEM = "_98 Hausanschluss";

// A checkpoint counts as covered when an uploaded photo's GPS lies within this
// distance of it — generous enough to absorb typical phone GPS drift.
const COVERAGE_RADIUS_M = 10;
const EARTH_RADIUS_M = 6_371_000;

type GeoLayers = {
  siteCluster?: FeatureCollection;
  fcpPolygons?: FeatureCollection;
  fcps?: FeatureCollection;
  trenches?: FeatureCollection;
};

const GEOJSON_FILES = {
  siteCluster: "/geojson/CLP20417A-P1-B00_SiteCluster_Polygons.geojson",
  fcpPolygons: "/geojson/CLP20417A-P1-B00_FCP_Polygons.geojson",
  fcps: "/geojson/CLP20417A-P1-B00_FCPs.geojson",
  trenches: "/geojson/CLP20417A-P1-B00_Trenches.geojson",
} as const;

function propsTable(props: GeoJsonProperties, keys: string[]) {
  if (!props) return "";
  const rows = keys
    .filter((k) => props[k] !== undefined && props[k] !== null && props[k] !== "")
    .map((k) => `<tr><td><b>${k}</b></td><td>${String(props[k])}</td></tr>`)
    .join("");
  return `<table style="font-size:11px">${rows}</table>`;
}

// Great-circle distance in metres between two WGS84 points.
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const dPhi = (lat2 - lat1) * toRad;
  const dLam = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLam / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export default function MapView() {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [layers, setLayers] = useState<GeoLayers>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const photosReq = fetch("/api/photos")
        .then((r) => r.json())
        .then((d) => d.photos as PhotoRecord[])
        .catch(() => []);

      const layerReq = async (url: string) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return undefined;
          return (await r.json()) as FeatureCollection;
        } catch {
          return undefined;
        }
      };

      const [photosRes, siteCluster, fcpPolygons, fcps, trenches] =
        await Promise.all([
          photosReq,
          layerReq(GEOJSON_FILES.siteCluster),
          layerReq(GEOJSON_FILES.fcpPolygons),
          layerReq(GEOJSON_FILES.fcps),
          layerReq(GEOJSON_FILES.trenches),
        ]);

      if (cancelled) return;
      setPhotos(photosRes);
      setLayers({ siteCluster, fcpPolygons, fcps, trenches });
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const geoPhotos = useMemo(
    () => photos.filter((p) => p.hasGps && p.latitude != null && p.longitude != null),
    [photos],
  );

  const center: [number, number] = useMemo(() => {
    // Center on the site cluster polygon if we have it, else on photos, else Austria.
    const cluster = layers.siteCluster?.features?.[0];
    if (cluster && cluster.geometry.type === "Polygon") {
      const ring = (cluster.geometry.coordinates as number[][][])[0];
      const lats = ring.map((c) => c[1]);
      const lons = ring.map((c) => c[0]);
      return [
        (Math.min(...lats) + Math.max(...lats)) / 2,
        (Math.min(...lons) + Math.max(...lons)) / 2,
      ];
    }
    if (geoPhotos.length > 0) {
      const avgLat =
        geoPhotos.reduce((s, p) => s + (p.latitude as number), 0) / geoPhotos.length;
      const avgLon =
        geoPhotos.reduce((s, p) => s + (p.longitude as number), 0) / geoPhotos.length;
      return [avgLat, avgLon];
    }
    return AUSTRIA_CENTER;
  }, [layers.siteCluster, geoPhotos]);

  const zoom = layers.siteCluster ? 14 : geoPhotos.length > 0 ? 10 : 7;

  // Walk the trench network once: measure its length, drop one expected-photo
  // checkpoint every PHOTO_INTERVAL_M of cumulative length, and flag each
  // checkpoint covered when an uploaded photo's GPS is within COVERAGE_RADIUS_M.
  // House-connection segments are excluded — they are not part of the trench
  // network that needs photo coverage. Uncovered checkpoints are missing photos.
  const coverage = useMemo(() => {
    const features = layers.trenches?.features ?? [];
    const checkpoints: [number, number][] = [];
    let trenchLengthM = 0;
    let homeConnectionLengthM = 0;
    let cumulative = 0;
    let nextMark = 0;

    for (const f of features) {
      const geom = f.geometry;
      if (!geom || geom.type !== "LineString") continue;
      const coords = geom.coordinates;
      const isHomeConnection =
        f.properties?.masterItem === HOME_CONNECTION_MASTER_ITEM;
      for (let i = 0; i < coords.length - 1; i++) {
        const [lonA, latA] = coords[i];
        const [lonB, latB] = coords[i + 1];
        const segLen = haversineM(latA, lonA, latB, lonB);
        if (segLen <= 0) continue;
        if (isHomeConnection) {
          homeConnectionLengthM += segLen;
          continue;
        }
        trenchLengthM += segLen;
        while (nextMark <= cumulative + segLen) {
          const t = (nextMark - cumulative) / segLen;
          checkpoints.push([
            latA + (latB - latA) * t,
            lonA + (lonB - lonA) * t,
          ]);
          nextMark += PHOTO_INTERVAL_M;
        }
        cumulative += segLen;
      }
    }

    const photoPoints = geoPhotos.map(
      (p) => [p.latitude as number, p.longitude as number] as const,
    );
    const pointFeatures: FeatureCollection["features"] = [];
    let covered = 0;
    for (const [lat, lon] of checkpoints) {
      const isCovered = photoPoints.some(
        ([pLat, pLon]) => haversineM(lat, lon, pLat, pLon) <= COVERAGE_RADIUS_M,
      );
      if (isCovered) covered += 1;
      pointFeatures.push({
        type: "Feature",
        properties: { covered: isCovered },
        geometry: { type: "Point", coordinates: [lon, lat] },
      });
    }

    const points: FeatureCollection = {
      type: "FeatureCollection",
      features: pointFeatures,
    };
    return {
      trenchLengthM,
      homeConnectionLengthM,
      expectedPhotos: checkpoints.length,
      covered,
      missing: checkpoints.length - covered,
      points,
    };
  }, [layers.trenches, geoPhotos]);

  const trenchStyle = (feature?: Feature<Geometry, GeoJsonProperties>): PathOptions => {
    const color =
      (feature?.properties?.fillColor as string | undefined) || "#6ea8fe";
    return { color, weight: 3, opacity: 0.9 };
  };

  const fcpPolygonStyle = (
    feature?: Feature<Geometry, GeoJsonProperties>,
  ): PathOptions => {
    const color =
      (feature?.properties?.fillColor as string | undefined) || "#22c55e";
    return { color, weight: 1, fillColor: color, fillOpacity: 0.15 };
  };

  const clusterStyle: PathOptions = {
    color: "#f59e0b",
    weight: 2,
    fillOpacity: 0.05,
    dashArray: "6 4",
  };

  if (loading) return <div className="empty">Loading map data…</div>;

  return (
    <div className="map-wrap">
      {layers.trenches && (
        <div className="map-stats">
          <div className="map-stats-title">Trench photo coverage</div>
          <div className="map-stats-row">
            <span>Trench length</span>
            <strong>{(coverage.trenchLengthM / 1000).toFixed(2)} km</strong>
          </div>
          <div className="map-stats-row">
            <span>Expected photos</span>
            <strong>{coverage.expectedPhotos.toLocaleString()}</strong>
          </div>
          <div className="map-stats-row">
            <span>Covered</span>
            <strong className="map-stats-ok">
              {coverage.covered.toLocaleString()}
            </strong>
          </div>
          <div className="map-stats-row">
            <span>Missing</span>
            <strong className="map-stats-bad">
              {coverage.missing.toLocaleString()}
            </strong>
          </div>
          <div className="map-stats-note">
            1 photo / {PHOTO_INTERVAL_M} m · covered = photo within{" "}
            {COVERAGE_RADIUS_M} m · excludes{" "}
            {(coverage.homeConnectionLengthM / 1000).toFixed(2)} km house
            connections
          </div>
        </div>
      )}
      <MapContainer center={center} zoom={zoom} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OSM Humanitarian">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors, Tiles courtesy of Humanitarian OSM Team'
              url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenTopoMap">
            <TileLayer
              attribution='Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>

          {layers.siteCluster && (
            <LayersControl.Overlay checked name="Site cluster">
              <GeoJSON
                data={layers.siteCluster}
                style={clusterStyle}
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    propsTable(f.properties, [
                      "kmlDescriptionSimple",
                      "type",
                      "kmlType",
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
            <LayersControl.Overlay checked name={`Trenches (${layers.trenches.features.length})`}>
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

          {layers.trenches && (
            <LayersControl.Overlay
              checked
              name={`Photo coverage (${coverage.missing} missing)`}
            >
              <GeoJSON
                key={`coverage-${geoPhotos.length}`}
                data={coverage.points}
                pointToLayer={(feature, latlng) =>
                  L.circleMarker(latlng, {
                    radius: 4,
                    weight: 1,
                    color: "#0f1115",
                    fillColor: feature.properties?.covered
                      ? "#22c55e"
                      : "#ef4444",
                    fillOpacity: 0.9,
                  })
                }
                onEachFeature={(f, layer) =>
                  layer.bindPopup(
                    f.properties?.covered ? "Photo present" : "Photo missing",
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
                  const color =
                    (feature.properties?.fillColor as string | undefined) ||
                    "#22c55e";
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
                    hasGps: p.hasGps,
                    latitude: p.latitude,
                    longitude: p.longitude,
                    overlayAddress: p.overlayAddress,
                    depthCm: p.analysis?.depth_cm ?? null,
                    hasTrench: p.analysis?.trench ?? null,
                    hasMeasuringStick: p.analysis?.measuringStick ?? null,
                    isDuplicate: p.analysis?.isDuplicate ?? false,
                    gpsOnSite: p.analysis?.gpsOnSite ?? null,
                  },
                  geometry: {
                    type: "Point",
                    coordinates: [p.longitude as number, p.latitude as number],
                  },
                })),
              }) as FeatureCollection}
              pointToLayer={(_, latlng) => L.marker(latlng)}
              onEachFeature={(f, layer) => {
                const p = f.properties || {};
                // Derive category
                let catLabel = "Pending analysis";
                let catColor = "#6b7280";
                if (p.hasTrench !== null) {
                  if (p.isDuplicate || p.gpsOnSite === false || !p.hasGps) {
                    catLabel = "Cat 4 · Suspect"; catColor = "#ea580c";
                  } else if (p.hasTrench && p.hasMeasuringStick) {
                    catLabel = "Cat 1 · Green"; catColor = "#16a34a";
                  } else if (p.hasTrench) {
                    catLabel = "Cat 2 · Yellow"; catColor = "#b45309";
                  } else {
                    catLabel = "Cat 3 · Red"; catColor = "#dc2626";
                  }
                }
                const location = p.overlayAddress ||
                  (p.latitude != null ? `${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}` : null);
                const html = `
                  <img src="/api/photos/${p.id}" class="popup-thumb" />
                  <div><strong>${p.name}</strong></div>
                  <div style="margin:5px 0">
                    <span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:600;background:${catColor}22;color:${catColor};border:1px solid ${catColor}55">${catLabel}</span>
                  </div>
                  <div class="popup-meta">
                    ${location ? `<div>Location: ${location}</div>` : ""}
                    ${p.depthCm != null ? `<div>Depth: ${p.depthCm} cm</div>` : ""}
                    ${p.takenAt ? `<div>${new Date(p.takenAt).toLocaleString()}</div>` : ""}
                  </div>`;
                layer.bindPopup(html, { maxWidth: 240 });
              }}
            />
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>
    </div>
  );
}
