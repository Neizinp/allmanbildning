import type { Info } from "./info";
import { formatNumber } from "./countries";

export interface Mountain {
  name: string;
  title: string;
  lat: number;
  lon: number;
  elevation: number;
}

export const loadMountains = async (): Promise<Mountain[]> => (await fetch("./data/mountains.json")).json();

export const mountainInfo = (m: Mountain): Info => ({
  name: m.name,
  subtitle: "Bergstopp",
  facts: [["Höjd", `${formatNumber(m.elevation)} m ö.h.`]],
  wikiTitle: m.title,
});

export const namedInfo =
  (subtitle: string) =>
  (p: { name: string; title: string }): Info => ({
    name: p.name,
    subtitle,
    facts: [],
    wikiTitle: p.title,
  });

export const mountainMinZoom = (m: Mountain) => (m.elevation >= 5000 ? 3 : m.elevation >= 3500 ? 4 : 5);
