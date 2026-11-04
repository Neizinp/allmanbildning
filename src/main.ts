import "./style.css";
import { createMap } from "./map";
import { toCountry, formatNumber } from "./countries";

const panel = document.getElementById("panel")!;
const content = document.getElementById("panel-content")!;
document.getElementById("panel-close")!.addEventListener("click", () => (panel.hidden = true));

createMap(document.getElementById("map")!, (props) => {
  const c = toCountry(props);
  content.innerHTML = `
    <h2></h2>
    <p class="sub"></p>
    <dl>
      <dt>Befolkning</dt><dd>${formatNumber(c.population)}</dd>
      <dt>Ekonomi</dt><dd></dd>
    </dl>`;
  content.querySelector("h2")!.textContent = c.name;
  content.querySelector(".sub")!.textContent = `${c.subregion}, ${c.continent}`;
  content.querySelector("dd:last-child")!.textContent = c.economy;
  panel.hidden = false;
});
