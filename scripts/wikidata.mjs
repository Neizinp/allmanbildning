// Delade hjälpfunktioner för anrop mot Wikipedia/Wikidata.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function wikiJson(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "allmanbildning-build/0.1 (github.com/Neizinp/allmanbildning)" } });
    try {
      return await res.json();
    } catch {
      if (attempt >= 5) throw new Error("Wikipedia/Wikidata svarar inte");
      await sleep(5000 * (attempt + 1));
    }
  }
}

export async function sparql(query) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: {
        "User-Agent": "allmanbildning-build/0.1 (github.com/Neizinp/allmanbildning)",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/sparql-results+json",
      },
      body: new URLSearchParams({ query }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text).results.bindings.map((b) =>
        Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])),
      );
    } catch {
      if (attempt >= 2) throw new Error(`SPARQL-fel ${res.status}: ${text.slice(0, 400)}`);
      await sleep(10000);
    }
  }
}
