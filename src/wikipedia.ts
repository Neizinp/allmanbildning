export interface WikiSummary {
  extract: string;
  url: string;
  thumbnail?: string;
}

const CACHE_PREFIX = "wiki:sv:";

export async function fetchSummary(title: string): Promise<WikiSummary | null> {
  const cached = localStorage.getItem(CACHE_PREFIX + title);
  if (cached) return JSON.parse(cached);

  try {
    const res = await fetch(
      `https://sv.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
    );
    if (!res.ok) return null;
    const j = await res.json();
    const summary: WikiSummary = {
      extract: j.extract,
      url: j.content_urls.desktop.page,
      thumbnail: j.thumbnail?.source,
    };
    localStorage.setItem(CACHE_PREFIX + title, JSON.stringify(summary));
    return summary;
  } catch {
    return null;
  }
}
