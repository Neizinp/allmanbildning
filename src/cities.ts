import type { Info } from "./info";
import { versioned } from "./versioned";
import { formatNumber } from "./countries";

export interface City {
  name: string;
  title: string;
  qid: string;
  lat: number;
  lon: number;
  pop: number;
  popYear: number | null;
  country: string;
  capital: boolean;
  z: number;
}

export const loadCities = async (): Promise<City[]> => (await fetch(versioned("./data/cities.json"))).json();

export const cityInfo = (c: City): Info => ({
  name: c.name,
  subtitle: c.capital ? `Huvudstad i ${c.country}` : c.country,
  facts: [["Befolkning", c.popYear ? `${formatNumber(c.pop)} (${c.popYear})` : formatNumber(c.pop)]],
  wikiTitle: c.title,
  qid: c.qid,
  showWikiImage: true,
});
