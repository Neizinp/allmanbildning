import type L from "leaflet";
import type { MapApi } from "../map";
import type { Info } from "../info";
import { buildClues, cityTarget, countryTarget, MIN_CLUES } from "./clues";
import { distanceKm, normalizeLon, pointInGeometry } from "./geo";
import type { Clue, Target } from "./types";

const ROUNDS = 10;
const STORAGE_KEY = "paSparetStats";
const CITIES_KEY = "paSparetCities";
const CATEGORIES = ["Sverige", "Städer i världen", "Länder"] as const;
type Category = (typeof CATEGORIES)[number];

interface Stats {
  games: number[];
  rounds: Record<Category, number[]>;
}

interface Round {
  target: Target;
  category: Category;
  clues: Clue[];
  shown: number;
  done: boolean;
  correct: boolean;
  points: number;
  message: string;
}

const emptyStats = (): Stats => ({ games: [], rounds: { Sverige: [], "Städer i världen": [], Länder: [] } });
const loadStats = (): Stats => {
  try {
    return { ...emptyStats(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return emptyStats();
  }
};
const average = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 1 });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, className = "") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const isMobile = () => window.matchMedia("(max-width: 699px)").matches;

export function initGame(api: MapApi, showInfo: (info: Info) => void, hideInfo: () => void) {
  const card = document.getElementById("game")!;
  const modeButtons = document.querySelectorAll<HTMLButtonElement>("#mode button");

  let showCities = localStorage.getItem(CITIES_KEY) === "1";
  let active = false;
  let phase: "start" | "loading" | "round" | "end" = "start";
  let score = 0;
  let roundNo = 0;
  let round: Round | null = null;
  let used = new Set<string>();
  let results: { name: string; category: Category; points: number }[] = [];

  const data = api.data;

  async function pickTarget(): Promise<{ target: Target; clues: Clue[]; category: Category }> {
    const swedish = data.cities.filter((c) => c.country === "Sverige").sort((a, b) => b.pop - a.pop).slice(0, 100);
    const world = data.cities.filter((c) => c.country !== "Sverige" && c.z <= 3);
    const countries = data.countries.filter((f) => f.properties?.WIKIDATAID && f.properties?.NAME_SV);

    for (let attempt = 0; attempt < 40; attempt++) {
      const r = Math.random();
      let target: Target;
      let category: Category;
      if (r < 0.4) {
        target = cityTarget(pick(swedish));
        category = "Sverige";
      } else if (r < 0.8) {
        target = cityTarget(pick(world));
        category = "Städer i världen";
      } else {
        target = countryTarget(pick(countries), data);
        category = "Länder";
      }
      const key = `${target.kind}:${target.qid}`;
      if (used.has(key)) continue;
      const clues = await buildClues(target, data);
      if (clues.length >= MIN_CLUES) {
        used.add(key);
        return { target, clues, category };
      }
    }
    throw new Error("Hittade ingen plats med tillräckligt många ledtrådar");
  }

  const currentPoints = () => (round ? round.clues[round.shown - 1].points : 0);

  async function nextRound() {
    roundNo++;
    phase = "loading";
    round = null;
    api.resetAnswer();
    api.home();
    hideInfo();
    render();
    try {
      const { target, clues, category } = await pickTarget();
      round = { target, category, clues, shown: 1, done: false, correct: false, points: 0, message: "" };
      phase = "round";
    } catch {
      phase = "start";
    }
    render();
  }

  function startGame() {
    score = 0;
    roundNo = 0;
    used = new Set();
    results = [];
    void nextRound();
  }

  function finish(correct: boolean, guess: L.LatLng | null) {
    if (!round || round.done) return;
    round.done = true;
    round.correct = correct;
    round.points = correct ? currentPoints() : 0;
    score += round.points;
    results.push({ name: round.target.name, category: round.category, points: round.points });
    api.reveal(round.target, guess);
    if (!isMobile()) showInfo(round.target.info);
    render();
  }

  function onGuess(latlng: L.LatLng) {
    if (!round || round.done || phase !== "round") return;
    const lon = normalizeLon(latlng.lng);
    const lat = latlng.lat;
    const target = round.target;

    let correct: boolean;
    let message: string;
    if (target.kind === "country") {
      correct = !!target.feature.geometry && pointInGeometry(lon, lat, target.feature.geometry);
      const hit = data.countries.find((f) => f.geometry && pointInGeometry(lon, lat, f.geometry));
      message = `Fel – där ligger ${hit?.properties?.NAME_SV ?? "havet"}.`;
    } else {
      const km = distanceKm(lat, lon, target.city.lat, target.city.lon);
      correct = km <= (target.city.country === "Sverige" ? 30 : 50);
      message = `Fel – ungefär ${fmt(km >= 100 ? Math.round(km / 10) * 10 : Math.round(km))} km från rätt plats.`;
    }

    if (correct) return finish(true, latlng);
    if (round.shown < round.clues.length) {
      round.shown++;
      round.message = message;
      render();
    } else {
      round.message = message;
      finish(false, latlng);
    }
  }

  function nextClue() {
    if (!round || round.done || round.shown >= round.clues.length) return;
    round.shown++;
    round.message = "";
    render();
  }

  function saveResults() {
    const stats = loadStats();
    stats.games = [...stats.games, score].slice(-50);
    for (const r of results) stats.rounds[r.category] = [...stats.rounds[r.category], r.points].slice(-100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }

  function statsTable(stats: Stats) {
    const table = el("dl", "stats");
    for (const c of CATEGORIES) {
      const rounds = stats.rounds[c];
      table.append(el("dt", "", c), el("dd", "", rounds.length ? `${fmt(average(rounds))} p i snitt (${rounds.length} frågor)` : "–"));
    }
    return table;
  }

  function clueItem(clue: Clue, current: boolean) {
    const li = el("li", current ? "clue current" : "clue");
    li.append(el("span", "pts", `${clue.points} p`));
    if (clue.text) li.append(el("span", "", clue.text));
    if (clue.image) {
      const img = el("img");
      img.src = clue.image;
      img.alt = "Bildledtråd";
      li.append(img);
    }
    return li;
  }

  function citiesToggle() {
    const label = el("label", "toggle");
    const input = el("input");
    input.type = "checkbox";
    input.checked = showCities;
    input.addEventListener("change", () => {
      showCities = input.checked;
      localStorage.setItem(CITIES_KEY, showCities ? "1" : "0");
      api.showCities(showCities);
    });
    label.append(input, " Visa städer på kartan (klicka på en stad för att gissa)");
    return label;
  }

  function renderStart() {
    const stats = loadStats();
    card.append(el("h2", "", "På Spåret"));
    card.append(
      el(
        "p",
        "",
        `Gissa vilken stad eller vilket land det är. Ledtrådarna kommer en i taget, från svåra (10 poäng) till enkla (1 poäng). Klicka på kartan där du tror att platsen ligger. ${ROUNDS} frågor per omgång.`,
      ),
    );
    if (stats.games.length) {
      card.append(el("h3", "", "Din statistik"));
      card.append(el("p", "muted", `Bästa omgång: ${Math.max(...stats.games)} p · snitt ${fmt(average(stats.games))} p (${stats.games.length} omgångar)`));
      card.append(statsTable(stats));
    }
    card.append(citiesToggle());
    card.append(button("Starta", startGame, "primary"));
  }

  function renderRound() {
    if (!round) return;
    const head = el("div", "game-head");
    head.append(el("span", "", `Fråga ${roundNo}/${ROUNDS}`), el("span", "", `Poäng: ${score}`));
    card.append(head);
    card.append(citiesToggle());

    const list = el("ol", "clues");
    round.clues.slice(0, round.shown).forEach((c, i) => list.append(clueItem(c, !round!.done && i === round!.shown - 1)));
    card.append(list);

    if (!round.done) {
      card.append(el("p", "hint", `Klicka på kartan. Rätt svar nu ger ${currentPoints()} poäng.`));
      if (round.message) card.append(el("p", "feedback wrong", round.message));
      const actions = el("div", "actions");
      if (round.shown < round.clues.length) {
        const next = round.clues[round.shown].points;
        actions.append(button(`Nästa ledtråd (${next} p)`, nextClue));
      }
      actions.append(button("Ge upp", () => finish(false, null), "secondary"));
      card.append(actions);
      return;
    }

    const result = el("div", round.correct ? "result right" : "result wrong");
    result.append(el("strong", "", round.correct ? `Rätt! ${round.points} poäng` : "Tyvärr, 0 poäng"));
    result.append(el("div", "", `Svaret var ${round.target.name}.`));
    card.append(result);

    const actions = el("div", "actions");
    if (isMobile()) actions.append(button("Visa faktaruta", () => showInfo(round!.target.info), "secondary"));
    actions.append(button(roundNo >= ROUNDS ? "Se resultat" : "Nästa fråga", () => (roundNo >= ROUNDS ? endGame() : void nextRound()), "primary"));
    card.append(actions);
  }

  function endGame() {
    saveResults();
    phase = "end";
    api.resetAnswer();
    api.home();
    hideInfo();
    render();
  }

  function renderEnd() {
    card.append(el("h2", "", `Slutpoäng: ${score} av ${ROUNDS * 10}`));
    const list = el("ul", "results");
    for (const r of results) list.append(el("li", r.points ? "right" : "wrong", `${r.points ? "✓" : "✗"} ${r.name} – ${r.points} p`));
    card.append(list);
    card.append(el("h3", "", "Din statistik"));
    card.append(statsTable(loadStats()));
    card.append(button("Spela igen", startGame, "primary"));
  }

  function render() {
    card.replaceChildren();
    if (phase === "start") renderStart();
    else if (phase === "loading") card.append(el("p", "muted", "Väljer plats …"));
    else if (phase === "round") renderRound();
    else renderEnd();
    card.scrollTop = card.scrollHeight;
  }

  function setMode(game: boolean) {
    if (game === active) return;
    active = game;
    modeButtons.forEach((b) => b.classList.toggle("active", (b.dataset.mode === "game") === game));
    card.hidden = !game;
    if (game) {
      phase = "start";
      api.enterGame(onGuess);
      api.showCities(showCities);
      render();
    } else {
      api.exitGame();
      hideInfo();
    }
  }

  modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode === "game")));
}
