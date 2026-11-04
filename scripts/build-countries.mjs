// Hämtar enhetliga landsfakta (huvudstad, språk, valuta m.m.) från Wikidata till public/data/country-facts.json.
import { readFile, writeFile } from "node:fs/promises";
import { sparql } from "./wikidata.mjs";

const countries = JSON.parse(await readFile("public/data/countries.geojson", "utf8")).features.map((f) => f.properties.WIKIDATAID);
const values = countries.map((q) => `wd:${q}`).join(" ");

// Bara pågående, ej avvisade påståenden; "preferred" vinner om det finns, annars mest kända värdet först.
const labels = async (prop) => {
  const rows = await sparql(`
    SELECT ?c ?l ?links ?rk WHERE {
      VALUES ?c { ${values} }
      ?c p:${prop} ?st. ?st ps:${prop} ?v.
      FILTER NOT EXISTS { ?st pq:P582 [] }
      ?st wikibase:rank ?rk. FILTER(?rk != wikibase:DeprecatedRank)
      OPTIONAL { ?v rdfs:label ?sv. FILTER(LANG(?sv) = "sv") }
      OPTIONAL { ?v rdfs:label ?en. FILTER(LANG(?en) = "en") }
      BIND(COALESCE(?sv, ?en) AS ?l)
      OPTIONAL { ?v wikibase:sitelinks ?links }
    }`);
  const byCountry = {};
  for (const r of rows) if (r.l) (byCountry[r.c.split("/").pop()] ??= []).push(r);
  const out = {};
  for (const [q, list] of Object.entries(byCountry)) {
    const preferred = list.filter((r) => r.rk.endsWith("PreferredRank"));
    out[q] = (preferred.length ? preferred : list)
      .sort((x, y) => Number(y.links ?? 0) - Number(x.links ?? 0))
      .map((r) => r.l);
  }
  return out;
};

const literals = async (prop, expr = "?v") => {
  const rows = await sparql(`
    SELECT ?c (SAMPLE(${expr}) AS ?x) WHERE {
      VALUES ?c { ${values} }
      ?c wdt:${prop} ?v.
    } GROUP BY ?c`);
  return Object.fromEntries(rows.map((r) => [r.c.split("/").pop(), r.x]));
};

const [capital, languages, currency, government, tld, phone] = await Promise.all([
  labels("P36"),
  labels("P37"),
  labels("P38"),
  labels("P122"),
  labels("P78"),
  literals("P474"),
]);

// Några statsskick saknar svensk etikett i Wikidata.
const GOVERNMENT = {
  presidentialism: "Presidentiell republik",
  semipresidentialism: "Semipresidentiell republik",
  federation: "Federation",
  "super-presidential republic": "Superpresidentiell republik",
  "overseas collectivity of France": "Franskt utomeuropeiskt territorium",
};
// Teckenspråk, kreoler och specialvarianter är sällan det man söker i en ledtråd.
const MINOR_LANGUAGE = /teckenspråk|sign language|legal french|taglish|creole|^standard /i;
const mainLanguages = (list) => {
  const main = list.filter((l) => !MINOR_LANGUAGE.test(l));
  return main.length ? main : list;
};

const first = (o, q, n = 1) => (o[q] ? [...new Set(o[q])].slice(0, n) : []);
const facts = {};
for (const q of countries) {
  facts[q] = {
    capital: first(capital, q, 2),
    languages: mainLanguages(languages[q] ?? []).slice(0, 3),
    currency: first(currency, q),
    government: (() => {
      const g = first(government, q)[0];
      return g ? (GOVERNMENT[g] ?? g) : null;
    })(),
    tld: first(tld, q)[0] ?? null,
    phone: phone[q] ?? null,
  };
}
await writeFile("public/data/country-facts.json", JSON.stringify(facts));
console.log(Object.keys(facts).length, "länder");
for (const q of ["Q34", "Q142", "Q414", "Q258", "Q668", "Q148"]) console.log(facts[q]);
