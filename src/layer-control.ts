import L from "leaflet";

export interface LayerGroupSpec {
  title: string;
  layers: Record<string, L.Layer>;
  // Högst ett lager i gruppen kan vara tänt samtidigt.
  exclusive?: boolean;
  // Körs när ett lager i gruppen tänds.
  onEnable?: () => void;
}

const STORAGE_KEY = "hiddenLayers";
const DEFAULT_HIDDEN = ["Landformer"];

const loadHidden = (): string[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(DEFAULT_HIDDEN));

class LayerControl extends L.Control {
  constructor(private groups: LayerGroupSpec[]) {
    super({ position: "topleft" });
  }

  onAdd(map: L.Map): HTMLElement {
    const container = L.DomUtil.create("div", "layer-control");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const toggle = L.DomUtil.create("button", "layer-toggle", container);
    toggle.type = "button";
    toggle.textContent = "Lager";
    const body = L.DomUtil.create("div", "layer-body", container);
    body.hidden = window.matchMedia("(max-width: 699px)").matches;
    toggle.addEventListener("click", () => (body.hidden = !body.hidden));

    const actions = L.DomUtil.create("div", "layer-actions", body);
    const boxes: { name: string; layer: L.Layer; input: HTMLInputElement; group: LayerGroupSpec }[] = [];

    const persist = () =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify(boxes.filter((b) => !b.input.checked).map((b) => b.name)));
    const apply = (b: (typeof boxes)[number]) => {
      if (b.input.checked) map.addLayer(b.layer);
      else map.removeLayer(b.layer);
    };
    const setAll = (checked: boolean) => {
      for (const b of boxes) {
        if (checked && b.group.exclusive) continue;
        b.input.checked = checked;
        apply(b);
      }
      persist();
    };

    for (const [label, checked] of [
      ["Alla", true],
      ["Inga", false],
    ] as const) {
      const btn = L.DomUtil.create("button", "layer-action", actions);
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => setAll(checked));
    }

    const hidden = loadHidden();
    for (const group of this.groups) {
      const section = L.DomUtil.create("fieldset", "layer-group", body);
      L.DomUtil.create("legend", "", section).textContent = group.title;
      for (const [name, layer] of Object.entries(group.layers)) {
        const row = L.DomUtil.create("label", "layer-row", section);
        const input = L.DomUtil.create("input", "", row);
        input.type = "checkbox";
        input.checked = !hidden.includes(name);
        row.append(name);
        const box = { name, layer, input, group };
        const rivals = boxes.filter((b) => b.group === group && b.input.checked);
        if (group.exclusive && input.checked && rivals.length) input.checked = false;
        boxes.push(box);
        apply(box);
        input.addEventListener("change", () => {
          if (group.exclusive && input.checked) {
            for (const other of boxes) {
              if (other !== box && other.group === group && other.input.checked) {
                other.input.checked = false;
                apply(other);
              }
            }
          }
          apply(box);
          persist();
          if (input.checked) group.onEnable?.();
        });
      }
    }
    return container;
  }
}

export const addLayerControl = (map: L.Map, groups: LayerGroupSpec[]) => new LayerControl(groups).addTo(map);
