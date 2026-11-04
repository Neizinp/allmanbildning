export interface Info {
  name: string;
  subtitle: string;
  facts: [label: string, value: string][];
  wikiTitle: string;
  qid?: string;
  flagUrl?: string;
  showWikiImage?: boolean;
}
