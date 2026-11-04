import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import type { Info } from "./info";
import { countryInfo } from "./countries";
import { cityInfo, loadCities, type City } from "./cities";
import { namedInfo, loadMountains, mountainInfo, mountainMinZoom, type Mountain } from "./nature";

const BASE: L.PathOptions = { color: "#6b7a8c", weight: 1, fillColor: "#e8e0c8", fillOpacity: 0.85 };
const HOVER: L.PathOptions = { fillColor: "#f4d27a" };
const SELECTED: L.PathOptions = { fillColor: "#e8913a", weight: 2 };

export async function createMap(el: HTMLElement, onSelect: (info: Info) => void): Promise<void> {
  const map = L.map(el, { worldCopyJump: true, minZoom: 2 }).setView([30, 10], 2);
  const json = (url: string) => fetch(url).then((r) => r.json());
  const [data, lakes, ranges, rivers, cities, mountains]: [
    FeatureCollection,
    FeatureCollection,
    FeatureCollection,
    FeatureCollection,
    City[],
    Mountain[],
  ] = await Promise.all([
    json("./data/countries.geojson"),
    json("./data/lakes.geojson"),
    json("./data/ranges.geojson"),
    json("./data/rivers.geojson"),
    loadCities(),
    loadMountains(),
  ]);

  let selected: L.Path | null = null;
  const select = (path: L.Path | null, info: Info) => {
    selected?.setStyle(BASE);
    selected = path;
    path?.setStyle(SELECTED);
    onSelect(info);
  };

  const countryLayer = L.geoJSON(data, {
    style: BASE,
    onEachFeature(feature: Feature, l) {
      const path = l as L.Path;
      path.on({
        mouseover: () => path !== selected && path.setStyle(HOVER),
        mouseout: () => path !== selected && path.setStyle(BASE),
        click: () => select(path, countryInfo(feature.properties ?? {})),
      });
    },
  }).addTo(map);

  type Named = { name: string; title: string };
  const selectable = (kind: string) => (feature: Feature, l: L.Layer) => {
    const props = feature.properties as Named;
    l.bindTooltip(props.name, { sticky: true }).on("click", () => select(null, namedInfo(kind)(props)));
  };

  const rangeLayer = L.geoJSON(ranges, {
    style: { color: "#8a5a2b", weight: 1, fillColor: "#a47148", fillOpacity: 0.45, bubblingMouseEvents: false },
    onEachFeature: selectable("Bergskedja"),
  }).addTo(map);

  const lakeLayer = L.geoJSON(lakes, {
    style: { color: "#3b82b6", weight: 1, fillColor: "#7fb6e0", fillOpacity: 0.95, bubblingMouseEvents: false },
    onEachFeature: selectable("Sjö"),
  }).addTo(map);

  const riverWeight = (rank: number) => (rank <= 2 ? 3 : rank <= 4 ? 2 : 1.5);
  const riverLayer = L.layerGroup([
    L.geoJSON(rivers, {
      interactive: false,
      style: (f) => ({ color: "#3b82b6", weight: riverWeight(f?.properties.rank) }),
    }),
    // Osynlig bred kopia som gör floderna lätta att träffa med fingret.
    L.geoJSON(rivers, {
      style: { color: "#000", weight: 14, opacity: 0, bubblingMouseEvents: false },
      onEachFeature: selectable("Flod"),
    }),
  ]).addTo(map);

  // Punktlager där varje objekt har en lägsta zoomnivå.
  const gatedLayer = <T extends { name: string }>(items: T[], minZoom: (i: T) => number, make: (i: T) => L.Layer) => {
    const group = L.layerGroup().addTo(map);
    const entries = items.map((i) => ({ z: minZoom(i), layer: make(i).bindTooltip(i.name, { direction: "top" }) }));
    const update = () => {
      for (const { z, layer } of entries) {
        const visible = z <= map.getZoom();
        if (visible !== group.hasLayer(layer)) visible ? group.addLayer(layer) : group.removeLayer(layer);
      }
    };
    map.on("zoomend", update);
    update();
    return group;
  };

  const cityLayer = gatedLayer(
    cities,
    (c) => c.z,
    (c) =>
      L.circleMarker([c.lat, c.lon], {
        radius: c.capital ? 6 : 4,
        color: "#fff",
        weight: 1.5,
        fillColor: c.capital ? "#c0392b" : "#2c3e50",
        fillOpacity: 1,
        bubblingMouseEvents: false,
      }).on("click", () => select(null, cityInfo(c))),
  );

  const mountainLayer = gatedLayer(
    mountains,
    mountainMinZoom,
    (m) =>
      L.marker([m.lat, m.lon], {
        icon: L.divIcon({ className: "mountain-icon", html: "▲", iconSize: [16, 16] }),
        bubblingMouseEvents: false,
      }).on("click", () => select(null, mountainInfo(m))),
  );

  const overlays = {
    Städer: cityLayer,
    Bergstoppar: mountainLayer,
    Bergskedjor: rangeLayer,
    Sjöar: lakeLayer,
    Floder: riverLayer,
  };
  L.control.layers(undefined, overlays, { collapsed: true }).addTo(map);

  const STORAGE_KEY = "hiddenLayers";
  const hidden: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  for (const [name, layer] of Object.entries(overlays)) if (hidden.includes(name)) map.removeLayer(layer);
  const persist = () =>
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.entries(overlays).filter(([, l]) => !map.hasLayer(l)).map(([n]) => n)),
    );
  map.on("overlayadd overlayremove", persist);

  map.fitBounds(countryLayer.getBounds());
}
