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
  // Keep only the three pieces the host cannot supply: the title, the inlined
  // stylesheet and the body. Everything else in <head> — favicon, viewport,
  // Open Graph tags — belongs to the host's own shell.
  //
  // This picks the pieces out rather than stripping the shell away tag by tag.
  // Stripping is what broke before: the favicon's href is an SVG data URI full
  // of ">" characters, so a <link ...> pattern matched too little and left the
  // tag's tail rendering as stray text in the corner of the page.
  const pick = (re, what) => {
    const m = html.match(re);
    if (!m) {
      console.error("fragment build could not find the " + what);
      process.exit(1);
    }
    return m;
  };

  const title = pick(/<title>[\s\S]*?<\/title>/, "<title>")[0];
  const style = pick(/<style>[\s\S]*?<\/style>/, "inlined <style>")[0];
  const body = pick(/<body>([\s\S]*)<\/body>/, "<body>")[1];

  html = title + "\n" + style + "\n" + body.trim() + "\n";

  // Nothing head-only or shell-shaped may survive; it would render as text.
  // Match exact tags — a substring like "<head" also hits "<header class=…>".
  const leftovers = ["<link", "<meta", "<head>", "</head>", "<body>", "</body>",
                     "<html", "</html>", "</svg>"]
    .filter((tag) => html.includes(tag));
  if (leftovers.length) {
    console.error("fragment still contains document-shell markup: " + leftovers.join(", "));
    process.exit(1);
  }
}

fs.writeFileSync(path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log("wrote " + outFile + " (" + kb + " KB, self-contained)");
