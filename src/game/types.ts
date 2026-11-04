import type { Feature } from "geojson";
import type { Info } from "../info";
import type { City } from "../cities";
import type { CountryFacts } from "../countries";
import type { HeritageSite, Mountain, Volcano } from "../nature";

export type Target =
  | { kind: "country"; name: string; qid: string; feature: Feature; info: Info }
  | { kind: "city"; name: string; qid: string; city: City; info: Info };

export interface Clue {
  text?: string;
  image?: string;
  points: number;
}

export interface GameData {
  countries: Feature[];
  countryFacts: Record<string, CountryFacts>;
  cities: City[];
  heritage: HeritageSite[];
  volcanoes: Volcano[];
  mountains: Mountain[];
  counties: Feature[];
}
