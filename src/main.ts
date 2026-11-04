import "./style.css";
import { createMap } from "./map";
import type { Info } from "./info";
import { fetchSummary } from "./wikipedia";
import { loadFacts, wikiUrl, lifespan, type Facts } from "./facts";

const panel = document.getElementById("panel")!;
const content = document.getElementById("panel-content")!;
let clearSelection = () => {};
document.getElementById("panel-close")!.addEventListener("click", () => clearSelection());

let current = "";

function wikiLink(title: string, text: string) {
  const a = document.createElement("a");
  a.href = wikiUrl(title);
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  return a;
}

function renderFacts(el: Element, facts: Facts) {
  const section = (heading: string, items: HTMLElement[]) => {
    if (!items.length) return;
    const h = document.createElement("h3");
    h.textContent = heading;
    const ul = document.createElement("ul");
    ul.append(...items);
    el.append(h, ul);
  };

  section(
    "Händelser",
    [...facts.events].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity)).map((e) => {
      const li = document.createElement("li");
      const year = document.createElement("span");
      year.className = "year";
      year.textContent = e.year === null ? "" : String(e.year);
      li.append(year, wikiLink(e.title, e.name));
      return li;
    }),
  );

  section(
    "Kända personer",
    [...facts.people].sort((a, b) => (b.born ?? -Infinity) - (a.born ?? -Infinity)).map((p) => {
      const li = document.createElement("li");
      li.append(wikiLink(p.title, p.name));
      const meta = [lifespan(p), p.desc].filter(Boolean).join(", ");
      if (meta) {
        const span = document.createElement("span");
        span.className = "muted";
        span.textContent = ` (${meta})`;
        li.append(span);
      }
      return li;
    }),
  );
}

const showInfo = async (info: Info) => {
  current = info.name;
  content.innerHTML = `
    <div class="image"></div>
    <h2></h2>
    <p class="sub"></p>
    <dl></dl>
    <div class="wiki"><p class="muted">Hämtar från Wikipedia …</p></div>
    <div class="facts"></div>`;
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
  const image = content.querySelector<HTMLElement>(".image")!;
  const showImage = (src: string, alt: string, className = "") => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.className = className;
    image.replaceChildren(img);
  };
  if (info.flagUrl) showImage(info.flagUrl, `Flagga: ${info.name}`, "flag");
  panel.hidden = false;

  if (info.qid) {
    loadFacts(info.qid).then((facts) => {
      if (facts && current === info.name) renderFacts(content.querySelector(".facts")!, facts);
    });
  }

  const wiki = content.querySelector(".wiki")!;
  if (info.hideIntro) {
    wiki.replaceChildren(wikiLink(info.wikiTitle, "Läs mer på Wikipedia"));
    return;
  }

  const summary = await fetchSummary(info.wikiTitle);
  if (current !== info.name) return;
  wiki.replaceChildren();
  if (info.showWikiImage && summary?.thumbnail) showImage(summary.thumbnail, info.name, "photo");
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

};

const hideInfo = () => {
  panel.hidden = true;
  current = "";
};

createMap(document.getElementById("map")!, showInfo, hideInfo).then((clear) => (clearSelection = clear));
