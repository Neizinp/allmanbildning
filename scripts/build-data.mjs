// Bygger public/data/*.json från Natural Earth och slår upp svenska Wikipedia-titlar via Wikidata.
import { readFile, writeFile } from "node:fs/promises";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const load = async (name) => (await fetch(`${NE}/${name}.geojson`)).json();

const CACHE = "scripts/.wikidata-cache.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wikiJson(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "allmanbildning-build/0.1 (github.com/Neizinp/allmanbildning)" } });
    try {
      return await res.json();
    } catch {
      if (attempt >= 5) throw new Error("Wikipedia/Wikidata svarar inte");
      await sleep(5000 * (attempt + 1));
    }
  }
}

async function svTitles(ids) {
  const cache = JSON.parse(await readFile(CACHE, "utf8").catch(() => "{}"));
  const todo = [...new Set(ids.filter((id) => id && !(id in cache)))];
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    const url =
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks" +
      `&sitefilter=svwiki&ids=${chunk.join("|")}`;
    const j = await wikiJson(url);
    for (const id of chunk) cache[id] = j.entities?.[id]?.sitelinks?.svwiki?.title ?? null;
    await writeFile(CACHE, JSON.stringify(cache));
    await sleep(1000);
  }
  return new Map(ids.filter((id) => cache[id]).map((id) => [id, cache[id]]));
}

async function buildCities() {
  const { features } = await load("ne_50m_populated_places");
  const sorted = features
    .map((f) => f.properties)
    .sort((a, b) => b.POP_MAX - a.POP_MAX);
  const picked = sorted.filter((p, i) => i < 400 || p.ADM0CAP === 1);
  const titles = await svTitles(picked.map((p) => p.WIKIDATAID));
  const countries = JSON.parse(await readFile("public/data/countries.geojson", "utf8"));
  const svCountry = new Map(countries.features.map((f) => [f.properties.NAME, f.properties.NAME_SV]));
  const cities = picked.map((p, i) => {
    const title = titles.get(p.WIKIDATAID);
    const name = title ? title.replace(/ \(.*\)$/, "") : (p.NAME_SV ?? p.NAME);
    return {
      name,
      title: title ?? name,
      lat: p.LATITUDE,
      lon: p.LONGITUDE,
      pop: p.POP_MAX,
      country: svCountry.get(p.ADM0NAME) ?? p.ADM0NAME,
      capital: p.ADM0CAP === 1,
      z: i < 60 ? 2 : i < 200 || p.ADM0CAP === 1 ? 3 : 4,
    };
  });
  await writeFile("public/data/cities.json", JSON.stringify(cities));
  console.log("cities", cities.length);
}

const round = (n) => Math.round(n * 100) / 100;
const roundCoords = (c) => (typeof c[0] === "number" ? c.map(round) : c.map(roundCoords));
const displayName = (title, fallback) => (title ? title.replace(/ \(.*\)$/, "") : fallback);

async function buildLakes() {
  const { features } = await load("ne_50m_lakes");
  const named = features.filter((f) => f.properties.name && f.properties.wikidataid);
  const titles = await svTitles(named.map((f) => f.properties.wikidataid));
  const lakes = named.map((f) => {
    const p = f.properties;
    const title = titles.get(p.wikidataid);
    const name = displayName(title, p.name_sv ?? p.name_en ?? p.name);
    return {
      type: "Feature",
      properties: { name, title: title ?? name },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    };
  });
  await writeFile("public/data/lakes.geojson", JSON.stringify({ type: "FeatureCollection", features: lakes }));
  console.log("lakes", lakes.length);
}

async function buildMountains() {
  const { features } = await load("ne_10m_geography_regions_elevation_points");
  const named = features.filter((f) => f.properties.name && f.properties.wikidataid);
  const titles = await svTitles(named.map((f) => f.properties.wikidataid));
  const mountains = named.map((f) => {
    const p = f.properties;
    const title = titles.get(p.wikidataid);
    const name = displayName(title, p.name_sv ?? p.name_en ?? p.name);
    const [lon, lat] = f.geometry.coordinates;
    return { name, title: title ?? name, lat: round(lat), lon: round(lon), elevation: p.elevation };
  });
  await writeFile("public/data/mountains.json", JSON.stringify(mountains));
  console.log("mountains", mountains.length);
}

const pick = (p, k) => p[k] ?? p[k.toUpperCase()];
const bboxArea = (coords) => {
  const pts = coords.flat(Infinity);
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};

// Skriver ut en polygonfil med namn, svensk Wikipedia-titel och typ; största ytorna först så små hamnar överst.
async function buildAreas(dataset, outFile, select) {
  const { features } = await load(dataset);
  const chosen = features
    .map((f) => ({ f, kind: select(pick(f.properties, "featurecla")) }))
    .filter((x) => x.kind && pick(x.f.properties, "wikidataid"));
  const titles = await svTitles(chosen.map((x) => pick(x.f.properties, "wikidataid")));
  const out = chosen
    .map(({ f, kind }) => {
      const p = f.properties;
      const title = titles.get(pick(p, "wikidataid"));
      const name = displayName(title, pick(p, "name_sv") ?? pick(p, "name_en") ?? pick(p, "name"));
      return {
        type: "Feature",
        properties: { name, title: title ?? name, kind },
        geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
        area: bboxArea(f.geometry.coordinates),
      };
    })
    .sort((a, b) => b.area - a.area)
    .map(({ area, ...f }) => f);
  await writeFile(outFile, JSON.stringify({ type: "FeatureCollection", features: out }));
  console.log(outFile, out.length);
}

const buildRanges = () =>
  buildAreas("ne_50m_geography_regions_polys", "public/data/ranges.geojson", (c) => (c === "Range/mtn" ? "Bergskedja" : null));

const buildDeserts = () =>
  buildAreas("ne_50m_geography_regions_polys", "public/data/deserts.geojson", (c) => (c === "Desert" ? "Öken" : null));

const LANDFORMS = {
  Plateau: "Platå",
  Peninsula: "Halvö",
  "Pen/cape": "Halvö eller udde",
  Plain: "Slätt",
  Delta: "Delta",
  Basin: "Bäcken",
  Valley: "Dal",
  Lowland: "Lågland",
  Gorge: "Ravin",
  Tundra: "Tundra",
  Isthmus: "Näs",
  Depression: "Sänka",
  Wetlands: "Våtmark",
  Foothills: "Förberg",
};
const buildLandforms = () =>
  buildAreas("ne_50m_geography_regions_polys", "public/data/landforms.geojson", (c) => LANDFORMS[c] ?? null);

const MARINE = { ocean: "Ocean", sea: "Hav", bay: "Bukt", gulf: "Golf", strait: "Sund", channel: "Kanal", sound: "Sund", reef: "Rev" };
const buildMarine = () =>
  buildAreas("ne_50m_geography_marine_polys", "public/data/marine.geojson", (c) => MARINE[c] ?? null);

const RIVER_CACHE = "scripts/.river-cache.json";

// Slår upp svenska titlar för engelska flodnamn via engelska Wikipedias språklänkar.
async function riverTitles(names) {
  const cache = JSON.parse(await readFile(RIVER_CACHE, "utf8").catch(() => "{}"));
  const todo = names.filter((n) => !(n in cache));
  const candidates = (n) => [`${n} River`, `${n} (river)`];
  for (let i = 0; i < todo.length; i += 15) {
    const chunk = todo.slice(i, i + 15);
    const titles = chunk.flatMap(candidates);
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
      `&prop=langlinks|pageprops&lllang=sv&ppprop=disambiguation|wikibase-shortdesc&titles=${encodeURIComponent(titles.join("|"))}`;
    const q = (await wikiJson(url)).query ?? {};
    const alias = new Map();
    for (const r of [...(q.normalized ?? []), ...(q.redirects ?? [])]) alias.set(r.from, r.to);
    const resolve = (t) => {
      for (let k = 0; k < 3 && alias.has(t); k++) t = alias.get(t);
      return t;
    };
    const pages = new Map((q.pages ?? []).map((pg) => [pg.title, pg]));
    for (const n of chunk) {
      cache[n] = null;
      for (const c of candidates(n)) {
        const pg = pages.get(resolve(c));
        if (!pg || pg.missing || pg.pageprops?.disambiguation !== undefined) continue;
        if (!/river|tributary|stream|waterway|canal/i.test(pg.pageprops?.["wikibase-shortdesc"] ?? "")) continue;
        const sv = pg.langlinks?.[0]?.title;
        if (sv) {
          cache[n] = sv;
          break;
        }
      }
    }
    await writeFile(RIVER_CACHE, JSON.stringify(cache));
    await sleep(500);
  }
  return cache;
}

async function buildRivers() {
  const { features } = await load("ne_10m_rivers_lake_centerlines");
  const byName = new Map();
  for (const f of features) {
    const p = f.properties;
    if (p.featurecla !== "River" || !p.name_en || p.scalerank > 7) continue;
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const e = byName.get(p.name_en) ?? { rank: p.scalerank, lines: [] };
    e.rank = Math.min(e.rank, p.scalerank);
    e.lines.push(...lines);
    byName.set(p.name_en, e);
  }
  const names = [...byName.keys()];
  const titles = await riverTitles(names);
  const byTitle = new Map();
  for (const n of names.filter((n) => titles[n])) {
    const e = byTitle.get(titles[n]) ?? { rank: 9, lines: [] };
    e.rank = Math.min(e.rank, byName.get(n).rank);
    e.lines.push(...byName.get(n).lines);
    byTitle.set(titles[n], e);
  }
  const out = [...byTitle].map(([title, e]) => ({
    type: "Feature",
    properties: { name: displayName(title), title, rank: e.rank },
    geometry: { type: "MultiLineString", coordinates: roundCoords(e.lines) },
  }));
  await writeFile("public/data/rivers.geojson", JSON.stringify({ type: "FeatureCollection", features: out }));
  console.log("rivers", out.length, "av", names.length);
}

// Natural Earth saknar regnskogar, så dessa är handritade grova avgränsningar.
const RAINFORESTS = [
  { name: "Amazonas regnskog", titles: ["Amazonas regnskog", "Amazonas"], ring: [[-79,-5],[-75,1],[-70,4],[-62,5],[-52,4],[-50,0],[-48,-2],[-50,-6],[-55,-9],[-60,-12],[-64,-14],[-70,-13],[-75,-10]] },
  { name: "Kongobäckenets regnskog", titles: ["Kongobäckenet", "Kongoregnskogen"], ring: [[9,2],[12,3],[16,3],[20,4],[26,4],[29,1],[30,-3],[27,-6],[22,-6],[17,-5],[13,-4],[10,-1]] },
  { name: "Borneos regnskog", titles: ["Borneos regnskog", "Borneo"], ring: [[109,1],[111,2],[115,4.5],[118,5.5],[119,1.5],[117,-1.5],[115,-3.5],[111,-3],[109.5,-1]] },
  { name: "Sumatras regnskog", titles: ["Sumatras regnskog", "Sumatra"], ring: [[95,5],[98,4],[103,0],[105,-3],[104,-5.5],[101,-3],[98,0]] },
  { name: "Nya Guineas regnskog", titles: ["Nya Guineas regnskog", "Nya Guinea"], ring: [[131,-1],[135,-2.5],[141,-2.7],[147,-6],[150,-10],[143,-9],[138,-8],[134,-4]] },
];

async function buildRainforests() {
  const features = [];
  for (const r of RAINFORESTS) {
    const url =
      "https://sv.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=" +
      encodeURIComponent(r.titles.join("|"));
    const q = (await wikiJson(url)).query;
    const existing = new Set(q.pages.filter((p) => !p.missing).map((p) => p.title));
    const redirects = new Map((q.redirects ?? []).map((x) => [x.from, x.to]));
    const title = r.titles.map((t) => redirects.get(t) ?? t).find((t) => existing.has(t)) ?? r.name;
    console.log(r.name, "->", title);
    features.push({
      type: "Feature",
      properties: { name: r.name, title, kind: "Regnskog" },
      geometry: { type: "Polygon", coordinates: [[...r.ring, r.ring[0]]] },
    });
  }
  await writeFile("public/data/rainforests.geojson", JSON.stringify({ type: "FeatureCollection", features }));
}

async function sparql(query) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: {
        "User-Agent": "allmanbildning-build/0.1 (github.com/Neizinp/allmanbildning)",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/sparql-results+json",
      },
      body: new URLSearchParams({ query }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text).results.bindings.map((b) =>
        Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])),
      );
    } catch {
      if (attempt >= 2) throw new Error(`SPARQL-fel ${res.status}: ${text.slice(0, 400)}`);
      await sleep(10000);
    }
  }
}

const parsePoint = (wkt) => {
  const [lon, lat] = wkt.replace(/^Point\(|\)$/g, "").split(" ").map(Number);
  return { lat: round(lat), lon: round(lon) };
};

// Hämtar punktobjekt som har svensk Wikipedia-artikel; sitelinks används som mått på hur känt objektet är.
async function wikidataPlaces(pattern, minSitelinks, extra = "") {
  const rows = await sparql(`
    SELECT ?item (SAMPLE(?coord) AS ?pt) (SAMPLE(?title) AS ?ttl) (MAX(?sitelinks) AS ?links)
           (SAMPLE(?countryLabel) AS ?cty) (MAX(?elev) AS ?ele) WHERE {
      ${pattern}. ?item wdt:P625 ?coord; wikibase:sitelinks ?sitelinks.
      FILTER(?sitelinks >= ${minSitelinks})
      ?article schema:about ?item; schema:isPartOf <https://sv.wikipedia.org/>; schema:name ?title.
      OPTIONAL { ?item wdt:P17 ?c. ?c rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = "sv") }
      ${extra}
    } GROUP BY ?item`);
  return rows.map((r) => ({
    name: displayName(r.ttl),
    title: r.ttl,
    ...parsePoint(r.pt),
    country: r.cty ?? null,
    elevation: r.ele ? Math.round(Number(r.ele)) : null,
    sitelinks: Number(r.links),
  }));
}

const zoomBySitelinks = (n, high, mid) => (n >= high ? 3 : n >= mid ? 4 : 5);

async function buildVolcanoes() {
  const items = await wikidataPlaces("?item wdt:P31/wdt:P279* wd:Q8072", 12, "OPTIONAL { ?item wdt:P2044 ?elev }");
  const out = items.map(({ sitelinks, ...v }) => ({ ...v, z: zoomBySitelinks(sitelinks, 50, 25) }));
  await writeFile("public/data/volcanoes.json", JSON.stringify(out));
  console.log("volcanoes", out.length);
}

async function buildHeritage() {
  const items = await wikidataPlaces("?item wdt:P1435 wd:Q9259", 8);
  const out = items.map(({ sitelinks, elevation, ...h }) => ({ ...h, z: zoomBySitelinks(sitelinks, 60, 30) }));
  await writeFile("public/data/heritage.json", JSON.stringify(out));
  console.log("heritage", out.length);
}

const only = process.argv[2];
if (!only || only === "cities") await buildCities();
if (!only || only === "lakes") await buildLakes();
if (!only || only === "mountains") await buildMountains();
if (!only || only === "ranges") await buildRanges();
if (!only || only === "rivers") await buildRivers();
if (!only || only === "deserts") await buildDeserts();
if (!only || only === "landforms") await buildLandforms();
if (!only || only === "marine") await buildMarine();
if (!only || only === "rainforests") await buildRainforests();
if (!only || only === "volcanoes") await buildVolcanoes();
if (!only || only === "heritage") await buildHeritage();
