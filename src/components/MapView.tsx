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
            data={{
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
                  coordinates: [p.longitude as number, p.latitude as number],
                },
              })),
            }}
            pointToLayer={(_, latlng) => L.marker(latlng)}
            onEachFeature={(f, layer) => {
              const p = f.properties || {};
              const html = `
                <img src="/api/photos/${p.id}" class="popup-thumb" />
                <div><strong>${p.name}</strong></div>
                <div class="popup-meta">
                  ${p.project ? `Project: ${p.project}` : ""}
                  ${p.lotId ? ` · Lot: ${p.lotId}` : ""}
                  ${p.takenAt ? `<br/>Taken: ${new Date(p.takenAt).toLocaleString()}` : ""}
                </div>`;
              layer.bindPopup(html, { maxWidth: 220 });
            }}
          />
        </LayersControl.Overlay>
      </LayersControl>
    </MapContainer>
  );
}
