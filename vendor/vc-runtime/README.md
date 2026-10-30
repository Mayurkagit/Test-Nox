# Microsoft Visual C++ runtime (x64)

`msvcp140.dll`, `msvcp140_1.dll`, `msvcp140_atomic_wait.dll`, `vcruntime140.dll` and
`vcruntime140_1.dll` (version 14.50.35719.0,
from Microsoft's Visual C++ 2015–2022 Redistributable, x64).

The captcha solver (`onnxruntime-node`) needs them. Windows 10 PCs without the
Redistributable failed to start the app ("The specified module could not be found"
for `onnxruntime_binding.node`). `scripts/copy-vc-runtime.cjs` puts these copies next
to `onnxruntime_binding.node` (on `npm install` and before packaging), where Windows
looks for them first, so the solver loads without installing anything.
