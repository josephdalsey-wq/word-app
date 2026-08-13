# FISH LADDER — a daily word ladder

Change one letter at a time, every step a real four-letter word, and get to
**FISH** in as few moves as possible. A new starting word every calendar day,
the same one for everybody.

Vanilla HTML, CSS and JavaScript. No framework, no build step, no network calls
at runtime.

```
CATS → BATS → BITS → WITS → WITH → WISH → FISH
```

## Running it

**The one-file way.** `fish-ladder.html` is the whole game inlined into a single file
— no folder, no server. Download it, double-tap it, play. It is what you want
if you just came here to play, or want the game on your phone.

**From the source files.** Open `index.html` in a browser. The page loads two
local scripts and nothing else, so `file://` works.

If you would rather serve it (needed only if you want a real origin for
localStorage across ports, or you're testing on a phone on the same network):

```sh
python3 -m http.server 8000     # then visit http://localhost:8000
# or
npx serve .
```

Rebuild the single-file version after changing any source file:

```sh
node tools/bundle.js
```

Run the test suite with:

```sh
node test.js
```

64 checks covering guess validation, the win state, deterministic daily
puzzles, BFS optimality, save/restore and the statistics rollup — including a
proof that **all 400 starting words can reach FISH**.

## Architecture

| File | What's in it |
| --- | --- |
| `index.html` | Semantic shell: `<header>` metadata, `<main>` board, keyboard `<section>`, `<footer>` buttons, and four `role="dialog"` modals (help, results, stats, yesterday). |
| `styles.css` | Every colour and size as a custom property in `:root`. Fixed-height flex column so the board scrolls internally and the keyboard never leaves the screen. |
| `script.js` | All game logic, in ten labelled sections (see below). |
| `words.js` | Generated data: the dictionary and the starting-word list. |
| `test.js` | Headless Node test suite. |
| `tools/build-words.py` | Regenerates `words.js` from public word lists. |
| `tools/bundle.js` | Inlines everything into the single-file `fish-ladder.html`. |

`script.js` is organised top to bottom as:

1. **CONFIG** — target word, epoch, debug switches.
2. **Dictionary** — `DICTIONARY` Set for O(1) `isValidWord()`, `neighbours()`
   over the one-letter-apart graph, and `calculateShortestPath()` (BFS, so the
   result is provably minimal).
3. **Daily puzzle** — `daysSinceEpoch()` → puzzle number → `startWordFor()`.
   The start word is picked by `n × stride mod length` with a stride coprime to
   the list length, which walks all 400 words before repeating and keeps
   consecutive days far apart in the list.
4. **Persistence** — `loadState()` / `saveState()` against localStorage, with a
   probe so private-mode browsers degrade to "the game works, nothing is saved"
   instead of throwing.
5. **Statistics** — `updateStats()`, streaks, distribution.
6. **Game state and rules** — `submitGuess()` returns `{ok:false, reason}` and
   never mutates the ladder on a rejected guess.
7. **Rendering** — `renderBoard()` for structural changes, `renderActiveRow()`
   for keystrokes (one row swapped, not the whole board); one `makeRow()`
   helper builds every row in the app, including the tutorial example.
8. **Input** — one delegated listener for all 28 on-screen keys, plus a
   document-level handler for the physical keyboard.
9. **Modals and sharing** — shared open/close/focus-trap plumbing, emoji-grid
   share text.
10. **Debug API and bootstrap**.

State lives in three localStorage keys: `fishladder.progress.v1` (today's
ladder), `fishladder.stats.v1`, `fishladder.tutorial.v1`. The keys are
namespaced to the game, so re-theming to a new target word starts clean rather
than restoring a ladder aimed somewhere else. Progress is keyed by puzzle number, so a
new calendar day starts a fresh ladder automatically and an old save is
discarded rather than resumed.

## Where the words live

Three lists in `words.js`, each with a different job:

- **`WORD_LIST`** — **3,670** words you are allowed to play: the whole ENABLE
  open word list minus profanity, slurs and non-English entries. Deliberately
  generous, so a real word like `CIST` or `FISC` is never rejected.
- **`COMMON_WORDS`** — the **2,144** of those a reasonable person actually
  knows. **Par is measured over this subset only**, so the benchmark stays
  something a human could find. Measured over the full accept list, par would
  route through obscure words and quietly make every score look worse — on 224
  of the 400 start words it would drop by an average of 1.3 moves.
- **`START_WORDS`** — **400** curated daily starting words, all drawn from
  `COMMON_WORDS`, so the rotation runs 400 days before repeating.

Because the two lists differ, **a player can legitimately come in under par**
by finding a shortcut through an uncommon word. That is treated as a win, not
an error: the results panel says "Under par" and the stats count it under "Par
or better".
- **Regenerating both** — `tools/build-words.py` (download instructions are in
  its docstring). It builds the graph, runs BFS from the target and only emits
  start words with a verified path. The target is `argv[1]`, defaulting to
  `fish`: `python3 tools/build-words.py fish`.

Every starting word is guaranteed solvable: `test.js` re-runs BFS from all 400
of them on every test run. Optimal distances range from 3 to 8 moves, averaging
5.64.

FISH is a narrow target: only DISH, WISH and FIST are one letter away, so every
ladder has to funnel through one of those three. That makes it a slightly longer
puzzle than a target with more entrances would be.

### Limitations of the bundled dictionary

- **ENABLE is not Merriam-Webster.** It is a Scrabble word list: broad, but it
  has its own omissions and its own oddities (`aals`, `ains`, `bize`). If a word
  you know is still rejected, it is missing from ENABLE, and the fix is to add
  it by hand in `tools/build-words.py`.
- **Par depends on the common list.** Move a word between the two lists and par
  shifts for some puzzles. Stats recorded before such a change stay on the old
  basis.
- **The common/uncommon split is frequency, not judgement.** It comes from an
  OpenSubtitles frequency list, so a word you consider everyday may sit on the
  uncommon side (and so be playable but never used for par).
- **Filtering is a blocklist, not a guarantee.** Profanity, slurs, proper nouns
  and non-English entries were removed with a published bad-words list plus a
  hand-built list; something distasteful could still have slipped through. Add
  it to `OFFENSIVE` / `NONENGLISH` in `tools/build-words.py` and regenerate.
- **No inflection awareness.** Plurals and past tenses are included when
  common (`dogs`, `told`), excluded when not — there is no rule, just frequency.
- **Spelling variants are inconsistent.** `gray` and `grey` are both in; other British/American pairs may not both have survived the frequency cut.

## Customising

Everything below is a one- or two-line edit.

| Want to change | Where |
| --- | --- |
| **Game name** | `CONFIG.gameName` in `script.js` (header, share text and `<title>` all follow it). |
| **Target word** | Three steps: `python3 tools/build-words.py <word>` to re-verify every start word against the new target, `CONFIG.targetWord` in `script.js`, and the hard-coded copy (the how-to-play line in `index.html`, the win emoji in `buildEmojiGrid()`). Bump `STORAGE_KEYS` too, so old ladders and stats don't leak into the new game. |
| **Puzzle #1's date** | `CONFIG.epoch` in `script.js`. It is app-side only; the builder does not care. |
| **Colours** | The `:root` block at the top of `styles.css`: `--bg`, `--panel`, `--border`, `--text`, `--text-dim`, `--accent`, `--accent-bright`, `--changed-bar`, `--key`. The palette is nautical — deep-water grounds, weathered-rope neutrals, buoy-teal accent. |
| **Tile / key size** | `--tile-size`, `--tile-gap`, `--maxw` in the same block. |
| **Error copy** | The `MESSAGES` object in `script.js`. |
| **Starting words** | `START_WORD_CHUNKS` in `words.js`, or better, the selection filters (`STOP`, `NAMES`, `BAD_TONE`, the frequency threshold) in `tools/build-words.py`. |
| **Which words are playable** | `accept` in `tools/build-words.py` — currently all of ENABLE minus the blocklists. Add a missing word there and regenerate. |
| **How hard par is** | `common` in the same file: the `freq.get(w, 0) >= 200` threshold decides which words par may route through. |
| **Favicon / emoji** | The `<link rel="icon">` data URI in `index.html`; share emoji in `buildEmojiGrid()`. |

## Development mode

```js
const CONFIG = {
  gameName: "FISH LADDER",
  targetWord: "FISH",
  epoch: "2025-08-15",
  debug: false,
  forcePuzzleNumber: null,
  forceStartWord: null,
  forceDate: null
};
```

With `debug: true` (or `?debug=1`) the page logs the optimal path to the
console and shows a debug bar with the optimal move count and a reset button.
With `debug: false` nothing about the solution is shown until the puzzle is
solved.

Query-string overrides, handy for testing without editing the file:

```
index.html?puzzle=362          # jump to a specific puzzle number
index.html?date=2026-03-01     # pretend it is another calendar day
index.html?start=SWIM          # force a starting word
index.html?debug=1             # turn on debug mode
```

And a console API on `window.LADDER`:

```js
LADDER.solve()          // log + return the optimal path for today
LADDER.optimal("SWIM")  // minimum moves from any word
LADDER.shareText(true)  // preview the share text
LADDER.reset()          // clear today's ladder, keep stats
LADDER.hardReset()      // clear progress, stats and the tutorial flag
LADDER.setPuzzle(362)   // reload on another puzzle
LADDER.setDate("2026-03-01")
LADDER.stats()
```

## Accessibility and mobile notes

- Semantic `<button>` elements throughout; every key carries an `aria-label`.
- Modals are `role="dialog" aria-modal="true"`, trap Tab, close on Escape or a
  backdrop click, and restore focus to whatever opened them.
- Board changes are announced through an `aria-live` region ("Move 3: S L I P,
  letter 4 changed"); toasts use `role="status"`.
- Visible focus rings everywhere, and a skip link to the board.
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding for notched
  phones; `touch-action: manipulation` kills double-tap zoom on the keys
  without disabling pinch zoom.
- Verified with no horizontal scrolling at 320 / 375 / 414 px, and the keyboard
  stays on screen with a 14-word ladder on a 375×667 phone.
- `prefers-reduced-motion` disables the tile animations.

## Attribution

Original implementation. The daily-word-ladder concept is a well-worn puzzle
form (Lewis Carroll's "doublets", 1877); nothing here is copied from any
existing site's assets or code. Word data is derived from the public-domain
ENABLE word list, dolph/dictionary, the OpenSubtitles-derived FrequencyWords
list, and the LDNOOBW profanity list.
