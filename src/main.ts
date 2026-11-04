import "./style.css";
import { createMap } from "./map";
import { fetchSummary } from "./wikipedia";

const panel = document.getElementById("panel")!;
const content = document.getElementById("panel-content")!;
document.getElementById("panel-close")!.addEventListener("click", () => (panel.hidden = true));

let current = "";

createMap(document.getElementById("map")!, async (info) => {
  current = info.name;
  content.innerHTML = `
    <h2></h2>
    <p class="sub"></p>
    <dl></dl>
    <div class="wiki"><p class="muted">Hämtar från Wikipedia …</p></div>`;
  content.querySelector("h2")!.textContent = info.name;
  content.querySelector(".sub")!.textContent = info.subtitle;
  const dl = content.querySelector("dl")!;
  for (const [label, value] of info.facts) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    dl.append(dt, dd);
  }
  panel.hidden = false;

  const summary = await fetchSummary(info.wikiTitle);
  if (current !== info.name) return;
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
