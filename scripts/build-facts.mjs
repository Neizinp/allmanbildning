// Hämtar kända personer och händelser per land och stad från Wikidata till public/data/facts.json.
// Resumable: svar cachas i scripts/.facts-cache.json, så ett avbrutet körning kan startas om.
import { readFile, writeFile } from "node:fs/promises";
import { sleep, sparql } from "./wikidata.mjs";

const CACHE = "scripts/.facts-cache.json";
const CONCURRENCY = 3;
const SV = "<https://sv.wikipedia.org/>";

// Slag, krig, fördrag, revolutioner, belägringar, statskupper, jordbävningar, naturkatastrofer, terrordåd.
const EVENT_CLASSES = "wd:Q178561 wd:Q198 wd:Q131569 wd:Q10931 wd:Q188055 wd:Q45382 wd:Q7944 wd:Q8065 wd:Q2223653";

// Före detta stater vars medborgare ska räknas till dagens land (t.ex. Hitler var aldrig "tysk" i Wikidata, utan "Nazityskland").
const PREDECESSORS = {
  Q183: ["Q7318", "Q1206012", "Q43287", "Q713750", "Q16957", "Q41304"],
  Q159: ["Q15180", "Q34266"],
  Q38: ["Q2277", "Q172579"],
  Q43: ["Q12560"],
  Q40: ["Q131964", "Q533534"],
  Q213: ["Q33946"],
  Q214: ["Q33946"],
  Q403: ["Q36704", "Q838261"],
  Q17: ["Q188712"],
  Q148: ["Q8733"],
  Q145: ["Q174193", "Q179876"],
};

const CITIZENSHIP_ALIASES = {
  Q35: ["Q756617"],
};

const peopleQuery = (prop, qid, limit, minLinks) => `
  SELECT ?p (SAMPLE(?ttl) AS ?t) (MAX(?links) AS ?l) (SAMPLE(?by) AS ?b) (SAMPLE(?dy) AS ?d) (SAMPLE(?desc) AS ?ds) WHERE {
    VALUES ?place { ${[qid, ...(prop === "P27" ? [...(PREDECESSORS[qid] ?? []), ...(CITIZENSHIP_ALIASES[qid] ?? [])] : [])].map((q) => "wd:" + q).join(" ")} }
    ?p wdt:${prop} ?place; wdt:P31 wd:Q5; wikibase:sitelinks ?links. FILTER(?links >= ${minLinks})
    ?a schema:about ?p; schema:isPartOf ${SV}; schema:name ?ttl.
    OPTIONAL { ?p wdt:P569 ?bd. BIND(YEAR(?bd) AS ?by) }
    OPTIONAL { ?p wdt:P570 ?dd. BIND(YEAR(?dd) AS ?dy) }
    OPTIONAL { ?p schema:description ?desc. FILTER(LANG(?desc) = "sv") }
  } GROUP BY ?p ORDER BY DESC(?l) LIMIT ${limit}`;

const eventsQuery = (prop, qid, limit, minLinks) => `
  SELECT ?e (SAMPLE(?ttl) AS ?t) (MAX(?links) AS ?l) (MIN(YEAR(?date)) AS ?y) WHERE {
    VALUES ?cls { ${EVENT_CLASSES} }
    ?e wdt:${prop} wd:${qid}; wdt:P31 ?cls; wdt:P585|wdt:P580 ?date; wikibase:sitelinks ?links. FILTER(?links >= ${minLinks})
    ?a schema:about ?e; schema:isPartOf ${SV}; schema:name ?ttl.
  } GROUP BY ?e ORDER BY DESC(?l) LIMIT ${limit}`;

const cleanName = (t) => t.replace(/ \(.*\)$/, "");
const parsePeople = (rows) =>
  rows.map((r) => ({
    name: cleanName(r.t),
    title: r.t,
    born: r.b ? Number(r.b) : null,
    died: r.d ? Number(r.d) : null,
    desc: r.ds ?? null,
  }));
const parseEvents = (rows) =>
  rows.map((r) => ({ name: cleanName(r.t), title: r.t, year: r.y ? Number(r.y) : null })).sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

const countries = JSON.parse(await readFile("public/data/countries.geojson", "utf8")).features.map((f) => f.properties.WIKIDATAID);
const cities = JSON.parse(await readFile("public/data/cities.json", "utf8")).filter((c) => c.z <= 3 || c.country === "Sverige").map((c) => c.qid);
const ids = [...new Set([...countries, ...cities].filter(Boolean))];

const tasks = [];
for (const qid of countries) {
  tasks.push({ key: `people:${qid}`, query: peopleQuery("P27", qid, 8, 25), parse: parsePeople });
  tasks.push({ key: `events:${qid}`, query: eventsQuery("P17", qid, 10, 8), parse: parseEvents });
}
for (const qid of cities) {
  tasks.push({ key: `people:${qid}`, query: peopleQuery("P19", qid, 6, 25), parse: parsePeople });
  tasks.push({ key: `events:${qid}`, query: eventsQuery("P276", qid, 6, 6), parse: parseEvents });
}

const cache = JSON.parse(await readFile(CACHE, "utf8").catch(() => "{}"));
const todo = tasks.filter((t) => !(t.key in cache) && t.key);
async function save() {
  await writeFile(CACHE, JSON.stringify(cache));
  const facts = {};
  for (const qid of ids) {
    const people = cache[`people:${qid}`] ?? [];
    const events = cache[`events:${qid}`] ?? [];
    if (people.length || events.length) facts[qid] = { people, events };
  }
  await writeFile("public/data/facts.json", JSON.stringify(facts));
  return Object.keys(facts).length;
}

let done = 0;
let failed = 0;

async function worker() {
  while (todo.length) {
    const t = todo.shift();
    try {
      cache[t.key] = t.parse(await sparql(t.query));
    } catch (e) {
      failed++;
      console.warn("misslyckades:", t.key, String(e.message).slice(0, 80));
    }
    if (++done % 10 === 0) {
      console.log(`${Object.keys(cache).length}/${tasks.length} svar, ${await save()} objekt i facts.json`);
    }
    await sleep(500);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("klart:", await save(), "objekt,", failed, "misslyckade");

