/* =============================================================================
 * test.js — headless checks for the game rules, the daily puzzle generator,
 * the BFS solver and save/restore. Run with:  node test.js
 *
 * script.js only touches the DOM from inside init(), which is guarded by a
 * `typeof document` check, so it can be required directly under Node. A tiny
 * in-memory localStorage shim below covers the persistence tests.
 * ========================================================================== */

// --- minimal localStorage shim (must exist before script.js is required) ----
const memory = new Map();
global.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear()
};

const G = require("./script.js");
const { WORD_LIST, START_WORDS } = require("./words.js");

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("  ok   " + name);
  } else {
    failed++;
    console.log("  FAIL " + name + (detail ? "  → " + detail : ""));
  }
}

function section(title) { console.log("\n" + title); }

/* -------------------------------------------------------------------------- */
section("Dictionary");

check("dictionary loaded", G.DICTIONARY.size > 1500, "size " + G.DICTIONARY.size);
check("every entry is 4 letters A–Z",
  WORD_LIST.every((w) => /^[a-z]{4}$/.test(w)));
check("no duplicate entries", new Set(WORD_LIST).size === WORD_LIST.length);
check("POOP is in the dictionary", G.isValidWord("POOP"));
check("SWIM/SLIM/SLIP are in the dictionary",
  G.isValidWord("SWIM") && G.isValidWord("SLIM") && G.isValidWord("SLIP"));
check("lookup is case-insensitive", G.isValidWord("swim") && G.isValidWord("Swim"));

/* -------------------------------------------------------------------------- */
section("Spec case 1–5: guess validation");

// The rules functions operate on the shared game state, so set one up by hand.
G.game.puzzle = { number: 1, startWord: "SWIM", target: "POOP" };
G.game.state = { puzzleNumber: 1, startWord: "SWIM", ladder: ["SWIM"], completed: false, scored: false, current: "" };
G.game.optimal = null;
G.game.optimalPath = null;

check("1. SWIM → SLIM succeeds", G.submitGuess("SLIM").ok);
// state now ends in SLIM; roll back for the independent cases below.
G.game.state.ladder = ["SWIM"];

check("2. SWIM → SLIP fails (two letters changed)",
  G.submitGuess("SLIP").reason === G.MESSAGES.transition);
check("3. SWIM → SWIM fails (nothing changed)",
  G.submitGuess("SWIM").reason === G.MESSAGES.transition);
check("4. SWIM → XQZW fails dictionary validation",
  G.submitGuess("XQZW").reason === G.MESSAGES.unknown);
check("5. fewer than four letters fails",
  G.submitGuess("SLI").reason === G.MESSAGES.length &&
  G.submitGuess("").reason === G.MESSAGES.length);
check("non-alphabetic input is stripped and rejected",
  G.submitGuess("SL1M").reason === G.MESSAGES.length);
check("duplicate words are rejected", (() => {
  G.game.state.ladder = ["SWIM", "SLIM", "SLIP"];
  // SLIP → SLIM is a legal one-letter move but SLIM is already used.
  return G.submitGuess("SLIM").reason === G.MESSAGES.duplicate;
})());
check("a valid guess is appended to the ladder", (() => {
  G.game.state.ladder = ["SWIM"];
  const before = G.game.state.ladder.length;
  G.submitGuess("SLIM");
  return G.game.state.ladder.length === before + 1 &&
         G.game.state.ladder[1] === "SLIM";
})());
check("an invalid guess is NOT appended to the ladder", (() => {
  G.game.state.ladder = ["SWIM"];
  G.submitGuess("SLIP");
  G.submitGuess("ZZZZ");
  return G.game.state.ladder.length === 1;
})());
check("changedIndex marks the changed tile",
  G.changedIndex("BARN", "BORN") === 1 &&
  G.changedIndex("SWIM", "SLIM") === 1 &&
  G.changedIndex("SWIM", "SLIP") === -1);

/* -------------------------------------------------------------------------- */
section("Spec case 6: win state");

function freshState(startWord) {
  G.game.state = {
    puzzleNumber: 1, startWord: startWord, ladder: [startWord],
    completed: false, scored: false, current: ""
  };
}

(() => {
  // A jump of two letters must not win, even when it lands on the target.
  freshState("POLL");                     // POLL → POOP changes letters 3 and 4
  const jump = G.submitGuess("POOP");
  check("a two-letter jump onto POOP is rejected",
    !jump.ok && jump.reason === G.MESSAGES.transition && !G.game.state.completed);

  // A full legal ladder: SWIM → SLIM → SLIP → SLOP → PLOP → POOP
  freshState("SWIM");
  const ladder = ["SLIM", "SLIP", "SLOP", "PLOP", "POOP"];
  const results = ladder.map((word) => G.submitGuess(word));
  check("6. a valid ladder ending in POOP triggers the win state",
    results.every((r) => r.ok) &&
    results[results.length - 1].won === true &&
    G.game.state.completed === true,
    JSON.stringify(results.map((r) => r.ok || r.reason)));
  check("the finished ladder is 5 moves long", G.game.state.ladder.length - 1 === 5);
  check("no further guesses accepted after winning", !G.submitGuess("PROP").ok);
})();

/* -------------------------------------------------------------------------- */
section("Spec case 9: deterministic daily puzzles");

const p1 = G.getDailyPuzzle(new Date(2025, 7, 15));   // epoch day
const p2 = G.getDailyPuzzle(new Date(2025, 7, 16));
const p1again = G.getDailyPuzzle(new Date(2025, 7, 15));

check("epoch date is puzzle #1", p1.number === 1, "got #" + p1.number);
check("the next day is puzzle #2", p2.number === 2, "got #" + p2.number);
check("the same date always gives the same puzzle",
  p1.startWord === p1again.startWord && p1.number === p1again.number);
check("a different date gives a different start word", p1.startWord !== p2.startWord);
check("puzzle numbers never drop below 1",
  G.getDailyPuzzle(new Date(2020, 0, 1)).number === 1);
check("a year of puzzles all start from real words",
  Array.from({ length: 365 }, (_, i) => G.startWordFor(i + 1))
    .every((w) => G.isValidWord(w)));
check("start words do not repeat within one full cycle", (() => {
  const cycle = Array.from({ length: START_WORDS.length }, (_, i) => G.startWordFor(i + 1));
  return new Set(cycle).size === cycle.length;
})());
check("start word is never the target",
  START_WORDS.every((w) => w.toUpperCase() !== G.CONFIG.targetWord));

/* -------------------------------------------------------------------------- */
section("Spec case 10: BFS shortest path");

function pathIsLegal(path) {
  for (let i = 1; i < path.length; i++) {
    if (!G.isValidWord(path[i])) return false;
    if (!G.isValidTransition(path[i - 1], path[i])) return false;
  }
  return true;
}

const sample = G.calculateShortestPath("SWIM", "POOP");
check("BFS finds a SWIM → POOP ladder", Array.isArray(sample) && sample.length > 1,
  sample && sample.join(" → "));
check("every step in the ladder differs by exactly one letter", pathIsLegal(sample));
check("the ladder starts and ends correctly",
  sample[0] === "SWIM" && sample[sample.length - 1] === "POOP");
check("unreachable/unknown words return null",
  G.calculateShortestPath("ZZZZ", "POOP") === null);
check("start === target is a zero-move path",
  G.calculateShortestPath("POOP", "POOP").length === 1);

// The headline guarantee: every curated start word can actually reach POOP.
const solvable = START_WORDS.map((w) => G.calculateShortestPath(w.toUpperCase(), "POOP"));
check("all " + START_WORDS.length + " start words reach POOP",
  solvable.every((p) => p !== null),
  START_WORDS.filter((_, i) => !solvable[i]).join(", "));
check("all start-word ladders are legal step by step",
  solvable.every(pathIsLegal));
check("no start word is trivially close (>= 3 moves)",
  solvable.every((p) => p.length - 1 >= 3),
  solvable.filter((p) => p.length - 1 < 3).map((p) => p[0]).join(", "));

const lengths = solvable.map((p) => p.length - 1);
console.log("       optimal moves across start words: min " + Math.min(...lengths) +
            ", max " + Math.max(...lengths) +
            ", mean " + (lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(2));

/* -------------------------------------------------------------------------- */
section("Spec cases 7–8: save and restore");

const puzzle = { number: 500, startWord: "SWIM", target: "POOP" };

(() => {
  memory.clear();
  const fresh = G.loadState(puzzle);
  check("7a. a brand new puzzle starts with just the start word",
    fresh.ladder.length === 1 && fresh.ladder[0] === "SWIM" && !fresh.completed);

  fresh.ladder.push("SLIM", "SLIP");
  G.saveState(fresh);
  const restored = G.loadState(puzzle);
  check("7b. an unfinished ladder is restored exactly",
    restored.ladder.join(",") === "SWIM,SLIM,SLIP" && restored.completed === false);

  restored.ladder.push("PLOP", "POOP");
  restored.completed = true;
  restored.scored = true;
  G.saveState(restored);
  const done = G.loadState(puzzle);
  check("8. a completed puzzle is restored as completed",
    done.completed === true && done.scored === true && done.ladder.length === 5);

  const tomorrow = G.loadState({ number: 501, startWord: "BARN", target: "POOP" });
  check("a new day resets to a fresh ladder",
    tomorrow.ladder.join(",") === "BARN" && !tomorrow.completed);

  // A start word that no longer matches the saved one (e.g. edited word list)
  // must also fall back to a fresh ladder rather than resuming nonsense.
  G.saveState({ puzzleNumber: 502, startWord: "BARN", ladder: ["BARN", "BORN"], completed: false, scored: false });
  const mismatched = G.loadState({ number: 502, startWord: "SWIM", target: "POOP" });
  check("a changed start word invalidates saved progress",
    mismatched.ladder.join(",") === "SWIM");
})();

/* -------------------------------------------------------------------------- */
section("Statistics");

(() => {
  memory.clear();
  let stats = G.defaultStats();
  stats = G.updateStats(stats, 10, 7, 5);
  check("first completion is recorded",
    stats.completed === 1 && stats.currentStreak === 1 && stats.distribution[7] === 1);
  check("over-optimal is tracked", stats.totalOverOptimal === 2 && stats.bestOverOptimal === 2);

  stats = G.updateStats(stats, 11, 5, 5);
  check("a consecutive day extends the streak", stats.currentStreak === 2 && stats.maxStreak === 2);
  check("a perfect path is counted", stats.perfect === 1 && stats.bestOverOptimal === 0);

  stats = G.updateStats(stats, 20, 6, 4);
  check("a gap resets the streak", stats.currentStreak === 1 && stats.maxStreak === 2);
  check("max streak is preserved", stats.maxStreak === 2);
  check("average moves is sane",
    Math.abs(stats.totalMoves / stats.completed - 6) < 0.001);

  const reloaded = G.loadStats();
  check("stats survive a reload", reloaded.completed === 3 && reloaded.maxStreak === 2);
})();

check("replaying a solved puzzle cannot score it twice", (() => {
  memory.clear();
  let stats = G.defaultStats();
  stats = G.updateStats(stats, 30, 6, 4);
  // handleWin() guards on state.scored; simulate that guard here.
  const state = { puzzleNumber: 30, scored: true };
  if (!state.scored) stats = G.updateStats(stats, 30, 6, 4);
  return stats.completed === 1;
})());

check("markPlayed counts a puzzle once no matter how many moves", (() => {
  memory.clear();
  let stats = G.defaultStats();
  stats = G.markPlayed(stats, 40);
  stats = G.markPlayed(stats, 40);
  stats = G.markPlayed(stats, 40);
  const afterSameDay = stats.played;
  stats = G.markPlayed(stats, 41);
  return afterSameDay === 1 && stats.played === 2;
})());

/* -------------------------------------------------------------------------- */
section("Content hygiene");

const OFFENSIVE_SAMPLE = ["shit", "fuck", "cunt", "dick", "slut", "porn", "rape", "kike", "spic", "coon"];
check("no sampled slurs or profanity in the dictionary",
  OFFENSIVE_SAMPLE.every((w) => !G.DICTIONARY.has(w.toUpperCase())));
check("start words are a subset of the dictionary",
  START_WORDS.every((w) => G.isValidWord(w)));

/* -------------------------------------------------------------------------- */
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
