export interface Country {
  name: string;
  population: number;
  continent: string;
  subregion: string;
  economy: string;
}

export function toCountry(p: Record<string, unknown>): Country {
  return {
    name: String(p.NAME_SV ?? p.NAME),
    population: Number(p.POP_EST),
    continent: String(p.CONTINENT),
    subregion: String(p.SUBREGION),
    economy: String(p.ECONOMY),
  };
}

export const formatNumber = (n: number) => n.toLocaleString("sv-SE");
