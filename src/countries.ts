import type { Info } from "./info";

export const formatNumber = (n: number) => n.toLocaleString("sv-SE");

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase("sv-SE") + s.slice(1);
const list = (items: string[]) => items.map(capitalize).join(", ") || null;

const SUBREGIONS: Record<string, string> = {
  "Eastern Africa": "Östafrika",
  "Western Asia": "Västasien",
  "South-Eastern Asia": "Sydostasien",
  "South America": "Sydamerika",
  "Southern Europe": "Sydeuropa",
  Melanesia: "Melanesien",
  "Central Asia": "Centralasien",
  Micronesia: "Mikronesien",
  Caribbean: "Karibien",
  Polynesia: "Polynesien",
  "Northern America": "Nordamerika",
  "Seven seas (open ocean)": "Världshaven",
  "Western Africa": "Västafrika",
  "Northern Europe": "Nordeuropa",
  "Eastern Europe": "Östeuropa",
  "Northern Africa": "Nordafrika",
  "Eastern Asia": "Östasien",
  "Western Europe": "Västeuropa",
  "Southern Africa": "Södra Afrika",
  "Southern Asia": "Sydasien",
  "Middle Africa": "Centralafrika",
  "Central America": "Centralamerika",
  "Australia and New Zealand": "Australien och Nya Zeeland",
  Antarctica: "Antarktis",
};
const CONTINENTS: Record<string, string> = {
  Africa: "Afrika",
  Asia: "Asien",
  "South America": "Sydamerika",
  Europe: "Europa",
  Oceania: "Oceanien",
  "North America": "Nordamerika",
  "Seven seas (open ocean)": "Världshaven",
  Antarctica: "Antarktis",
};

export const subregionSv = (s: unknown) => SUBREGIONS[String(s)] ?? String(s);
export const continentSv = (s: unknown) => CONTINENTS[String(s)] ?? String(s);

export const flagUrl = (iso: unknown) =>
  /^[A-Z]{2}$/.test(String(iso)) ? `https://flagcdn.com/w320/${String(iso).toLowerCase()}.png` : undefined;

export interface CountryFacts {
  capital: string[];
  languages: string[];
  currency: string[];
  government: string | null;
  tld: string | null;
  phone: string | null;
}

export function countryInfo(p: Record<string, unknown>, extra?: CountryFacts): Info {
  const name = String(p.NAME_SV ?? p.NAME);
  const rows: [string, string | null][] = [
    ["Huvudstad", list(extra?.capital ?? [])],
    ["Befolkning", `${formatNumber(Number(p.POP_EST))} (${p.POP_YEAR})`],
    ["Språk", list(extra?.languages ?? [])],
    ["Valuta", list(extra?.currency ?? [])],
    ["Statsskick", extra?.government ? capitalize(extra.government) : null],
    ["Toppdomän", extra?.tld ?? null],
    ["Landskod", extra?.phone ?? null],
  ];
  return {
    name,
    subtitle: [...new Set([subregionSv(p.SUBREGION), continentSv(p.CONTINENT)])].join(", "),
    facts: rows.filter((r): r is [string, string] => r[1] !== null),
    wikiTitle: name,
    qid: String(p.WIKIDATAID),
    hideIntro: true,
    flagUrl: flagUrl(p.ISO_A2_EH),
  };
}
