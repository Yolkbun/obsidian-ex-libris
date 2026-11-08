import esbuild from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import process from "node:process";

const watch = process.argv.includes("--watch");
const production = process.env.NODE_ENV === "production";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "child_process",
    "node:fs/promises",
    "net",
    "fs",
    "path",
    "os",
    "crypto",
    "http",
    "https",
    "url",
    "util",
    "stream",
  ],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "dist/main.js",
  banner: {
    js: '/* Ex Libris 藏书票 — GPL-3.0-or-later — 侧车源自 ch6vip/fqapp (GPL-3.0) */',
  },
};

for (const file of ["manifest.json", "styles.css"]) {
  await copyFile(file, `dist/${file}`);
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[ex-libris] watching…");
} else {
  await esbuild.build(options);
  console.log("[ex-libris] built dist/main.js");
}
