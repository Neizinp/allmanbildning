import type { Feature } from "geojson";
import { fetchSummary } from "../wikipedia";
import { lifespan, loadFacts, type Facts, type Person } from "../facts";
import { cityInfo, type City } from "../cities";
import { countryInfo, flagUrl, formatNumber, subregionSv } from "../countries";
import { directionWord, distanceKm, pointInGeometry } from "./geo";
import type { Clue, GameData, Target } from "./types";

// d = svårighetsgrad, 10 svårast. De svåraste ledtrådarna visas först.
interface Raw {
  d: number;
  text?: string;
  image?: string;
}

const MAX_CLUES = 10;
export const MIN_CLUES = 6;

const props = (f: Feature) => (f.properties ?? {}) as Record<string, unknown>;

export const countryTarget = (f: Feature, data: GameData): Target => {
  const p = props(f);
  const qid = String(p.WIKIDATAID);
  return { kind: "country", name: String(p.NAME_SV ?? p.NAME), qid, feature: f, info: countryInfo(p, data.countryFacts[qid]) };
};

export const cityTarget = (city: City): Target => ({ kind: "city", name: city.name, qid: city.qid, city, info: cityInfo(city) });

const roundSig = (n: number) => {
  const f = 10 ** Math.max(0, String(Math.round(n)).length - 2);
  return Math.round(n / f) * f;
};

// Tar bort nationalitetsordet ("svensk singer" -> "singer") och upprepade årtal ur beskrivningen.
const cleanDesc = (d: string | null) =>
  (d ?? "")
    .replace(/\s*\(\d{3,4}\s*[–-]\s*\d{0,4}\)/g, "")
    .replace(/^[\p{L}-]*sk\s+/u, "")
    .trim();

const personText = (p: Person) => {
  const life = lifespan(p);
  const desc = cleanDesc(p.desc);
  return `${p.name}${life ? ` (${life})` : ""}${desc ? `, ${desc}` : ""}`;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Sant om ledtråden avslöjar svaret genom att nämna namnet.
const leaks = (text: string, name: string) => {
  const t = text.toLowerCase();
  const n = name.toLowerCase();
  return n.length >= 6 ? t.includes(n.slice(0, 5)) : new RegExp(`(^|[^\\p{L}])${escapeRe(n)}`, "u").test(t);
};

const nearest = <T extends { lat: number; lon: number }>(items: T[], lat: number, lon: number, maxKm: number) => {
  let best: { item: T; km: number } | null = null;
  for (const item of items) {
    const km = distanceKm(lat, lon, item.lat, item.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { item, km };
  }
  return best;
};

const shuffle = <T>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

function factClues(facts: Facts | null, place: "city" | "country"): Raw[] {
  if (!facts) return [];
  const raw: Raw[] = [];
  facts.people.slice(0, 8).forEach((p, i) => {
    const lead = place === "city" ? "Här föddes" : "Härifrån kommer";
    raw.push({ d: Math.min(10, 3 + i), text: `${lead} ${personText(p)}` });
  });
  facts.events.slice(0, 10).forEach((e, i) => {
    if (e.year !== null) raw.push({ d: 5 + (i % 4), text: `${e.year}: ${e.name}` });
  });
  return raw;
}

async function cityRaw(city: City, data: GameData): Promise<Raw[]> {
  const raw = factClues(await loadFacts(city.qid), "city");
  raw.push({ d: 7, text: `Invånare: cirka ${formatNumber(roundSig(city.pop))}${city.popYear ? ` (${city.popYear})` : ""}` });

  const bigger = data.cities.filter((c) => c.qid !== city.qid && c.pop >= Math.max(150_000, city.pop * 2));
  const anchor = nearest(bigger, city.lat, city.lon, 1500);
  if (anchor) {
    const km = anchor.km >= 100 ? Math.round(anchor.km / 10) * 10 : Math.round(anchor.km / 5) * 5;
    const dir = directionWord(anchor.item.lat, anchor.item.lon, city.lat, city.lon);
    raw.push({ d: 6, text: `Ligger cirka ${km} km ${dir} om ${anchor.item.name}` });
  }

  const heritage = nearest(data.heritage, city.lat, city.lon, 100);
  if (heritage) raw.push({ d: 5, text: `I närheten finns världsarvet ${heritage.item.name}` });
  const volcano = nearest(data.volcanoes, city.lat, city.lon, 150);
  if (volcano) raw.push({ d: 6, text: `I närheten finns vulkanen ${volcano.item.name}` });
  const mountain = nearest(data.mountains, city.lat, city.lon, 150);
  if (mountain) {
    raw.push({ d: 6, text: `I närheten finns berget ${mountain.item.name} (${formatNumber(mountain.item.elevation)} m ö.h.)` });
  }

  const country = data.countries.find((f) => props(f).NAME_SV === city.country);
  if (country) {
    const p = props(country);
    const cf = data.countryFacts[String(p.WIKIDATAID)];
    raw.push({ d: 5, text: `Ligger i ${subregionSv(p.SUBREGION)}` });
    if (cf?.languages.length) raw.push({ d: 4, text: `Språk i landet: ${cf.languages.join(", ")}` });
    if (cf?.currency.length) raw.push({ d: 4, text: `Valutan i landet är ${cf.currency[0]}` });
    if (cf?.capital.length && !city.capital) raw.push({ d: 3, text: `Landets huvudstad är ${cf.capital[0]}` });
    raw.push({ d: 2, text: `Staden ligger i ${city.country}` });
    const flag = flagUrl(p.ISO_A2_EH);
    if (flag) raw.push({ d: 2, image: flag });
  }

  const county = data.counties.find((f) => f.geometry && pointInGeometry(city.lon, city.lat, f.geometry));
  if (county) raw.push({ d: 3, text: `Ligger i ${props(county).name}` });

  const summary = await fetchSummary(city.title);
  if (summary?.thumbnail) raw.push({ d: 1, image: summary.thumbnail });
  return raw;
}

async function countryRaw(feature: Feature, data: GameData): Promise<Raw[]> {
  const p = props(feature);
  const qid = String(p.WIKIDATAID);
  const name = String(p.NAME_SV ?? p.NAME);
  const raw = factClues(await loadFacts(qid), "country");
  const cf = data.countryFacts[qid];

  raw.push({ d: 6, text: `Invånare: cirka ${formatNumber(roundSig(Number(p.POP_EST)))} (${p.POP_YEAR})` });
  raw.push({ d: 5, text: `Ligger i ${subregionSv(p.SUBREGION)}` });
  if (cf?.government) raw.push({ d: 7, text: `Statsskick: ${cf.government}` });
  if (cf?.tld) raw.push({ d: 8, text: `Toppdomän: ${cf.tld}` });
  if (cf?.phone) raw.push({ d: 9, text: `Landskod för telefon: ${cf.phone}` });
  if (cf?.languages.length) raw.push({ d: 4, text: `Språk: ${cf.languages.join(", ")}` });
  if (cf?.currency.length) raw.push({ d: 4, text: `Valuta: ${cf.currency[0]}` });
  if (cf?.capital.length) raw.push({ d: 2, text: `Huvudstaden heter ${cf.capital[0]}` });

  const cities = data.cities
    .filter((c) => c.country === name && !c.capital)
    .sort((a, b) => b.pop - a.pop)
    .slice(0, 3)
    .map((c) => c.name);
  if (cities.length) raw.push({ d: 3, text: `Städer i landet: ${cities.join(", ")}` });

  const flag = flagUrl(p.ISO_A2_EH);
  if (flag) raw.push({ d: 1, image: flag });
  return raw;
}

function select(raw: Raw[]): Clue[] {
  const easiest = [...raw].sort((a, b) => a.d - b.d).slice(0, 2);
  const rest = shuffle(raw.filter((r) => !easiest.includes(r))).slice(0, MAX_CLUES - easiest.length);
  const chosen = shuffle([...easiest, ...rest]).sort((a, b) => b.d - a.d);
  const n = chosen.length;
  return chosen.map((c, i) => ({
    text: c.text,
    image: c.image,
    points: n === 1 ? 10 : Math.max(1, Math.round(10 - (i * 9) / (n - 1))),
  }));
}

export async function buildClues(target: Target, data: GameData): Promise<Clue[]> {
  const raw = target.kind === "city" ? await cityRaw(target.city, data) : await countryRaw(target.feature, data);
  const seen = new Set<string>();
  const safe = raw.filter((r) => {
    if (r.text) {
      if (leaks(r.text, target.name) || seen.has(r.text)) return false;
      seen.add(r.text);
    }
    return true;
  });
  return select(safe);
}
