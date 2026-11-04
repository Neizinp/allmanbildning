import { versioned } from "./versioned";
export interface Person {
  name: string;
  title: string;
  born: number | null;
  died: number | null;
  desc: string | null;
}

export interface HistoryEvent {
  name: string;
  title: string;
  year: number | null;
}

export interface Facts {
  people: Person[];
  events: HistoryEvent[];
}

let all: Promise<Record<string, Facts>> | null = null;

export async function loadFacts(qid: string): Promise<Facts | null> {
  all ??= fetch(versioned("./data/facts.json"))
    .then((r) => r.json())
    .catch(() => ({}));
  return (await all)[qid] ?? null;
}

export const wikiUrl = (title: string) => `https://sv.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;

export const lifespan = (p: Person) => (p.born ? `${p.born}–${p.died ?? ""}` : "");
