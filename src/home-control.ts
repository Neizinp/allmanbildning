import L from "leaflet";

class HomeControl extends L.Control {
  constructor(private bounds: L.LatLngBounds) {
    super({ position: "topleft" });
  }

  onAdd(map: L.Map): HTMLElement {
    const bar = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const button = L.DomUtil.create("a", "home-button", bar);
    button.href = "#";
    button.role = "button";
    button.title = "Visa hela världen";
    button.setAttribute("aria-label", "Visa hela världen");
    button.textContent = "⌂";
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, "click", (e) => {
      L.DomEvent.preventDefault(e);
      map.fitBounds(this.bounds);
    });
    return bar;
  }
}

export const addHomeControl = (map: L.Map, bounds: L.LatLngBounds) => new HomeControl(bounds).addTo(map);
