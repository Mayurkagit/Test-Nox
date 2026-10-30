// Puts Microsoft's Visual C++ runtime DLLs (vendor/vc-runtime) next to the captcha
// solver's native module, so it loads on Windows PCs that don't have the Visual C++
// Redistributable installed. Windows looks for a native module's DLLs in its own
// folder first. Runs on `npm install` (postinstall) and before packaging; does
// nothing on other systems, and never fails the install.
const fs = require('fs');
const path = require('path');

// Everything onnxruntime.dll and its binding import from the Visual C++ runtime
// (checked against their import tables); the rest comes with Windows 10.
const DLLS = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

try {
  if (process.platform !== 'win32') process.exit(0);
  const root = path.join(__dirname, '..');
  const from = path.join(root, 'vendor', 'vc-runtime');
  const to = path.join(root, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64');
  if (!fs.existsSync(to)) {
    console.log('[vc-runtime] onnxruntime-node not installed yet, nothing to do');
    process.exit(0);
  }
  for (const name of DLLS) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (!fs.existsSync(src)) {
      console.warn(`[vc-runtime] missing ${src}`);
      continue;
    }
    const same = fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size;
    if (!same) fs.copyFileSync(src, dst);
    console.log(`[vc-runtime] ${name} ${same ? 'already in place' : 'copied'}`);
  }
} catch (err) {
  console.warn('[vc-runtime] could not copy the Visual C++ runtime:', err.message);
}
