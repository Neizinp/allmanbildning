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

const only = process.argv[2];
if (!only || only === "cities") await buildCities();
if (!only || only === "lakes") await buildLakes();
if (!only || only === "mountains") await buildMountains();
if (!only || only === "ranges") await buildRanges();
if (!only || only === "rivers") await buildRivers();
if (!only || only === "deserts") await buildDeserts();
if (!only || only === "landforms") await buildLandforms();
if (!only || only === "marine") await buildMarine();
