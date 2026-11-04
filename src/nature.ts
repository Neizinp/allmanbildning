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

export interface CountyProps {
  name: string;
  title: string;
  residence: string | null;
  pop: number | null;
  popYear: number | null;
}

export const countyInfo = (p: CountyProps): Info => ({
  name: p.name,
  subtitle: "Län i Sverige",
  facts: [
    ...(p.residence ? ([["Residensstad", p.residence]] as [string, string][]) : []),
    ...(p.pop ? ([["Befolkning", `${formatNumber(p.pop)}${p.popYear ? ` (${p.popYear})` : ""}`]] as [string, string][]) : []),
  ],
  wikiTitle: p.title,
  showWikiImage: true,
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

export interface Volcano {
  name: string;
  title: string;
  lat: number;
  lon: number;
  country: string | null;
  elevation: number | null;
  z: number;
}

export interface HeritageSite {
  name: string;
  title: string;
  lat: number;
  lon: number;
  country: string | null;
  z: number;
}

const loadJson = <T>(file: string): Promise<T> => fetch(`./data/${file}.json`).then((r) => r.json());
export const loadVolcanoes = () => loadJson<Volcano[]>("volcanoes");
export const loadHeritage = () => loadJson<HeritageSite[]>("heritage");

export const volcanoInfo = (v: Volcano): Info => ({
  name: v.name,
  subtitle: v.country ? `Vulkan i ${v.country}` : "Vulkan",
  facts: v.elevation ? [["Höjd", `${formatNumber(v.elevation)} m ö.h.`]] : [],
  wikiTitle: v.title,
  showWikiImage: true,
});

export const heritageInfo = (h: HeritageSite): Info => ({
  name: h.name,
  subtitle: h.country ? `Världsarv i ${h.country}` : "Världsarv",
  facts: [],
  wikiTitle: h.title,
  showWikiImage: true,
});
