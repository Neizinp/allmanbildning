import { wikiUrl } from "./facts";

interface Section {
  heading?: string;
  level: number;
  paragraphs: string[];
}

interface Article {
  title: string;
  image?: string;
  sections: Section[];
}

// Avsnitt som mest är listor över källor och länkar.
const SKIP = /^(referenser|källor|noter|fotnoter|externa länkar|se även|litteratur|vidare läsning|anmärkningar)$/i;

const cache = new Map<string, Promise<Article | null>>();

function parse(title: string, extract: string, image?: string): Article {
  const sections: Section[] = [{ level: 1, paragraphs: [] }];
  let skipping = false;
  for (const line of extract.split("\n")) {
    const heading = /^(={2,5})\s*(.+?)\s*\1$/.exec(line.trim());
    if (heading) {
      skipping = SKIP.test(heading[2]);
      if (!skipping) sections.push({ heading: heading[2], level: heading[1].length, paragraphs: [] });
    } else if (!skipping && line.trim()) {
      sections[sections.length - 1].paragraphs.push(line.trim());
    }
  }
  return { title, image, sections: sections.filter((s) => s.paragraphs.length) };
}

function fetchArticle(title: string): Promise<Article | null> {
  let cached = cache.get(title);
  if (!cached) {
    const url =
      "https://sv.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1" +
      "&prop=extracts|pageimages&explaintext=1&exsectionformat=wiki&piprop=thumbnail&pithumbsize=480" +
      `&titles=${encodeURIComponent(title)}`;
    cached = fetch(url)
      .then((r) => r.json())
      .then((j) => {
        const page = j.query?.pages?.[0];
        return page && !page.missing && page.extract ? parse(page.title, page.extract, page.thumbnail?.source) : null;
      })
      .catch(() => null);
    cache.set(title, cached);
    // Misslyckade hämtningar ska kunna provas igen.
    cached.then((a) => a || cache.delete(title));
  }
  return cached;
}

const reader = document.getElementById("reader")!;
const body = document.getElementById("reader-body")!;
const external = document.getElementById("reader-external") as HTMLAnchorElement;
let openTitle = "";

export function closeReader() {
  reader.hidden = true;
  openTitle = "";
}

export async function openReader(title: string) {
  openTitle = title;
  reader.hidden = false;
  external.href = wikiUrl(title);
  body.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "Hämtar från Wikipedia …" }));
  reader.scrollTop = 0;

  const article = await fetchArticle(title);
  if (openTitle !== title) return;
  body.replaceChildren();

  if (!article) {
    body.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Kunde inte hämta artikeln." }));
    return;
  }

  const h1 = document.createElement("h2");
  h1.textContent = article.title;
  body.append(h1);
  if (article.image) {
    const img = document.createElement("img");
    img.src = article.image;
    img.alt = article.title;
    body.append(img);
  }
  for (const s of article.sections) {
    if (s.heading) {
      const h = document.createElement(s.level <= 2 ? "h3" : "h4");
      h.textContent = s.heading;
      body.append(h);
    }
    for (const text of s.paragraphs) body.append(Object.assign(document.createElement("p"), { textContent: text }));
  }
}

// Vanliga klick öppnar läsaren; ctrl/cmd/mittenklick får fortfarande öppna en flik.
export function wikiLink(title: string, text: string) {
  const a = document.createElement("a");
  a.href = wikiUrl(title);
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  a.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    void openReader(title);
  });
  return a;
}

document.getElementById("reader-back")!.addEventListener("click", closeReader);
// Escape stänger läsaren först, innan kartan hinner stänga faktarutan.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && !reader.hidden) {
      closeReader();
      e.stopImmediatePropagation();
    }
  },
  true,
);
