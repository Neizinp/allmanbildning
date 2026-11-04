import "./style.css";
import { createMap } from "./map";
import { toCountry, formatNumber } from "./countries";
import { fetchSummary } from "./wikipedia";

const panel = document.getElementById("panel")!;
const content = document.getElementById("panel-content")!;
document.getElementById("panel-close")!.addEventListener("click", () => (panel.hidden = true));

let current = "";

createMap(document.getElementById("map")!, async (props) => {
  const c = toCountry(props);
  current = c.name;
  content.innerHTML = `
    <h2></h2>
    <p class="sub"></p>
    <dl>
      <dt>Befolkning</dt><dd>${formatNumber(c.population)}</dd>
      <dt>Ekonomi</dt><dd class="economy"></dd>
    </dl>
    <div class="wiki"><p class="muted">Hämtar från Wikipedia …</p></div>`;
  content.querySelector("h2")!.textContent = c.name;
  content.querySelector(".sub")!.textContent = `${c.subregion}, ${c.continent}`;
  content.querySelector(".economy")!.textContent = c.economy;
  panel.hidden = false;

  const summary = await fetchSummary(c.name);
  if (current !== c.name) return;
  const wiki = content.querySelector(".wiki")!;
  wiki.replaceChildren();
  if (!summary) {
    wiki.innerHTML = `<p class="muted">Kunde inte hämta text från Wikipedia.</p>`;
    return;
  }
  const p = document.createElement("p");
  p.textContent = summary.extract;
  const a = document.createElement("a");
  a.href = summary.url;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "Läs mer på Wikipedia";
  wiki.append(p, a);
});
