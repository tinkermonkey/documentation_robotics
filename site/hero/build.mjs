// Bundles hero.jsx, React and heimdall-ui into one script for the overview page.
// Output: ../assets/hero.js (not committed; the Pages workflow builds it).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, "hero.jsx")],
  outfile: join(here, "..", "assets", "hero.js"),
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  logLevel: "info"
});
