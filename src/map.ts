import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";

const BASE: L.PathOptions = { color: "#6b7a8c", weight: 1, fillColor: "#e8e0c8", fillOpacity: 0.85 };
const HOVER: L.PathOptions = { fillColor: "#f4d27a" };
const SELECTED: L.PathOptions = { fillColor: "#e8913a", weight: 2 };

export async function createMap(
  el: HTMLElement,
  onSelect: (props: Record<string, unknown>) => void,
): Promise<void> {
  const map = L.map(el, { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([30, 10], 2);
  const data: FeatureCollection = await (await fetch("./data/countries.geojson")).json();

  let selected: L.Path | null = null;
  const layer = L.geoJSON(data, {
    style: BASE,
    onEachFeature(feature: Feature, l) {
      const path = l as L.Path;
      path.on({
        mouseover: () => path !== selected && path.setStyle(HOVER),
        mouseout: () => path !== selected && path.setStyle(BASE),
        click: () => {
          selected?.setStyle(BASE);
          selected = path;
          path.setStyle(SELECTED);
          onSelect(feature.properties ?? {});
        },
      });
    },
  }).addTo(map);

  map.fitBounds(layer.getBounds());
}
