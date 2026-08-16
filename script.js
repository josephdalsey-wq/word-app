/* =============================================================================
 * FISH LADDER — a daily word ladder
 *
 * Change one letter at a time, every step a real four-letter word, and get to
 * FISH in as few moves as possible.
 *
 * Everything below is plain ES2017 — no build step, no framework. Load order is
 * words.js (data) then this file.
 *
 * Layout of this file:
 *   1.  CONFIG            — the knobs you are most likely to want
 *   2.  Dictionary        — Set lookup + one-letter-apart graph + BFS
 *   3.  Daily puzzle      — deterministic date → puzzle number → start word
 *   4.  Persistence       — localStorage for progress, stats, tutorial flag
 *   5.  Statistics
 *   6.  Game state + rules
 *   7.  Rendering         — board, keyboard, modals, toast
 *   8.  Input
 *   9.  Modals + sharing
 *   10. Debug API + bootstrap
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * 1. CONFIG
 * -------------------------------------------------------------------------- */

const CONFIG = {
  gameName: "FISH LADDER",     // shown in the header and in share text
  targetWord: "FISH",          // the word every ladder must reach
  epoch: "2025-08-15",         // puzzle #1 was played on this calendar date

  // Advances the whole series by this many puzzles. Bump it by 1 to retire the
  // current word and push a fresh one to everybody immediately, without waiting
  // for midnight — the puzzle number moves on, so saved progress for the old
  // number is dropped and every player starts the new word together.
  puzzleOffset: 1,

  // Hand-picked words for specific puzzle numbers, overriding the rotation.
  // Use this to set a particular day's word — to hit a target difficulty, say —
  // without skipping puzzle numbers the way puzzleOffset does. Editing an entry
  // retires any progress already saved under that number: loadState() drops a
  // saved ladder whose first word no longer matches the puzzle's start word.
  //
  // Puzzle numbers turn over at each player's local midnight, so a word set for
  // "today" is listed under both the current number and the one before it, and
  // players on either side of midnight get the same puzzle.
  wordOverrides: {
    367: "GOLF",   // par 7, only 5 par routes
    368: "GOLF"
  },

  debug: false,                // true → log the optimal path, show the debug bar
  forcePuzzleNumber: null,     // e.g. 362 to pin a specific puzzle
  forceStartWord: null,        // e.g. "SWIM" to pin a specific start word
  forceDate: null              // e.g. "2026-01-01" to pretend it is another day
};

const STORAGE_KEYS = {
  progress: "fishladder.progress.v1",
  stats: "fishladder.stats.v1",
  tutorial: "fishladder.tutorial.v1"
};

const MESSAGES = {
  length: "Enter 4 letters",
  unknown: "Not a valid word",
  transition: "Change exactly one letter"
};

/* -----------------------------------------------------------------------------
 * 2. Dictionary and word graph
 * -------------------------------------------------------------------------- */

// words.js defines WORD_LIST / START_WORDS as globals in the browser; under Node
// (used by test.js) it exports them instead.
const DATA = (typeof module !== "undefined" && module.exports)
  ? require("./words.js")
  : { WORD_LIST: WORD_LIST, COMMON_WORDS: COMMON_WORDS, START_WORDS: START_WORDS };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Two word sets doing two different jobs.
 *
 * DICTIONARY is everything the player may play — the full ENABLE list. Being
 * generous here is the whole point: telling someone CIST is not a word when
 * Merriam-Webster says otherwise is the worst thing a word game can do.
 *
 * PAR_WORDS is the subset a reasonable person knows, and par is measured over
 * it. Measuring par over DICTIONARY would route the benchmark through words
 * nobody would ever find and silently make every score look worse.
 */
const DICTIONARY = new Set(DATA.WORD_LIST.map(function (w) { return w.toUpperCase(); }));
const PAR_WORDS = new Set(DATA.COMMON_WORDS.map(function (w) { return w.toUpperCase(); }));

/** Curated daily starting words (all verified to have a path to the target). */
const START_LIST = DATA.START_WORDS.map(function (w) { return w.toUpperCase(); });

function isValidWord(word) {
  return DICTIONARY.has(String(word).toUpperCase());
}

/** Number of positions at which two equal-length words differ. */
function diffCount(a, b) {
  if (a.length !== b.length) return -1;
  var n = 0;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Index of the single changed letter, or -1 if not exactly one changed. */
function changedIndex(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  var found = -1;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (found !== -1) return -1;
      found = i;
    }
  }
  return found;
}

/** A legal move is a real word exactly one letter away from the previous one. */
function isValidTransition(previous, next) {
  return diffCount(String(previous).toUpperCase(), String(next).toUpperCase()) === 1;
}

/** Words one letter away from `word` within `wordSet` (defaults to playable). */
function neighbours(word, wordSet) {
  var set = wordSet || DICTIONARY;
  var out = [];
  for (var i = 0; i < word.length; i++) {
    for (var c = 0; c < ALPHABET.length; c++) {
      var letter = ALPHABET[c];
      if (letter === word[i]) continue;
      var candidate = word.slice(0, i) + letter + word.slice(i + 1);
      if (set.has(candidate)) out.push(candidate);
    }
  }
  return out;
}

/**
 * Breadth-first search for a shortest ladder from `start` to `target`.
 * Returns the full path including both endpoints, or null when unreachable.
 * BFS on an unweighted graph is what makes the result provably optimal.
 */
function calculateShortestPath(start, target, wordSet) {
  var set = wordSet || PAR_WORDS;   // par is measured over the common words
  start = String(start).toUpperCase();
  target = String(target).toUpperCase();
  if (!set.has(start) || !set.has(target)) return null;
  if (start === target) return [start];

  var cameFrom = new Map();       // word → the word we reached it from
  cameFrom.set(start, null);
  var queue = [start];
  var head = 0;

  while (head < queue.length) {
    var word = queue[head++];
    var next = neighbours(word, set);
    for (var i = 0; i < next.length; i++) {
      var n = next[i];
      if (cameFrom.has(n)) continue;
      cameFrom.set(n, word);
      if (n === target) {
        var path = [];
        for (var w = target; w !== null; w = cameFrom.get(w)) path.push(w);
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

/** Par: fewest moves from `start` to the target using only common words. */
function optimalMoves(start, target, wordSet) {
  var path = calculateShortestPath(start, target || CONFIG.targetWord, wordSet);
  return path ? path.length - 1 : null;
}

/* -----------------------------------------------------------------------------
 * 3. Daily puzzle
 * -------------------------------------------------------------------------- */

/** Whole calendar days between the epoch and `date`, in the player's timezone. */
function daysSinceEpoch(date) {
  var parts = CONFIG.epoch.split("-").map(Number);
  var epochUTC = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  var dayUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((dayUTC - epochUTC) / 86400000);
}

function gcd(a, b) { while (b) { var t = b; b = a % b; a = t; } return a; }

/**
 * Map a puzzle number onto a start word.
 *
 * `n * stride % length` with stride coprime to the list length walks the whole
 * list before repeating, so every word is used once per full cycle and
 * consecutive days are never neighbours in the list.
 */
function startWordFor(puzzleNumber) {
  var len = START_LIST.length;
  var strides = [137, 131, 127, 113, 109, 103, 101, 97, 89, 83, 79, 73, 71, 67,
                 61, 59, 53, 47, 43, 41, 37, 31, 29, 23, 19, 17, 13, 11, 7, 3, 1];
  var stride = strides.find(function (s) { return gcd(s, len) === 1; }) || 1;
  var index = ((puzzleNumber * stride) + 61) % len;
  return START_LIST[index];
}

/**
 * The start word for a puzzle number: a hand-picked override when one is set,
 * otherwise the rotation. Everything that needs a puzzle's word goes through
 * here, so the Yesterday panel agrees with what was actually played.
 */
function startWordForPuzzle(number) {
  var override = CONFIG.wordOverrides && CONFIG.wordOverrides[number];
  return (override || startWordFor(number)).toUpperCase();
}

/** Today's (or a forced/mocked) puzzle: number, start word, target. */
function getDailyPuzzle(date) {
  var when = date || (CONFIG.forceDate ? parseLocalDate(CONFIG.forceDate) : new Date());
  var number = CONFIG.forcePuzzleNumber !== null
    ? CONFIG.forcePuzzleNumber
    : Math.max(1, daysSinceEpoch(when) + 1 + CONFIG.puzzleOffset);
  var start = CONFIG.forceStartWord
    ? CONFIG.forceStartWord.toUpperCase()
    : startWordForPuzzle(number);
  return { number: number, startWord: start, target: CONFIG.targetWord };
}

/** "2026-01-01" → a Date at local midnight (avoids the UTC-parsing surprise). */
function parseLocalDate(iso) {
  var p = String(iso).split("-").map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}

/* -----------------------------------------------------------------------------
 * 4. Persistence
 * -------------------------------------------------------------------------- */

function storage() {
  try {
    if (typeof localStorage === "undefined") return null;
    localStorage.setItem("__ladder_probe", "1");
    localStorage.removeItem("__ladder_probe");
    return localStorage;
  } catch (err) {
    return null;   // private mode / storage disabled — the game still runs
  }
}

function readJSON(key, fallback) {
  var store = storage();
  if (!store) return fallback;
  try {
    var raw = store.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJSON(key, value) {
  var store = storage();
  if (!store) return;
  try { store.setItem(key, JSON.stringify(value)); } catch (err) { /* quota */ }
}

/**
 * Load saved progress for a puzzle number. Anything belonging to a different
 * puzzle (i.e. a new calendar day) is discarded and a fresh ladder is started.
 */
function loadState(puzzle) {
  var saved = readJSON(STORAGE_KEYS.progress, null);
  if (saved && saved.puzzleNumber === puzzle.number && Array.isArray(saved.ladder) &&
      saved.ladder.length && saved.ladder[0] === puzzle.startWord) {
    return {
      puzzleNumber: puzzle.number,
      startWord: puzzle.startWord,
      ladder: saved.ladder.slice(),
      completed: !!saved.completed,
      scored: !!saved.scored,
      current: ""
    };
  }
  return {
    puzzleNumber: puzzle.number,
    startWord: puzzle.startWord,
    ladder: [puzzle.startWord],
    completed: false,
    scored: false,
    current: ""
  };
}

function saveState(state) {
  writeJSON(STORAGE_KEYS.progress, {
    puzzleNumber: state.puzzleNumber,
    startWord: state.startWord,
    ladder: state.ladder,
    completed: state.completed,
    scored: state.scored,
    savedAt: new Date().toISOString()
  });
}

/* -----------------------------------------------------------------------------
 * 5. Statistics
 * -------------------------------------------------------------------------- */

function defaultStats() {
  return {
    version: 1,
    played: 0,             // puzzles the player made at least one move on
    completed: 0,          // puzzles finished
    currentStreak: 0,
    maxStreak: 0,
    totalMoves: 0,         // for the average
    totalOverOptimal: 0,
    perfect: 0,            // completions that matched par or beat it
    bestOverOptimal: null, // best (lowest) "moves over par" ever
    distribution: {},      // move count → number of completions
    lastPlayedPuzzle: null,
    lastCompletedPuzzle: null
  };
}

function loadStats() {
  var s = readJSON(STORAGE_KEYS.stats, null);
  if (!s || s.version !== 1) return defaultStats();
  var base = defaultStats();
  Object.keys(base).forEach(function (k) { if (!(k in s)) s[k] = base[k]; });
  return s;
}

function saveStats(stats) { writeJSON(STORAGE_KEYS.stats, stats); }

/** Count a puzzle as "played" the first time the player commits a word to it. */
function markPlayed(stats, puzzleNumber) {
  if (stats.lastPlayedPuzzle === puzzleNumber) return stats;
  stats.played += 1;
  stats.lastPlayedPuzzle = puzzleNumber;
  saveStats(stats);
  return stats;
}

/**
 * Record a completed puzzle. Called once per puzzle number — practice replays
 * pass through `state.scored` and never reach here a second time.
 */
function updateStats(stats, puzzleNumber, moves, optimal) {
  stats.completed += 1;
  stats.totalMoves += moves;
  stats.distribution[moves] = (stats.distribution[moves] || 0) + 1;

  if (typeof optimal === "number") {
    var over = moves - optimal;
    stats.totalOverOptimal += over;
    if (over <= 0) stats.perfect += 1;   // matching par counts, beating it too
    if (stats.bestOverOptimal === null || over < stats.bestOverOptimal) {
      stats.bestOverOptimal = over;
    }
  }

  stats.currentStreak = (stats.lastCompletedPuzzle === puzzleNumber - 1)
    ? stats.currentStreak + 1
    : 1;
  stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
  stats.lastCompletedPuzzle = puzzleNumber;

  saveStats(stats);
  return stats;
}

/* -----------------------------------------------------------------------------
 * 6. Game state and rules
 * -------------------------------------------------------------------------- */

var game = {
  puzzle: null,
  state: null,
  stats: null,
  optimal: null,      // minimum moves for today (computed lazily, cached)
  optimalPath: null
};

function movesMade(state) { return state.ladder.length - 1; }

function ensureOptimal() {
  if (game.optimalPath === null) {
    game.optimalPath = calculateShortestPath(game.puzzle.startWord, CONFIG.targetWord);
    game.optimal = game.optimalPath ? game.optimalPath.length - 1 : null;
  }
  return game.optimal;
}

/**
 * Validate and apply a guess.
 * Returns { ok: true, word, changed } or { ok: false, reason }.
 * The reason strings double as the toast copy.
 */
function submitGuess(rawGuess) {
  var state = game.state;
  var guess = String(rawGuess || "").toUpperCase().replace(/[^A-Z]/g, "");

  if (state.completed) return { ok: false, reason: "Puzzle already solved" };
  if (guess.length !== 4) return { ok: false, reason: MESSAGES.length };
  if (!isValidWord(guess)) return { ok: false, reason: MESSAGES.unknown };

  var previous = state.ladder[state.ladder.length - 1];
  if (!isValidTransition(previous, guess)) return { ok: false, reason: MESSAGES.transition };

  // Revisiting a word you have already used is allowed: backtracking is a
  // legitimate way to escape a dead end, and it only ever costs you moves.
  // (Re-submitting the *previous* word is still rejected above — that changes
  // zero letters, not one.)

  var changed = changedIndex(previous, guess);
  state.ladder.push(guess);
  state.current = "";

  if (guess === CONFIG.targetWord) state.completed = true;

  return { ok: true, word: guess, changed: changed, won: state.completed };
}

/* -----------------------------------------------------------------------------
 * 7. Rendering
 * -------------------------------------------------------------------------- */

var el = {};          // cached DOM nodes, filled in by init()
var toastTimer = null;

function cacheDom() {
  [
    "board", "board-status", "board-hint", "toast", "keyboard", "overlay",
    "puzzle-number", "start-word", "target-word", "game-title",
    "modal-help", "modal-results", "modal-stats", "modal-yesterday",
    "results-title", "results-subtitle", "results-score", "results-ladder",
    "share-include-ladder", "btn-share", "btn-replay",
    "stats-grid", "stats-dist", "yesterday-body",
    "btn-help", "btn-stats", "btn-yesterday"
  ].forEach(function (id) {
    el[id] = document.getElementById(id);
  });
}

/** True where `word` already has the goal word's letter in that position. */
function correctMask(word) {
  var target = CONFIG.targetWord;
  var mask = [];
  for (var i = 0; i < 4; i++) mask.push(!!word[i] && word[i] === target[i]);
  return mask;
}

/** Build one row of four tiles. */
function makeRow(word, opts) {
  opts = opts || {};
  var row = document.createElement("div");
  row.className = "row";
  if (opts.className) row.className += " " + opts.className;

  // Committed rows show which letters are already in place for the goal; the
  // row being typed stays plain so "typing" reads differently from "played".
  var correct = opts.showCorrect ? correctMask(word) : [];

  for (var i = 0; i < 4; i++) {
    var tile = document.createElement("div");
    tile.className = "tile";
    var letter = word[i] || "";
    tile.textContent = letter;
    if (opts.active) {
      if (letter) tile.className += " tile--filled";
      else if (i === word.length) tile.className += " tile--cursor";
    }
    if (correct[i]) tile.className += " tile--correct";
    if (opts.changed === i) tile.className += " tile--changed";
    if (opts.popIndex === i) tile.className += " tile--pop";
    row.appendChild(tile);
  }
  return row;
}

/**
 * Accessible description of a committed row. Screen-reader users get the same
 * two facts the tiles show visually: what changed, and what is already right.
 */
function describeRow(word, index, changed) {
  var spelled = word.split("").join(" ");
  var inPlace = correctMask(word).reduce(function (n, ok) { return n + (ok ? 1 : 0); }, 0);
  var progress = inPlace
    ? ", " + inPlace + " of 4 letters in place for " + CONFIG.targetWord
    : "";

  if (index === 0) return "Starting word: " + spelled + progress;
  var suffix = changed >= 0 ? ", letter " + (changed + 1) + " changed" : "";
  return "Move " + index + ": " + spelled + suffix + progress;
}

function renderBoard(options) {
  options = options || {};
  var state = game.state;
  el.board.textContent = "";

  state.ladder.forEach(function (word, i) {
    var prev = i > 0 ? state.ladder[i - 1] : null;
    var changed = prev ? changedIndex(prev, word) : -1;
    var classes = ["row--done"];
    if (i === 0) classes.push("row--start");
    if (word === CONFIG.targetWord) classes.push("row--target");
    // Only the freshly committed row animates, so re-renders stay quiet.
    if (options.commitLast && i === state.ladder.length - 1) classes.push("row--commit");

    var row = makeRow(word, {
      className: classes.join(" "), changed: changed, showCorrect: true
    });
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", describeRow(word, i, changed));
    el.board.appendChild(row);
  });

  if (!state.completed) el.board.appendChild(buildActiveRow());

  // Keep the newest row in view without yanking the whole page around.
  el.board.scrollTop = el.board.scrollHeight;
}

function buildActiveRow() {
  var row = makeRow(game.state.current, { className: "row--active", active: true });
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Your next word: " +
    (game.state.current ? game.state.current.split("").join(" ") : "empty"));
  row.id = "active-row";
  return row;
}

/** Cheap redraw for keystrokes — swaps only the editable row. */
function renderActiveRow(popIndex) {
  var existing = document.getElementById("active-row");
  if (!existing) return;
  var row = makeRow(game.state.current, {
    className: "row--active", active: true, popIndex: popIndex
  });
  row.id = "active-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Your next word: " +
    (game.state.current ? game.state.current.split("").join(" ") : "empty"));
  existing.replaceWith(row);
  el.board.scrollTop = el.board.scrollHeight;
}

function announce(message) {
  if (el["board-status"]) el["board-status"].textContent = message;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    el.toast.classList.remove("toast--show");
  }, 1800);
}

function shakeActiveRow() {
  var row = document.getElementById("active-row");
  if (!row) return;
  row.classList.remove("row--shake");
  void row.offsetWidth;           // force reflow so the animation can restart
  row.classList.add("row--shake");
}

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"]
];

function renderKeyboard() {
  el.keyboard.textContent = "";
  KEY_ROWS.forEach(function (keys, rowIndex) {
    var row = document.createElement("div");
    row.className = "kb-row" + (rowIndex === 1 ? " kb-row--spacer" : "");
    keys.forEach(function (key) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "key" + (key.length > 1 ? " key--wide" : "");
      button.dataset.key = key;
      if (key === "BACKSPACE") {
        button.textContent = "⌫";
        button.setAttribute("aria-label", "Backspace");
      } else if (key === "ENTER") {
        button.textContent = "Enter";
        button.setAttribute("aria-label", "Submit word");
      } else {
        button.textContent = key;
        button.setAttribute("aria-label", "Letter " + key);
      }
      row.appendChild(button);
    });
    el.keyboard.appendChild(row);
  });
}

function renderHeader() {
  el["puzzle-number"].textContent = "#" + game.puzzle.number;
  el["start-word"].textContent = game.puzzle.startWord;
  el["target-word"].textContent = CONFIG.targetWord;
  el["game-title"].textContent = CONFIG.gameName;
  document.title = CONFIG.gameName;
}

function renderHint() {
  if (!el["board-hint"]) return;
  if (game.state.completed) {
    el["board-hint"].textContent = "Solved in " + movesMade(game.state) +
      " " + plural(movesMade(game.state), "move") + ". Come back tomorrow!";
  } else {
    var moves = movesMade(game.state);
    el["board-hint"].textContent = moves === 0
      ? "Change exactly one letter per move."
      : moves + " " + plural(moves, "move") + " so far.";
  }
}

function plural(n, word) { return n === 1 ? word : word + "s"; }

/* -----------------------------------------------------------------------------
 * 8. Input
 * -------------------------------------------------------------------------- */

function handleKey(key) {
  if (isModalOpen() || game.state.completed) return;

  if (key === "ENTER") return commitGuess();

  if (key === "BACKSPACE") {
    if (!game.state.current) return;
    game.state.current = game.state.current.slice(0, -1);
    renderActiveRow();
    return;
  }

  if (/^[A-Z]$/.test(key) && game.state.current.length < 4) {
    game.state.current += key;
    renderActiveRow(game.state.current.length - 1);
  }
}

function commitGuess() {
  var attempt = game.state.current;
  var result = submitGuess(attempt);

  if (!result.ok) {
    // The toast is role="alert", so screen readers get it without a second
    // announcement into the polite live region.
    showToast(result.reason);
    shakeActiveRow();
    return;
  }

  game.stats = markPlayed(game.stats, game.state.puzzleNumber);
  saveState(game.state);
  renderBoard({ commitLast: true });
  renderHint();
  announce(describeRow(result.word, movesMade(game.state), result.changed));

  if (result.won) handleWin();
}

function handleWin() {
  var state = game.state;
  var optimal = ensureOptimal();
  var moves = movesMade(state);

  // Practice replays (state.scored already true) never touch the stats.
  if (!state.scored) {
    state.scored = true;
    game.stats = updateStats(game.stats, state.puzzleNumber, moves, optimal);
  }
  saveState(state);

  announce("You reached " + CONFIG.targetWord + " in " + moves + " moves.");
  setTimeout(function () { showResults(); }, 700);
}

/* -----------------------------------------------------------------------------
 * 9. Modals, results and sharing
 * -------------------------------------------------------------------------- */

var openModalId = null;
var lastFocused = null;

function isModalOpen() { return openModalId !== null; }

function openModal(id) {
  var modal = el[id];
  if (!modal) return;
  lastFocused = document.activeElement;

  ["modal-help", "modal-results", "modal-stats", "modal-yesterday"].forEach(function (key) {
    if (el[key]) el[key].hidden = true;
  });
  modal.hidden = false;
  el.overlay.hidden = false;
  openModalId = id;

  // Land focus on the friendliest control, not the close button.
  var target = modal.querySelector(".btn--primary") ||
               modal.querySelector(".btn") ||
               modal.querySelector(".modal__close");
  if (target) target.focus();
}

/**
 * Close the open dialog.
 *
 * `returnFocus` should be true only when the close came from the keyboard
 * (Escape, or Enter/Space on a button). Returning focus to the trigger after a
 * *pointer* close leaves an invisible focus ring on a footer button, and the
 * player's next Enter re-opens that modal instead of submitting their word.
 * On a pointer close we park focus on the board instead.
 */
function closeModal(returnFocus) {
  if (!isModalOpen()) return;
  el.overlay.hidden = true;
  if (el[openModalId]) el[openModalId].hidden = true;
  openModalId = null;

  if (returnFocus && lastFocused && lastFocused.focus) {
    lastFocused.focus();
  } else if (el.board && el.board.focus) {
    el.board.focus({ preventScroll: true });
  }
}

/** Keep Tab inside the open dialog. */
function trapFocus(event) {
  if (event.key !== "Tab" || !isModalOpen()) return;
  var modal = el[openModalId];
  var focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function renderLadder(container, words) {
  container.textContent = "";
  words.forEach(function (word, i) {
    if (i > 0) {
      var arrow = document.createElement("span");
      arrow.className = "ladder__arrow";
      arrow.textContent = "→";
      container.appendChild(arrow);
    }
    var chip = document.createElement("span");
    chip.className = "ladder__word" + (word === CONFIG.targetWord ? " ladder__word--target" : "");
    chip.textContent = word;
    container.appendChild(chip);
  });
}

function scoreCell(value, label, good) {
  var cell = document.createElement("div");
  cell.className = "score__cell" + (good ? " score__cell--good" : "");
  var v = document.createElement("div");
  v.className = "score__value";
  v.textContent = value;
  var l = document.createElement("div");
  l.className = "score__label";
  l.textContent = label;
  cell.appendChild(v);
  cell.appendChild(l);
  return cell;
}

function showResults() {
  var state = game.state;
  var moves = movesMade(state);
  var optimal = ensureOptimal();
  var over = (typeof optimal === "number") ? moves - optimal : null;

  el["results-title"].textContent = "You got to " + CONFIG.targetWord + "!";
  el["results-subtitle"].textContent =
    CONFIG.gameName + " #" + state.puzzleNumber + " · started from " + state.startWord;

  var score = el["results-score"];
  score.textContent = "";
  score.appendChild(scoreCell(moves, "Your moves"));
  if (typeof optimal === "number") {
    score.appendChild(scoreCell(optimal, "Par"));
    // Par is the best route through *common* words, so a player who finds a
    // shortcut through an obscure one can legitimately come in under it.
    score.appendChild(scoreCell(
      over < 0 ? over : (over === 0 ? "Par!" : "+" + over),
      over < 0 ? "Under par" : (over === 0 ? "Matched par" : "Over par"),
      over <= 0
    ));
  }

  renderLadder(el["results-ladder"], state.ladder);
  openModal("modal-results");
}

/**
 * Emoji grid: one line per word, a brown square where the letter changed.
 * It shows the *shape* of the solution without giving the words away.
 */
function buildEmojiGrid(ladder) {
  var lines = ["⬛⬛⬛⬛"];               // the starting word
  for (var i = 1; i < ladder.length; i++) {
    var idx = changedIndex(ladder[i - 1], ladder[i]);
    // 🟦 matches the teal the board uses; the grid marks which letter you
    // changed each move, not which were correct — that would leak the ladder.
    var mark = ladder[i] === CONFIG.targetWord ? "🐟" : "🟦";
    var row = "";
    for (var j = 0; j < 4; j++) row += (j === idx ? mark : "⬛");
    lines.push(row);
  }
  return lines.join("\n");
}

function buildShareText(includeLadder) {
  var state = game.state;
  var moves = movesMade(state);
  var optimal = ensureOptimal();
  var header = CONFIG.gameName + " #" + state.puzzleNumber;
  var summary = moves + " " + plural(moves, "move") + " 🐟";
  if (typeof optimal === "number") {
    summary += moves < optimal ? " · under par (" + optimal + ")!"
             : moves === optimal ? " · par!"
             : " · par " + optimal;
  }
  var parts = [header, summary, buildEmojiGrid(state.ladder)];
  if (includeLadder) parts.push(state.ladder.join(" → "));
  return parts.join("\n");
}

function shareResult() {
  var text = buildShareText(el["share-include-ladder"].checked);

  if (typeof navigator !== "undefined" && navigator.share) {
    navigator.share({ text: text }).catch(function () { /* user dismissed */ });
    return;
  }
  copyText(text).then(function (ok) {
    showToast(ok ? "Copied to clipboard" : "Copy failed — select and copy manually");
  });
}

function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { return true; },
                                                   function () { return legacyCopy(text); });
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  try {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch (err) {
    return false;
  }
}

/** Wipe today's ladder for another go. Stats stay put (state.scored is kept). */
function replayPuzzle() {
  game.state.ladder = [game.puzzle.startWord];
  game.state.completed = false;
  game.state.current = "";
  saveState(game.state);
  closeModal(false);   // straight back to the board, ready to type
  renderBoard();
  renderHint();
  announce("Board reset. Starting word " + game.puzzle.startWord + ".");
}

/* ------------------------------------ stats modal ------------------------- */

function statTile(value, label) {
  var box = document.createElement("div");
  box.className = "stat";
  var v = document.createElement("div");
  v.className = "stat__value" + (/[A-Za-z]/.test(String(value)) ? " stat__value--word" : "");
  v.textContent = value;
  var l = document.createElement("div");
  l.className = "stat__label";
  l.textContent = label;
  box.appendChild(v);
  box.appendChild(l);
  return box;
}

function showStats() {
  var s = game.stats;
  var grid = el["stats-grid"];
  grid.textContent = "";

  var avgMoves = s.completed ? (s.totalMoves / s.completed).toFixed(1) : "—";
  var avgOver = s.completed ? (s.totalOverOptimal / s.completed).toFixed(1) : "—";
  var best = s.bestOverOptimal === null
    ? "—"
    : (s.bestOverOptimal < 0 ? String(s.bestOverOptimal)
      : (s.bestOverOptimal === 0 ? "Par" : "+" + s.bestOverOptimal));

  [
    [s.played, "Played"],
    [s.completed, "Solved"],
    [s.currentStreak, "Current streak"],
    [s.maxStreak, "Max streak"],
    [avgMoves, "Avg moves"],
    [avgOver, "Avg vs par"],
    [s.perfect, "Par or better"],
    [best, "Best result"]
  ].forEach(function (pair) { grid.appendChild(statTile(pair[0], pair[1])); });

  renderDistribution(el["stats-dist"], s);
  openModal("modal-stats");
}

function renderDistribution(container, stats) {
  container.textContent = "";
  var keys = Object.keys(stats.distribution).map(Number).sort(function (a, b) { return a - b; });

  if (!keys.length) {
    var empty = document.createElement("p");
    empty.className = "dist__empty";
    empty.textContent = "Solve a puzzle to start your distribution.";
    container.appendChild(empty);
    return;
  }

  var max = Math.max.apply(null, keys.map(function (k) { return stats.distribution[k]; }));
  var todayMoves = game.state && game.state.completed ? movesMade(game.state) : null;

  keys.forEach(function (moves) {
    var count = stats.distribution[moves];
    var row = document.createElement("div");
    row.className = "dist__row";

    var key = document.createElement("span");
    key.className = "dist__key";
    key.textContent = moves;

    var bar = document.createElement("span");
    bar.className = "dist__bar" + (moves === todayMoves ? " dist__bar--current" : "");
    bar.style.width = Math.max(8, Math.round((count / max) * 100)) + "%";
    bar.textContent = count;

    row.appendChild(key);
    row.appendChild(bar);
    row.setAttribute("aria-label", count + " " + plural(count, "puzzle") + " solved in " + moves + " moves");
    container.appendChild(row);
  });
}

/* --------------------------------- yesterday ------------------------------ */

function showYesterday() {
  var body = el["yesterday-body"];
  body.textContent = "";
  var number = game.puzzle.number - 1;

  if (number < 1) {
    var none = document.createElement("p");
    none.textContent = "There is no earlier puzzle — today is #1!";
    body.appendChild(none);
    openModal("modal-yesterday");
    return;
  }

  var start = CONFIG.forceStartWord ? game.puzzle.startWord : startWordForPuzzle(number);
  var path = calculateShortestPath(start, CONFIG.targetWord);

  [["Puzzle", "#" + number], ["Starting word", start],
   ["Par", path ? (path.length - 1) + " " + plural(path.length - 1, "move") : "—"]]
    .forEach(function (pair) {
      var row = document.createElement("div");
      row.className = "kv";
      var k = document.createElement("span");
      k.className = "kv__k";
      k.textContent = pair[0];
      var v = document.createElement("span");
      v.className = "kv__v";
      v.textContent = pair[1];
      row.appendChild(k);
      row.appendChild(v);
      body.appendChild(row);
    });

  if (path) {
    var label = document.createElement("p");
    label.className = "modal__label";
    label.textContent = "One par route";
    body.appendChild(label);
    var ladder = document.createElement("div");
    ladder.className = "ladder";
    body.appendChild(ladder);
    renderLadder(ladder, path);
    var note = document.createElement("p");
    note.className = "modal__note";
    note.textContent = "Other paths of the same length may exist.";
    body.appendChild(note);
  }

  openModal("modal-yesterday");
}

/* -----------------------------------------------------------------------------
 * 10. Debug helpers and bootstrap
 * -------------------------------------------------------------------------- */

/** Read ?debug=1&puzzle=362&date=2026-01-01&start=SWIM overrides. */
function applyUrlOverrides() {
  if (typeof location === "undefined" || !location.search) return;
  var params = new URLSearchParams(location.search);
  if (params.get("debug") === "1") CONFIG.debug = true;

  var puzzle = parseInt(params.get("puzzle"), 10);
  if (!isNaN(puzzle) && puzzle > 0) CONFIG.forcePuzzleNumber = puzzle;

  var date = params.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) CONFIG.forceDate = date;

  var start = params.get("start");
  if (start && isValidWord(start)) {
    CONFIG.forceStartWord = start.toUpperCase();
  } else if (start) {
    console.warn("[" + CONFIG.gameName + "] ignoring unknown start word:", start);
  }
}

function renderDebugBar() {
  if (!CONFIG.debug) return;
  var bar = document.createElement("div");
  bar.className = "debug-bar";
  bar.textContent = "DEBUG · par " + ensureOptimal() + " moves · ";
  var reset = document.createElement("button");
  reset.type = "button";
  reset.className = "footer__btn";
  reset.textContent = "Reset puzzle";
  reset.addEventListener("click", replayPuzzle);
  bar.appendChild(reset);
  document.querySelector(".main").appendChild(bar);
  console.log("[" + CONFIG.gameName + "] optimal path:", game.optimalPath.join(" → "));
}

/** Console API: window.LADDER (named for the game, not the target word). */
function debugApi() {
  return {
    config: CONFIG,
    game: game,
    /** Log (and return) the optimal path for the current or a given word. */
    solve: function (start) {
      var path = calculateShortestPath(start || game.puzzle.startWord, CONFIG.targetWord);
      console.log(path ? path.join(" → ") : "no path found");
      return path;
    },
    optimal: function (start) { return optimalMoves(start || game.puzzle.startWord); },
    /** The true shortest route, allowed to use every playable word. */
    shortest: function (start) {
      var path = calculateShortestPath(start || game.puzzle.startWord,
                                       CONFIG.targetWord, DICTIONARY);
      console.log(path ? path.join(" → ") : "no path found");
      return path;
    },
    /** Preview the share text without touching the clipboard. */
    shareText: function (includeLadder) { return buildShareText(!!includeLadder); },
    /** Wipe today's ladder (keeps stats). */
    reset: replayPuzzle,
    /** Wipe absolutely everything, including stats and the tutorial flag. */
    hardReset: function () {
      var store = storage();
      if (store) Object.keys(STORAGE_KEYS).forEach(function (k) { store.removeItem(STORAGE_KEYS[k]); });
      location.reload();
    },
    /** Jump to another puzzle number or date (reloads with query params). */
    setPuzzle: function (n) { location.search = "?puzzle=" + n; },
    setDate: function (iso) { location.search = "?date=" + iso; },
    stats: function () { return game.stats; },
    dictionarySize: DICTIONARY.size,
    parWordCount: PAR_WORDS.size
  };
}

function bindEvents() {
  // On-screen keyboard (delegated: one listener for all 28 keys)
  el.keyboard.addEventListener("click", function (event) {
    var button = event.target.closest("[data-key]");
    if (button) handleKey(button.dataset.key);
  });

  // Physical keyboard
  document.addEventListener("keydown", function (event) {
    // Escape is a keyboard close, so focus goes back to whatever opened it.
    if (event.key === "Escape" && isModalOpen()) { closeModal(true); return; }
    if (event.key === "Tab") { trapFocus(event); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Enter") {
      // Let Enter activate whatever button has focus instead of submitting.
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      event.preventDefault();
      handleKey("ENTER");
    } else if (event.key === "Backspace") {
      event.preventDefault();
      handleKey("BACKSPACE");
    } else if (/^[a-zA-Z]$/.test(event.key)) {
      handleKey(event.key.toUpperCase());
    }
  });

  // Modal open/close
  el["btn-help"].addEventListener("click", function () { openModal("modal-help"); });
  el["btn-stats"].addEventListener("click", showStats);
  el["btn-yesterday"].addEventListener("click", showYesterday);
  el["btn-share"].addEventListener("click", shareResult);
  el["btn-replay"].addEventListener("click", replayPuzzle);

  el.overlay.addEventListener("click", function (event) {
    if (event.target === el.overlay || event.target.hasAttribute("data-close")) {
      if (openModalId === "modal-help") writeJSON(STORAGE_KEYS.tutorial, { seen: true });
      // detail === 0 means the click was synthesised by the keyboard (Enter or
      // Space on the button); a real pointer click reports a click count.
      closeModal(event.detail === 0);
    }
  });

  // Tapping the board reopens the results panel once the puzzle is solved.
  el.board.addEventListener("click", function () {
    if (game.state.completed && !isModalOpen()) showResults();
  });
}

function init() {
  applyUrlOverrides();
  cacheDom();

  game.puzzle = getDailyPuzzle();
  game.state = loadState(game.puzzle);
  game.stats = loadStats();

  renderHeader();
  renderKeyboard();
  renderBoard();
  renderHint();
  bindEvents();

  if (CONFIG.debug) renderDebugBar();

  // First visit → tutorial. The acknowledgement is remembered forever.
  var tutorial = readJSON(STORAGE_KEYS.tutorial, null);
  if (!tutorial || !tutorial.seen) {
    openModal("modal-help");
    writeJSON(STORAGE_KEYS.tutorial, { seen: true });
  } else if (game.state.completed) {
    // Returning to a finished puzzle: show the result straight away.
    setTimeout(showResults, 250);
  }

  if (typeof window !== "undefined") window.LADDER = debugApi();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

/* Exported for the Node test harness (test.js); harmless in the browser. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONFIG: CONFIG,
    DICTIONARY: DICTIONARY,
    START_LIST: START_LIST,
    isValidWord: isValidWord,
    isValidTransition: isValidTransition,
    changedIndex: changedIndex,
    diffCount: diffCount,
    neighbours: neighbours,
    calculateShortestPath: calculateShortestPath,
    optimalMoves: optimalMoves,
    getDailyPuzzle: getDailyPuzzle,
    startWordFor: startWordFor,
    startWordForPuzzle: startWordForPuzzle,
    daysSinceEpoch: daysSinceEpoch,
    loadState: loadState,
    saveState: saveState,
    loadStats: loadStats,
    saveStats: saveStats,
    updateStats: updateStats,
    markPlayed: markPlayed,
    defaultStats: defaultStats,
    submitGuess: submitGuess,
    game: game,
    STORAGE_KEYS: STORAGE_KEYS,
    MESSAGES: MESSAGES
  };
}
