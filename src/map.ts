import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import type { Info } from "./info";
import { countryInfo, type CountryFacts } from "./countries";
import { addLayerControl } from "./layer-control";
import { cityInfo, loadCities, type City } from "./cities";
import { namedInfo, loadMountains, mountainInfo, mountainMinZoom, loadVolcanoes, volcanoInfo, loadHeritage, heritageInfo, type Mountain, type Volcano, type HeritageSite } from "./nature";

const BASE: L.PathOptions = {
  color: "#6b7a8c",
  weight: 1,
  fillColor: "#e8e0c8",
  fillOpacity: 1,
  bubblingMouseEvents: false,
};
const HOVER: L.PathOptions = { fillColor: "#f4d27a" };
const SELECTED: L.PathOptions = { fillColor: "#e8913a", weight: 2 };

export async function createMap(
  el: HTMLElement,
  onSelect: (info: Info) => void,
  onClear: () => void,
): Promise<() => void> {
  const map = L.map(el, { worldCopyJump: true, minZoom: 2 }).setView([30, 10], 2);
  const json = (url: string) => fetch(url).then((r) => r.json());
  const [data, lakes, ranges, rivers, cities, mountains, volcanoes, heritage]: [
    FeatureCollection,
    FeatureCollection,
    FeatureCollection,
    FeatureCollection,
    City[],
    Mountain[],
    Volcano[],
    HeritageSite[],
  ] = await Promise.all([
    json("./data/countries.geojson"),
    json("./data/lakes.geojson"),
    json("./data/ranges.geojson"),
    json("./data/rivers.geojson"),
    loadCities(),
    loadMountains(),
    loadVolcanoes(),
    loadHeritage(),
  ]);

  const countryFacts: Record<string, CountryFacts> = await json("./data/country-facts.json");

  let selected: L.Path | null = null;
  const resetCountry = (path: L.Path | null) => path && countryLayer.resetStyle(path);
  const select = (path: L.Path | null, info: Info) => {
    resetCountry(selected);
    selected = path;
    path?.setStyle(SELECTED);
    onSelect(info);
  };
  const clear = () => {
    resetCountry(selected);
    selected = null;
    onClear();
  };
  map.on("click", clear);
  document.addEventListener("keydown", (e) => e.key === "Escape" && clear());

  const countryLayer = L.geoJSON(data, {
    style: (f) => ({ ...BASE, fillColor: f?.properties.COLOR ?? BASE.fillColor }),
    onEachFeature(feature: Feature, l) {
      const path = l as L.Path;
      path.on({
        mouseover: () => path !== selected && path.setStyle(HOVER),
        mouseout: () => path !== selected && countryLayer.resetStyle(path),
        click: () => select(path, countryInfo(feature.properties ?? {}, countryFacts[feature.properties?.WIKIDATAID])),
      });
    },
  }).addTo(map);

  type Named = { name: string; title: string };
  const selectable = (kind: string) => (feature: Feature, l: L.Layer) => {
    const props = feature.properties as Named & { kind?: string };
    l.bindTooltip(props.name, { sticky: true }).on("click", () => select(null, namedInfo(props.kind ?? kind)(props)));
  };

  const area = async (file: string, color: string, fill: string, fillOpacity: number, options: L.GeoJSONOptions = {}) =>
    L.geoJSON((await json(`./data/${file}.geojson`)) as FeatureCollection, {
      style: { color, weight: 1, fillColor: fill, fillOpacity, bubblingMouseEvents: false },
      onEachFeature: selectable(""),
      ...options,
    });

  map.createPane("marine").style.zIndex = "250";
  const marineLayer = (
    await area("marine", "#4a90c2", "#8fbfe3", 0.4, {
      pane: "marine",
      style: { weight: 0, fillColor: "#8fbfe3", fillOpacity: 0.4, bubblingMouseEvents: false },
    })
  ).addTo(map);
  const landformLayer = (await area("landforms", "#7b6aa8", "#9a8cc4", 0.25)).addTo(map);
  const desertLayer = (await area("deserts", "#c79a2e", "#e9c46a", 0.5)).addTo(map);
  const rainforestLayer = (await area("rainforests", "#1e6b3a", "#3f9a5b", 0.5)).addTo(map);

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

  const iconMarker = (lat: number, lon: number, className: string, symbol: string) =>
    L.marker([lat, lon], {
      icon: L.divIcon({ className, html: symbol, iconSize: [18, 18] }),
      bubblingMouseEvents: false,
    });

  const volcanoLayer = gatedLayer(
    volcanoes,
    (v) => v.z,
    (v) => iconMarker(v.lat, v.lon, "volcano-icon", "▲").on("click", () => select(null, volcanoInfo(v))),
  );

  const heritageLayer = gatedLayer(
    heritage,
    (h) => h.z,
    (h) => iconMarker(h.lat, h.lon, "heritage-icon", "◆").on("click", () => select(null, heritageInfo(h))),
  );

  const countyLayer = L.geoJSON((await json("./data/sweden-counties.geojson")) as FeatureCollection, {
    style: { color: "#7d8a99", weight: 1, dashArray: "4 3", fill: false },
    interactive: false,
  }).addTo(map);

  addLayerControl(map, [
    { title: "Platser", layers: { Städer: cityLayer, Världsarv: heritageLayer, Vulkaner: volcanoLayer, Bergstoppar: mountainLayer } },
    {
      title: "Natur",
      layers: {
        Bergskedjor: rangeLayer,
        Öknar: desertLayer,
        Regnskogar: rainforestLayer,
        Sjöar: lakeLayer,
        Floder: riverLayer,
        "Hav och sund": marineLayer,
        Landformer: landformLayer,
      },
    },
    { title: "Sverige", layers: { Län: countyLayer } },
  ]);

  map.fitBounds(countryLayer.getBounds());
  if (import.meta.env.DEV) (window as unknown as { __map: L.Map }).__map = map;
  return clear;
}
