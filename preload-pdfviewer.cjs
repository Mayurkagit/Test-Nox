// Preload for the PDF viewer window (main.js openPdfViewerWindow): it can only
// fetch the one document main opened it for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ddaElectronAPI', {
  getPdfDocument: (token) => ipcRenderer.invoke('doc:get', token),
});
