import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import type { Info } from "./info";
import { countryInfo } from "./countries";
import { cityInfo, loadCities } from "./cities";

const BASE: L.PathOptions = { color: "#6b7a8c", weight: 1, fillColor: "#e8e0c8", fillOpacity: 0.85 };
const HOVER: L.PathOptions = { fillColor: "#f4d27a" };
const SELECTED: L.PathOptions = { fillColor: "#e8913a", weight: 2 };

export async function createMap(el: HTMLElement, onSelect: (info: Info) => void): Promise<void> {
  const map = L.map(el, { worldCopyJump: true, minZoom: 2 }).setView([30, 10], 2);
  const [data, cities] = await Promise.all([
    fetch("./data/countries.geojson").then((r) => r.json() as Promise<FeatureCollection>),
    loadCities(),
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

  const cityLayer = L.layerGroup().addTo(map);
  const markers = cities.map((c) => ({
    z: c.z,
    marker: L.circleMarker([c.lat, c.lon], {
      radius: c.capital ? 6 : 4,
      color: "#fff",
      weight: 1.5,
      fillColor: c.capital ? "#c0392b" : "#2c3e50",
      fillOpacity: 1,
      bubblingMouseEvents: false,
    })
      .bindTooltip(c.name, { direction: "top" })
      .on("click", () => select(null, cityInfo(c))),
  }));

  const updateCities = () => {
    const zoom = map.getZoom();
    for (const { z, marker } of markers) {
      const visible = z <= zoom;
      if (visible !== cityLayer.hasLayer(marker)) visible ? cityLayer.addLayer(marker) : cityLayer.removeLayer(marker);
    }
  };
  map.on("zoomend", updateCities);
  updateCities();

  map.fitBounds(countryLayer.getBounds());
}
