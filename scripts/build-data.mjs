// Bygger public/data/*.json från Natural Earth och slår upp svenska Wikipedia-titlar via Wikidata.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import jpeg from "jpeg-js";
import { sleep, sparql, wikiJson } from "./wikidata.mjs";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const load = async (name) => (await fetch(`${NE}/${name}.geojson`)).json();

const CACHE = "scripts/.wikidata-cache.json";

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

// Senast daterade befolkningssiffran per objekt från Wikidata (P1082 med tidpunkt P585).
async function latestPopulation(qids) {
  const rows = await sparql(`
    SELECT ?c ?pop ?date WHERE {
      VALUES ?c { ${qids.map((q) => `wd:${q}`).join(" ")} }
      ?c p:P1082 ?st. ?st ps:P1082 ?pop; pq:P585 ?date.
      ?st wikibase:rank ?rk. FILTER(?rk != wikibase:DeprecatedRank)
    }`);
  const best = new Map();
  for (const r of rows) {
    const q = r.c.split("/").pop();
    const year = Number(r.date.slice(0, 4));
    if (year >= 2005 && (!best.has(q) || year > best.get(q).year)) best.set(q, { pop: Math.round(Number(r.pop)), year });
  }
  return best;
}

// Tätorter i Sverige; stad/kommun-objekt ger dubbletter och felaktiga siffror.
async function swedishPlaces() {
  const rows = await sparql(`
    SELECT ?item (SAMPLE(?ttl) AS ?t) (MAX(?pop) AS ?p) (SAMPLE(?coord) AS ?pt) WHERE {
      VALUES ?cls { wd:Q12813115 }
      ?item wdt:P31 ?cls; wdt:P17 wd:Q34; wdt:P1082 ?pop; wdt:P625 ?coord.
      FILTER(?pop >= 5000)
      ?a schema:about ?item; schema:isPartOf <https://sv.wikipedia.org/>; schema:name ?ttl.
    } GROUP BY ?item`);
  const qids = rows.map((r) => r.item.split("/").pop());
  const populations = await latestPopulation(qids);
  const seen = new Set();
  return rows
    .map((r, i) => {
      const qid = qids[i];
      const wd = populations.get(qid);
      const pop = wd?.pop ?? Math.round(Number(r.p));
      return {
        name: displayName(r.t),
        title: r.t,
        qid,
        ...parsePoint(r.pt),
        pop,
        popYear: wd?.year ?? null,
        country: "Sverige",
        capital: qid === "Q1754",
        z: pop >= 200000 ? 3 : pop >= 50000 ? 4 : pop >= 20000 ? 5 : pop >= 10000 ? 6 : 7,
      };
    })
    .filter((c) => !/^(Stockholm|Göteborg)( \(tätort\))?$|Göteborg$| och /.test(c.title))
    .concat(await bigSwedishCities())
    .sort((a, b) => b.pop - a.pop)
    .filter((c) => !seen.has(c.title) && seen.add(c.title));
}

// Wikidatas tätortsposter för Stockholm och Göteborg är delområden med fel siffror, så de anges separat.
async function bigSwedishCities() {
  const wd = (await latestPopulation(["Q1754"])).get("Q1754");
  return [
    { name: "Stockholm", title: "Stockholm", qid: "Q1754", lat: 59.33, lon: 18.07, pop: wd?.pop ?? 984748, popYear: wd?.year ?? 2022, country: "Sverige", capital: true, z: 3 },
    // Natural Earths siffra saknar årtal.
    { name: "Göteborg", title: "Göteborg", qid: "Q25287", lat: 57.71, lon: 11.97, pop: 537797, popYear: null, country: "Sverige", capital: false, z: 3 },
  ];
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
  const svByIso = new Map(countries.features.map((f) => [f.properties.ISO_A2_EH, f.properties.NAME_SV]));
  const populations = await latestPopulation(picked.map((p) => p.WIKIDATAID));
  const cities = picked.map((p, i) => {
    const title = titles.get(p.WIKIDATAID);
    const wd = populations.get(p.WIKIDATAID);
    const name = title ? title.replace(/ \(.*\)$/, "") : (p.NAME_SV ?? p.NAME);
    return {
      name,
      title: title ?? name,
      qid: p.WIKIDATAID,
      lat: p.LATITUDE,
      lon: p.LONGITUDE,
      pop: wd?.pop ?? p.POP_MAX,
      popYear: wd?.year ?? null,
      country: svByIso.get(p.ISO_A2) ?? svCountry.get(p.ADM0NAME) ?? p.ADM0NAME,
      capital: p.ADM0CAP === 1,
      z: i < 60 ? 2 : i < 200 || p.ADM0CAP === 1 ? 3 : 4,
    };
  });
  const all = [...cities.filter((c) => c.country !== "Sverige"), ...(await swedishPlaces())];
  await writeFile("public/data/cities.json", JSON.stringify(all));
  console.log("cities", all.length, "varav Sverige", all.length - cities.filter((c) => c.country !== "Sverige").length);
}

const round = (n) => Math.round(n * 100) / 100;
const roundCoords = (c) => (typeof c[0] === "number" ? c.map(round) : c.map(roundCoords));
const displayName = (title, fallback) => (title ? title.replace(/ \(.*\)$/, "") : fallback);
// Tar bort geografiska tillägg som "Mount Baker, Washington" i visningsnamnet.
const shortName = (title) => displayName(title).split(", ")[0];
const uniqueBy = (items, key) => {
  const seen = new Set();
  return items.filter((x) => !seen.has(key(x)) && seen.add(key(x)));
};
// Behåller tillägget ("Gamla staden, Bern") bara när det kortade namnet annars blir tvetydigt.
const disambiguate = (items) => {
  const n = {};
  for (const i of items) n[i.name] = (n[i.name] ?? 0) + 1;
  return items.map((i) => (n[i.name] > 1 ? { ...i, name: displayName(i.title) } : i));
};
const mergeGeometries = (geoms) => {
  const polygons = geoms.flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates));
  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
};

const buildLakes = () => buildAreas("ne_50m_lakes", "public/data/lakes.geojson", () => "Sjö");

async function buildMountains() {
  const { features } = await load("ne_10m_geography_regions_elevation_points");
  const named = features.filter((f) => f.properties.name && f.properties.wikidataid);
  const titles = await svTitles(named.map((f) => f.properties.wikidataid));
  // Bara berg som har en egen svensk Wikipedia-artikel; högsta först så dubbletter får rätt höjd.
  const mountains = uniqueBy(
    named
      .filter((f) => titles.has(f.properties.wikidataid))
      .map((f) => {
        const title = titles.get(f.properties.wikidataid);
        const [lon, lat] = f.geometry.coordinates;
        return { name: shortName(title), title, lat: round(lat), lon: round(lon), elevation: f.properties.elevation };
      })
      .sort((a, b) => b.elevation - a.elevation),
    (m) => m.title,
  );
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
async function buildAreas(dataset, outFile, select, colorMode = null) {
  const { features } = await load(dataset);
  const chosen = features
    .map((f) => ({ f, kind: select(pick(f.properties, "featurecla")) }))
    .filter((x) => x.kind && pick(x.f.properties, "wikidataid") && pick(x.f.properties, "name"));
  const titles = await svTitles(chosen.map((x) => pick(x.f.properties, "wikidataid")));
  const satellite = colorMode ? await loadSatellite() : null;
  const byTitle = new Map();
  for (const { f, kind } of chosen) {
    const title = titles.get(pick(f.properties, "wikidataid"));
    if (!title) continue;
    const e = byTitle.get(title) ?? { kind, geoms: [] };
    e.geoms.push(f.geometry);
    byTitle.set(title, e);
  }
  const out = [...byTitle]
    .map(([title, { kind, geoms }]) => {
      const geometry = mergeGeometries(geoms);
      return {
        type: "Feature",
        properties: {
          name: shortName(title),
          title,
          kind,
          ...(colorMode ? { color: averageColor(geometry, satellite, colorMode) } : {}),
        },
        geometry: { type: geometry.type, coordinates: roundCoords(geometry.coordinates) },
        area: bboxArea(geometry.coordinates),
      };
    })
    .sort((a, b) => b.area - a.area)
    .map(({ area, ...f }) => f);
  if (colorMode) {
    for (const feature of out) {
      if (feature.properties.color) continue;
      const peers = out.filter((other) => other.properties.kind === feature.properties.kind && other.properties.color);
      const channels = peers.map((other) => other.properties.color.match(/[\da-f]{2}/gi).map((v) => parseInt(v, 16)));
      feature.properties.color = `#${[0, 1, 2]
        .map((i) => Math.round(channels.reduce((sum, rgb) => sum + rgb[i], 0) / channels.length).toString(16).padStart(2, "0"))
        .join("")}`;
    }
  }
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
  buildAreas("ne_50m_geography_marine_polys", "public/data/marine.geojson", (c) => MARINE[c] ?? null, "water");

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
    properties: { name: shortName(title), title, rank: e.rank },
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
  // Koordinater på andra himlakroppar har ett globsprefix före "Point(".
  return rows.filter((r) => r.pt.startsWith("Point(")).map((r) => ({
    name: shortName(r.ttl),
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
  const out = disambiguate(
    uniqueBy(
      items.sort((a, b) => b.sitelinks - a.sitelinks),
      (v) => v.title,
    ),
  ).map(({ sitelinks, ...v }) => ({ ...v, z: zoomBySitelinks(sitelinks, 50, 25) }));
  await writeFile("public/data/volcanoes.json", JSON.stringify(out));
  console.log("volcanoes", out.length);
}

async function buildHeritage() {
  const items = await wikidataPlaces("?item wdt:P1435 wd:Q9259", 8);
  const out = disambiguate(
    uniqueBy(
      items.sort((a, b) => b.sitelinks - a.sitelinks),
      (h) => h.title,
    ),
  ).map(({ sitelinks, elevation, ...h }) => ({ ...h, z: zoomBySitelinks(sitelinks, 60, 30) }));
  await writeFile("public/data/heritage.json", JSON.stringify(out));
  console.log("heritage", out.length);
}

const COUNTRY_PROPS = ["NAME", "NAME_SV", "POP_EST", "POP_YEAR", "CONTINENT", "SUBREGION", "ISO_A2_EH", "WIKIDATAID"];
const pickProps = (p) => Object.fromEntries(COUNTRY_PROPS.map((k) => [k, p[k]]));
const roundTo = (n, d) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const roundDeep = (c, d) => (typeof c[0] === "number" ? c.map((n) => roundTo(n, d)) : c.map((x) => roundDeep(x, d)));

const SATELLITE = "scripts/.bluemarble.jpg";
const SATELLITE_URL = "https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img/earth-blue-marble.jpg";

async function loadSatellite() {
  if (!existsSync(SATELLITE)) await writeFile(SATELLITE, Buffer.from(await (await fetch(SATELLITE_URL)).arrayBuffer()));
  return jpeg.decode(await readFile(SATELLITE), { useTArray: true });
}

const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Ytvägt medelvärde av satellitbildens landpixlar inuti landets polygoner.
function averageColor(geometry, img, mode = "land") {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const sum = [0, 0, 0, 0];
  const all = [0, 0, 0, 0];
  for (const poly of polygons) {
    const outer = poly[0];
    const xs = outer.map((c) => c[0]);
    const ys = outer.map((c) => c[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const step = Math.max(Math.sqrt(((x1 - x0) * (y1 - y0)) / 3000), 0.005);
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        if (!inRing(x, y, outer) || poly.slice(1).some((h) => inRing(x, y, h))) continue;
        const px = Math.min(img.width - 1, Math.floor(((x + 180) / 360) * img.width));
        const py = Math.min(img.height - 1, Math.floor(((90 - y) / 180) * img.height));
        const i = (py * img.width + px) * 4;
        const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
        const w = step * step * Math.cos((y * Math.PI) / 180);
        const water = b > r * 1.3 && b > g * 1.05 && r + g + b < 360;
        const selected = mode === "water" ? water : !water;
        for (const acc of selected ? [all, sum] : [all]) {
          acc[0] += r * w;
          acc[1] += g * w;
          acc[2] += b * w;
          acc[3] += w;
        }
      }
    }
  }
  const acc = sum[3] > 0 ? sum : all;
  if (acc[3] === 0) return null;
  const tint = mode === "water" ? 0.22 : 0.25;
  const hex = (v) => Math.round((v / acc[3]) * (1 - tint) + 255 * tint).toString(16).padStart(2, "0");
  return `#${hex(acc[0])}${hex(acc[1])}${hex(acc[2])}`;
}

// Världen i 50m-upplösning, men Sverige (och grannarna, så att gränserna passar) i 10m med Gotland och Öland.
async function buildWorld() {
  const satellite = await loadSatellite();
  const world = await load("ne_50m_admin_0_countries");
  const detailed = new Map((await load("ne_10m_admin_0_countries")).features.map((f) => [f.properties.ISO_A2_EH, f]));
  const features = world.features.map((f) => {
    const iso = f.properties.ISO_A2_EH;
    const detail = ["SE", "NO", "FI", "DK"].includes(iso) ? detailed.get(iso) : null;
    const geometry = detail ?? f;
    const digits = iso === "SE" ? 3 : 2;
    return {
      type: "Feature",
      properties: { ...pickProps(f.properties), COLOR: averageColor(geometry.geometry, satellite) },
      geometry: { type: geometry.geometry.type, coordinates: roundDeep(geometry.geometry.coordinates, digits) },
    };
  });
  await writeFile("public/data/countries.geojson", JSON.stringify({ type: "FeatureCollection", features }));
  console.log("countries", features.length);
}

// Landskapsgränser från Lantmäteriets distriktskarta (CC0), klippta mot kustlinjen.
const PROVINCES_URL = "https://raw.githubusercontent.com/perliedman/svenska-landskap/master/svenska-landskap-klippt.geo.json";
const PROVINCE_TITLES = { Lappland: "Lappland, Sverige" };

const stripHtml = (h) =>
  h
    .replace(/<sup[\s\S]*?<\/sup>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Läser landskapsdjur och landskapsblomma ur artikelns faktaruta; första värdet om flera anges.
async function infoboxSymbols(title) {
  const j = await wikiJson(
    `https://sv.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&redirects=1&page=${encodeURIComponent(title)}`,
  );
  const symbols = {};
  for (const m of j.parse.text.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const cells = [...m[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/g)].map((c) => stripHtml(c[0]));
    const kind = /^Landskaps(djur|blomma)/i.exec(cells[0] ?? "")?.[1]?.toLowerCase();
    if (kind && cells[1]) symbols[kind] = cells[1].split(/,|\//)[0].replace(/\s*\(.*\)$/, "").trim();
    const pop = /^Folkmängd/i.test(cells[0] ?? "") ? /^([\d\s]+?)\s*\((\d{4})/.exec(cells[1] ?? "") : null;
    if (pop) {
      symbols.pop = Number(pop[1].replace(/\s/g, ""));
      symbols.popYear = Number(pop[2]);
    }
  }
  return symbols;
}

const commonsUrl = (file, width) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replaceAll(" ", "_"))}?width=${width}`;
// Handvalda landmärken som ger ett representativt foto för varje landskap (artikelns huvudbild används).
const PHOTO_ARTICLES = {
  Skåne: "Kullaberg",
  Blekinge: "Karlskrona",
  Öland: "Stora alvaret",
  Halland: "Varbergs fästning",
  Småland: "Kosta glasbruk",
  Gotland: "Visby ringmur",
  Västergötland: "Läckö slott",
  Östergötland: "Vadstena slott",
  Bohuslän: "Smögen",
  Dalsland: "Håverud",
  Närke: "Örebro slott",
  Södermanland: "Gripsholms slott",
  Värmland: "Mårbacka",
  Västmanland: "Anundshög",
  Uppland: "Uppsala domkyrka",
  Gästrikland: "Gävle slott",
  Dalarna: "Falu koppargruva",
  Hälsingland: "Hälsingegårdar",
  Härjedalen: "Helagsfjället",
  Ångermanland: "Skuleberget",
  Jämtland: "Tännforsen",
  Västerbotten: "Vindelfjällens naturreservat",
  Lappland: "Lapporten",
  Norrbotten: "Gammelstads kyrkstad",
};
// Där landmärkets huvudbild inte duger anges bildfilen direkt.
const PHOTO_FILES = { Medelpad: "Högomfältet panorama.jpg" };

async function leadPhotos() {
  const titles = Object.values(PHOTO_ARTICLES);
  const j = await wikiJson(
    "https://sv.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages&piprop=name" +
      `&titles=${encodeURIComponent(titles.join("|"))}`,
  );
  const redirects = new Map((j.query.redirects ?? []).map((r) => [r.from, r.to]));
  const image = new Map(j.query.pages.map((p) => [p.title, p.pageimage ?? null]));
  const out = { ...PHOTO_FILES };
  for (const [name, title] of Object.entries(PHOTO_ARTICLES)) out[name] = image.get(redirects.get(title) ?? title)?.replaceAll("_", " ") ?? null;
  return out;
}

async function buildProvinces() {
  const { features } = await (await fetch(PROVINCES_URL)).json();
  const names = features.map((f) => f.properties.landskap);
  const wanted = names.map((n) => PROVINCE_TITLES[n] ?? n);
  const q = await wikiJson(
    "https://sv.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&ppprop=disambiguation|wikibase_item" +
      `&titles=${encodeURIComponent(wanted.join("|"))}`,
  );
  const redirects = new Map((q.query.redirects ?? []).map((r) => [r.from, r.to]));
  const pages = new Map(q.query.pages.map((p) => [p.title, p]));

  // Vapen (P94) från Wikidata.
  const qids = wanted.map((w) => pages.get(redirects.get(w) ?? w)?.pageprops?.wikibase_item);
  const wd = await wikiJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qids.filter(Boolean).join("|")}`,
  );
  const crestFile = (qid) => wd.entities?.[qid]?.claims?.P94?.[0]?.mainsnak?.datavalue?.value ?? null;

  const photos = await leadPhotos();
  const out = [];
  for (const [i, f] of features.entries()) {
    const title = redirects.get(wanted[i]) ?? wanted[i];
    const page = pages.get(title);
    if (!page || page.missing || page.pageprops?.disambiguation !== undefined) console.warn("saknar bra artikel:", wanted[i]);
    const symbols = await infoboxSymbols(title);
    await sleep(700);
    const photo = photos[names[i]];
    const crest = crestFile(qids[i]);
    if (!photo) console.warn("saknar foto:", names[i]);
    if (!crest) console.warn("saknar vapen:", names[i]);
    if (!symbols.pop) console.warn("saknar befolkning:", names[i]);
    if (!symbols.djur || !symbols.blomma) console.warn("saknar djur/blomma:", names[i], symbols);
    out.push({
      type: "Feature",
      properties: {
        name: names[i],
        title,
        landsdel: f.properties.landsdel,
        djur: symbols.djur ?? null,
        blomma: symbols.blomma ?? null,
        pop: symbols.pop ?? null,
        popYear: symbols.popYear ?? null,
        vapen: crest ? commonsUrl(crest, 200) : null,
        foto: photo ? commonsUrl(photo, 640) : null,
        fotoFil: photo,
      },
      geometry: { type: f.geometry.type, coordinates: roundDeep(f.geometry.coordinates, 3) },
    });
  }
  await writeFile("public/data/sweden-provinces.geojson", JSON.stringify({ type: "FeatureCollection", features: out }));
  console.log("landskap", out.length);
}

async function buildCounties() {
  const { features } = await load("ne_10m_admin_1_states_provinces");
  const counties = features.filter((f) => f.properties.admin === "Sweden");
  const qids = counties.map((f) => f.properties.wikidataid);
  const titles = await svTitles(qids);
  const populations = await latestPopulation(qids);
  const residences = await sparql(`
    SELECT ?c ?l WHERE {
      VALUES ?c { ${qids.map((q) => `wd:${q}`).join(" ")} }
      ?c wdt:P36 ?v. ?v rdfs:label ?l. FILTER(LANG(?l) = "sv")
    }`);
  const residence = new Map(residences.map((r) => [r.c.split("/").pop(), r.l]));
  const out = counties.map((f) => {
    const qid = f.properties.wikidataid;
    const title = titles.get(qid) ?? f.properties.name_sv ?? f.properties.name;
    return {
      type: "Feature",
      properties: {
        name: title,
        title,
        residence: residence.get(qid) ?? null,
        pop: populations.get(qid)?.pop ?? null,
        popYear: populations.get(qid)?.year ?? null,
      },
      geometry: { type: f.geometry.type, coordinates: roundDeep(f.geometry.coordinates, 3) },
    };
  });
  await writeFile("public/data/sweden-counties.geojson", JSON.stringify({ type: "FeatureCollection", features: out }));
  console.log("län", out.length);
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
if (only === "world") await buildWorld();
if (only === "counties") await buildCounties();
if (only === "provinces") await buildProvinces();
