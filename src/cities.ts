import type { Info } from "./info";
import { formatNumber } from "./countries";

export interface City {
  name: string;
  title: string;
  qid: string;
  lat: number;
  lon: number;
  pop: number;
  country: string;
  capital: boolean;
  z: number;
}

export const loadCities = async (): Promise<City[]> => (await fetch("./data/cities.json")).json();

export const cityInfo = (c: City): Info => ({
  name: c.name,
  subtitle: c.capital ? `Huvudstad i ${c.country}` : c.country,
  facts: [["Befolkning", formatNumber(c.pop)]],
  wikiTitle: c.title,
  qid: c.qid,
  showWikiImage: true,
});
