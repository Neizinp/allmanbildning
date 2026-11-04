import L from "leaflet";

// Zoom in, zoom ut och hem på en rad; zoomknapparna döljs på mobil där man nyper.
class NavControl extends L.Control {
  constructor(private bounds: L.LatLngBounds) {
    super({ position: "topleft" });
  }

  onAdd(map: L.Map): HTMLElement {
    const bar = L.DomUtil.create("div", "leaflet-bar leaflet-control nav-bar");
    L.DomEvent.disableClickPropagation(bar);

    const button = (className: string, label: string, text: string, action: () => void) => {
      const a = L.DomUtil.create("a", className, bar);
      a.href = "#";
      a.role = "button";
      a.title = label;
      a.setAttribute("aria-label", label);
      a.textContent = text;
      L.DomEvent.on(a, "click", (e) => {
        L.DomEvent.preventDefault(e);
        if (!a.classList.contains("leaflet-disabled")) action();
      });
      return a;
    };

    const zoomIn = button("zoom-btn", "Zooma in", "+", () => map.zoomIn());
    const zoomOut = button("zoom-btn", "Zooma ut", "−", () => map.zoomOut());
    button("home-btn", "Visa hela världen", "⌂", () => map.fitBounds(this.bounds));

    const update = () => {
      zoomIn.classList.toggle("leaflet-disabled", map.getZoom() >= map.getMaxZoom());
      zoomOut.classList.toggle("leaflet-disabled", map.getZoom() <= map.getMinZoom());
    };
    map.on("zoomend", update);
    update();
    return bar;
  }
}

export const addNavControl = (map: L.Map, bounds: L.LatLngBounds) => new NavControl(bounds).addTo(map);
