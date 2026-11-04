import type { Info } from "./info";

export const formatNumber = (n: number) => n.toLocaleString("sv-SE");

export interface CountryFacts {
  capital: string[];
  languages: string[];
  currency: string[];
  government: string | null;
  tld: string | null;
  area: number | null;
  phone: string | null;
}

export function countryInfo(p: Record<string, unknown>, extra?: CountryFacts): Info {
  const name = String(p.NAME_SV ?? p.NAME);
  const iso = String(p.ISO_A2_EH);
  const rows: [string, string | null][] = [
    ["Huvudstad", extra?.capital.join(", ") || null],
    ["Befolkning", formatNumber(Number(p.POP_EST))],
    ["Area", extra?.area ? `${formatNumber(extra.area)} km²` : null],
    ["Språk", extra?.languages.join(", ") || null],
    ["Valuta", extra?.currency.join(", ") || null],
    ["Statsskick", extra?.government ?? null],
    ["Toppdomän", extra?.tld ?? null],
    ["Landskod", extra?.phone ?? null],
  ];
  return {
    name,
    subtitle: `${p.SUBREGION}, ${p.CONTINENT}`,
    facts: rows.filter((r): r is [string, string] => r[1] !== null),
    wikiTitle: name,
    qid: String(p.WIKIDATAID),
    hideIntro: true,
    flagUrl: /^[A-Z]{2}$/.test(iso) ? `https://flagcdn.com/w320/${iso.toLowerCase()}.png` : undefined,
  };
}
