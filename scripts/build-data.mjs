// Bygger public/data/*.json från Natural Earth och slår upp svenska Wikipedia-titlar via Wikidata.
import { readFile, writeFile } from "node:fs/promises";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const load = async (name) => (await fetch(`${NE}/${name}.geojson`)).json();

const CACHE = "scripts/.wikidata-cache.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function svTitles(ids) {
  const cache = JSON.parse(await readFile(CACHE, "utf8").catch(() => "{}"));
  const todo = [...new Set(ids.filter((id) => id && !(id in cache)))];
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    const url =
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks" +
      `&sitefilter=svwiki&ids=${chunk.join("|")}`;
    let j;
    for (let attempt = 0; !j; attempt++) {
      const res = await fetch(url, { headers: { "User-Agent": "allmanbildning-build/0.1 (github.com/Neizinp/allmanbildning)" } });
      try {
        j = await res.json();
      } catch {
        if (attempt >= 5) throw new Error("Wikidata svarar inte");
        await sleep(5000 * (attempt + 1));
      }
    }
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

const only = process.argv[2];
if (!only || only === "cities") await buildCities();
if (!only || only === "lakes") await buildLakes();
if (!only || only === "mountains") await buildMountains();
