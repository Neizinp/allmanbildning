export interface Info {
  name: string;
  subtitle: string;
  facts: [label: string, value: string][];
  wikiTitle: string;
  qid?: string;
  flagUrl?: string;
  photoUrl?: string;
  photoCredit?: string;
  crestUrl?: string;
  showWikiImage?: boolean;
  hideIntro?: boolean;
}
