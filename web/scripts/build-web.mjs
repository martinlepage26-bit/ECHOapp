/**
 * Build the canonical ECHO hardline web surface.
 *
 * Outputs to web/dist/echo/ ready to publish at martin.govern-ai.ca/echo/
 * (index.html, CSS, voices, bundled reader module).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, "dist/echo");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, "voices"), { recursive: true });

// 1) Bundle the reader as a static ES module (no tree-shaking — design lock).
await build({
  root,
  configFile: false,
  publicDir: false,
  build: {
    lib: {
      entry: path.resolve(root, "src/echo-reader.js"),
      formats: ["es"],
      fileName: () => "echo-reader.app.js",
    },
    outDir,
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    target: "es2022",
    modulePreload: false,
    rollupOptions: {
      treeshake: false,
      output: {
        inlineDynamicImports: true,
        entryFileNames: "echo-reader.app.js",
        assetFileNames: "echo-reader.[name][extname]",
      },
    },
  },
  esbuild: {
    treeShaking: false,
    minify: false,
  },
  plugins: [],
});

const bundlePath = path.join(outDir, "echo-reader.app.js");
let code = fs.readFileSync(bundlePath, "utf8");

if (!code.includes("/* echo-auto-boot */")) {
  code += `

/* echo-auto-boot */
if (typeof document !== 'undefined') {
  const boot = () => {
    try {
      initEchoReaderApp();
    } catch (err) {
      console.error('[ECHO] init failed', err);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
`;
  fs.writeFileSync(bundlePath, code);
}

// 2) Static shell + assets
fs.copyFileSync(path.join(root, "index.html"), path.join(outDir, "index.html"));
fs.copyFileSync(
  path.join(root, "echo-standalone.css"),
  path.join(outDir, "echo-standalone.css"),
);

const voicesSrc = path.join(root, "public/voices");
for (const name of fs.readdirSync(voicesSrc)) {
  const src = path.join(voicesSrc, name);
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, path.join(outDir, "voices", name));
  }
}

const bytes = fs.statSync(bundlePath).size;
const listeners = (code.match(/addEventListener/g) || []).length;
console.log(`Built ${bundlePath} (${bytes} bytes, addEventListener×${listeners})`);
console.log(`Dist ready: ${outDir}`);
if (listeners < 10) {
  console.error("ERROR: bundle looks tree-shaken/stubby; refusing to continue.");
  process.exit(1);
}
