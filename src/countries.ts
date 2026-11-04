import type { Info } from "./info";

export const formatNumber = (n: number) => n.toLocaleString("sv-SE");

export function countryInfo(p: Record<string, unknown>): Info {
  const name = String(p.NAME_SV ?? p.NAME);
  const iso = String(p.ISO_A2_EH);
  return {
    name,
    subtitle: `${p.SUBREGION}, ${p.CONTINENT}`,
    facts: [
      ["Befolkning", formatNumber(Number(p.POP_EST))],
      ["Ekonomi", String(p.ECONOMY)],
    ],
    wikiTitle: name,
    qid: String(p.WIKIDATAID),
    flagUrl: /^[A-Z]{2}$/.test(iso) ? `https://flagcdn.com/w320/${iso.toLowerCase()}.png` : undefined,
  };
}
