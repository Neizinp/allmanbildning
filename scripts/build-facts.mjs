// Hämtar kända personer och händelser per land och stad från Wikidata till public/data/facts.json.
// Resumable: svar cachas i scripts/.facts-cache.json, så ett avbrutet körning kan startas om.
import { readFile, writeFile } from "node:fs/promises";
import { sleep, sparql } from "./wikidata.mjs";

const CACHE = "scripts/.facts-cache.json";
const CONCURRENCY = 3;
const SV = "<https://sv.wikipedia.org/>";

// Slag, krig, fördrag, revolutioner, belägringar, statskupper, jordbävningar, naturkatastrofer, terrordåd.
const EVENT_CLASSES = "wd:Q178561 wd:Q198 wd:Q131569 wd:Q10931 wd:Q188055 wd:Q45382 wd:Q7944 wd:Q8065 wd:Q2223653";

const peopleQuery = (prop, qid, limit, minLinks) => `
  SELECT ?p (SAMPLE(?ttl) AS ?t) (MAX(?links) AS ?l) (SAMPLE(?by) AS ?b) (SAMPLE(?dy) AS ?d) (SAMPLE(?desc) AS ?ds) WHERE {
    ?p wdt:${prop} wd:${qid}; wdt:P31 wd:Q5; wikibase:sitelinks ?links. FILTER(?links >= ${minLinks})
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
const cities = JSON.parse(await readFile("public/data/cities.json", "utf8")).filter((c) => c.z <= 3).map((c) => c.qid);
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
      await writeFile(CACHE, JSON.stringify(cache));
      console.log(`${done}/${tasks.length - Object.keys(cache).length + done} klara`);
    }
    await sleep(500);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await writeFile(CACHE, JSON.stringify(cache));

const facts = {};
for (const qid of ids) {
  const people = cache[`people:${qid}`] ?? [];
  const events = cache[`events:${qid}`] ?? [];
  if (people.length || events.length) facts[qid] = { people, events };
}
await writeFile("public/data/facts.json", JSON.stringify(facts));
console.log("facts", Object.keys(facts).length, "objekt,", failed, "misslyckade");
