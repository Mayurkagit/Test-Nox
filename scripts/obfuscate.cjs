// Package-time copy of the main-process and page-engine scripts, minified with
// local names mangled, into obf/. electron-builder packages obf/ in place of the
// sources (build.files in package.json); the sources themselves stay readable.
// Kept deliberately light (no compress passes, no string encoding, function and
// class names kept): the same code runs, only shorter names and no comments.
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'obf');
const FILES = [
  'main.js',
  'preload.js',
  'preload.cjs',
  'preload-dda.js',
  'preload-pdfviewer.cjs',
  'preload-portal.cjs',
  'placeholderImages.cjs',
  'step2Resolver.js',
  'step2Tree.js',
  'flatPageBudget.js',
  'runTrace.js',
  'db/database.js',
  'engine/vision.js',
];

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let inBytes = 0;
  let outBytes = 0;
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const isModule = /^\s*(import|export)\s/m.test(src);
    const res = await minify(src, {
      module: isModule,
      compress: false,
      mangle: { toplevel: false },
      keep_fnames: true,
      keep_classnames: true,
      format: { comments: false },
    });
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, res.code);
    inBytes += src.length;
    outBytes += res.code.length;
  }
  console.log(`[obfuscate] ${FILES.length} files, ${Math.round(inBytes / 1024)} KB -> ${Math.round(outBytes / 1024)} KB in obf/`);
})().catch((err) => {
  console.error('[obfuscate] failed:', err);
  process.exit(1);
});
