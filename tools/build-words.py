"""
Regenerate ../words.js — the bundled 4-letter dictionary and the curated list of
daily starting words.

You only need this if you want to change the dictionary; the generated words.js
is committed, so the game runs without it.

Download the four source lists into tools/sources/ first:

  enable1.txt   https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
  popular.txt   https://raw.githubusercontent.com/dolph/dictionary/master/popular.txt
  en_50k.txt    https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
  badwords.txt  https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en

Then:  python3 tools/build-words.py [target] && node test.js

The recipe: take the ENABLE word list (lowercase only, so no proper nouns or
abbreviations), keep the entries that are either in a curated "popular words"
list or common enough in an OpenSubtitles frequency list, then subtract
profanity, slurs and the non-English/proper-noun residue. Starting words are the
frequent, concrete survivors that BFS proves are 3-8 moves from the target.

The target defaults to "fish"; pass another four-letter word as argv[1].
"""
import collections, json, textwrap

import os
import sys

# The word every ladder must reach. Change it here (and in CONFIG.targetWord in
# script.js) to re-theme the game; everything below re-derives from it.
TARGET = (sys.argv[1] if len(sys.argv) > 1 else "fish").lower()
assert len(TARGET) == 4 and TARGET.isalpha(), "target must be four letters"

HERE = os.path.dirname(os.path.abspath(__file__))
SP = os.path.join(HERE, "sources") + os.sep   # downloaded source lists (see README)
OUT = os.path.join(HERE, "..") + os.sep       # where words.js is written

def load4(fn):
    return {l.strip().lower() for l in open(SP+fn)
            if len(l.strip()) == 4 and l.strip().isalpha() and l.strip().isascii()}

enable  = load4("enable1.txt")    # ENABLE scrabble list: lowercase, no proper nouns/abbreviations
popular = load4("popular.txt")    # curated "popular English words" subset
ldnoobw = load4("badwords.txt")   # profanity blocklist

freq = {}
for line in open(SP+"en_50k.txt"):
    p = line.split()
    if len(p) == 2 and len(p[0]) == 4 and p[0].isalpha() and p[0].isascii():
        w = p[0].lower()
        freq[w] = max(freq.get(w, 0), int(p[1]))

words = popular | {w for w in enable if freq.get(w, 0) >= 200}

# --- Removals -------------------------------------------------------------
OFFENSIVE = set("""
arse bung crap dyke fart hell jism jizz jugs loin piss pube puke slag turd homo paki gyps gypo
gook wops dago spaz gimp hebe injun kraut coon spic chink shat scum wuss damn hoes tits pecs
""".split())

# Foreign words, transliterations, proper nouns, brand/abbrev noise that survived the filters.
NONENGLISH = set("""
abba agha agin alba alfa amah amin amir ambo amis anil argo baal bade baht bene birk blam bloc bolo
bora bren brie brin brit bris bura caca cade capo chao chia chon coca conn cris dada dahl dato deco
deke deva dido doge dona duce duma egad emir eros eyre fado fane feck fess fido fiat fora foss fugu
gama gees geum giro gogo guan hadj hagh haji hajj helo hoke hora hogg huns hwan jarl jefe jeon jiao
jinn joes joss juju jura kaka kami kana kaon kapa kata keno kemp kino kobo koss koto lakh leno lido
linn lobo loca luce lutz maud mads mano meta migs miri moly mons mott nene nils nona nori oyez pele
peri pika pina pish poco prez pugh puja raja raki rami rani rath raya rebs rees regs rhea roto sabe
sade saki sark sept sima sith sora soph sous spas sura syne taka tali tano tiki toga toph tora tori
tosh toyo tsar tuts vail vena vill vive weet wich wynn yech yipe yogi yoni zeta
""".split())

# Words whose only purpose here would be as an unpleasant daily headline; keep the game friendly.
words -= (ldnoobw | OFFENSIVE | NONENGLISH)
words |= {TARGET}   # the target must always be playable

# --- Graph / BFS ----------------------------------------------------------
ALPHA = "abcdefghijklmnopqrstuvwxyz"

def neighbours(w, S):
    for i in range(4):
        for c in ALPHA:
            if c != w[i]:
                x = w[:i] + c + w[i+1:]
                if x in S:
                    yield x

dist = {TARGET: 0}
q = collections.deque([TARGET])
while q:
    w = q.popleft()
    for n in neighbours(w, words):
        if n not in dist:
            dist[n] = dist[w] + 1
            q.append(n)

print("target:", TARGET.upper())
print("dictionary:", len(words), "| reachable from target:", len(dist))
print("distance histogram:", sorted(collections.Counter(dist.values()).items()))

# --- Start words ----------------------------------------------------------
STOP = set("""
that what this have your know with just here they like come well yeah will want from when them were
take then been some more very only much sure than does ever else many such both most each says goes
thus hers ours whom plus into onto upon also self none nope amen okay whoa gosh heck blah jeez ouch
isnt dont cant wont aint lets thee thou said mean even same kind real fine nice must sort less till
fact case true seem high half past type ways form unit term area role base main gets sees runs puts
hits wins ends ages laws thru twas shes olds hows loca whys duds
""".split())

NAMES = set("""
mike tony nick jane jake matt alan carl rick josh dean hank joey lily brad beth jess earl cole maya
toby ruth john jack duke papa mama jews mars gene ward monk pope bush hong navy adam alex andy anne
dave doug emma eric erik fred gary greg jean jill joan kate luke mark mary paul pete rose sara sean
seth todd noah owen ryan otto rita nina lisa lola gina cody kyle leon dale glen hugh ivan jody kris
lars marc nate neil phil rudy russ stan tara troy vera wade zach hans hugo iris jade joel juan judy
june kara karl kent lana lane leah lena levi liam lois lord lucy luis mack moes nell noel nora omar
opal otis pearl rene robb rosa ruby sage saul shay tess theo tina tito toms tori trey vlad walt wes
zane zeke eden asia cuba iowa ohio utah rome cuba lima kiev oslo york bali fiji peru chad togo oman
""".split())

BAD_TONE = set("""
kill dead dies died hate liar jail bomb guns drug gang bury debt harm ruin deaf dumb weak dirt junk
rats slap yell mess sick pain fear loss lied lies rude jerk punk bust hurt shot gore stab guts corpse
""".split())

candidates = [w for w in dist
              if 3 <= dist[w] <= 8
              and w in popular
              and freq.get(w, 0) >= 1500
              and w not in STOP and w not in NAMES and w not in BAD_TONE]
candidates.sort(key=lambda w: -freq.get(w, 0))
starts = sorted(candidates[:400])
print("start words:", len(starts),
      "| dist spread:", sorted(collections.Counter(dist[w] for w in starts).items()))

# --- Sanity checks --------------------------------------------------------
assert all(w in words for w in starts)
assert all(dist[w] >= 3 for w in starts)
assert TARGET in words and "swim" in words and "slim" in words
assert TARGET not in starts, "the target must not also be a starting word"

# --- Emit words.js --------------------------------------------------------
sorted_words = sorted(words)
lines = textwrap.wrap(" ".join(sorted_words), 96)
body = "\n".join('  "%s",' % l for l in lines)
start_lines = textwrap.wrap(" ".join(starts), 96)
start_body = "\n".join('  "%s",' % l for l in start_lines)

target = TARGET.upper()
js = f'''/**
 * words.js — bundled game data.
 *
 * WORD_LIST: {len(sorted_words)} common four-letter English words, stored as space-separated
 * chunks (small download, trivial to diff) and expanded into a Set at load time.
 * Sources: the ENABLE open word list intersected with an OpenSubtitles frequency
 * list, filtered for profanity, slurs, proper nouns and non-English entries.
 *
 * START_WORDS: {len(starts)} curated daily starting words. Every one of them is
 * guaranteed (by breadth-first search over WORD_LIST) to have a path to
 * {target}, and to be at least 3 moves away so the puzzle is never trivial.
 *
 * Both lists are lowercase; the UI uppercases for display.
 */

const WORD_LIST_CHUNKS = [
{body}
];

const START_WORD_CHUNKS = [
{start_body}
];

const WORD_LIST = WORD_LIST_CHUNKS.join(" ").split(" ");
const START_WORDS = START_WORD_CHUNKS.join(" ").split(" ");

/* Exported for the Node test harness; in the browser the consts above are
   ordinary script-scope globals that script.js reads directly. */
if (typeof module !== "undefined" && module.exports) {{
  module.exports = {{ WORD_LIST: WORD_LIST, START_WORDS: START_WORDS }};
}}
'''
open(OUT+"words.js", "w").write(js)
print("wrote words.js")


