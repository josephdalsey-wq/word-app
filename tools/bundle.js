/**
 * bundle.js — inline styles.css, words.js and script.js into index.html to
 * produce a single self-contained file you can email, AirDrop or drop on any
 * static host.
 *
 *   node tools/bundle.js                 → fish-ladder.html (a complete page)
 *   node tools/bundle.js --fragment out  → out (no <html>/<head>/<body>, for
 *                                          hosts that supply their own shell)
 *
 * The game already makes no network requests, so inlining is the whole job.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const args = process.argv.slice(2);
const fragmentIndex = args.indexOf("--fragment");
const isFragment = fragmentIndex !== -1;
const outFile = isFragment ? args[fragmentIndex + 1] : "fish-ladder.html";

if (isFragment && !outFile) {
  console.error("--fragment needs an output path");
  process.exit(1);
}

let html = read("index.html");

// Replacements are functions so that $-sequences in the source (e.g. "$&")
// are never interpreted as replacement patterns.
html = html.replace(
  /<link rel="stylesheet" href="styles\.css">/,
  () => "<style>\n" + read("styles.css") + "\n</style>"
);

html = html.replace(
  /<script src="words\.js"><\/script>\s*<script src="script\.js"><\/script>/,
  () => "<script>\n" + read("words.js") + "\n" + read("script.js") + "\n</script>"
);

if (html.includes("styles.css") || html.includes('src="words.js"')) {
  console.error("bundle failed: an asset reference was left un-inlined");
  process.exit(1);
}

if (isFragment) {
  // Strip the document shell and the head-only tags the host provides itself,
  // keeping <title> so the page still names itself.
  html = html
    .replace(/^[\s\S]*?<title>/, "<title>")
    .replace(/<\/title>\s*/, "</title>\n")
    // Drop the whole favicon line. Matching the tag with [^>]* does NOT work:
    // the href is an SVG data URI containing its own ">" characters, so the
    // match ends early and leaves the tag's tail behind as visible text.
    .replace(/^.*rel="icon".*\r?\n/m, "")
    .replace(/<\/head>\s*<body>\s*/, "")
    .replace(/\s*<\/body>\s*<\/html>\s*$/, "\n");

  // The shell must be fully gone: anything left over renders as stray text.
  const leftovers = ["<link", "<meta", "</head>", "<body>", "</html>", "</svg>"]
    .filter((tag) => html.includes(tag));
  if (leftovers.length) {
    console.error("fragment still contains document-shell markup: " + leftovers.join(", "));
    process.exit(1);
  }
}

fs.writeFileSync(path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log("wrote " + outFile + " (" + kb + " KB, self-contained)");
