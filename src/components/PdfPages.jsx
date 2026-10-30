import React, { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// PDFs are drawn with pdf.js, not Chromium's built-in viewer: the app turns
// site isolation off for Fast Payment (main.js, disable-site-isolation-trials)
// and with that switch the built-in viewer shows every PDF blank.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const str = String(data || "");
  const comma = str.indexOf(",");
  if (!str.startsWith("data:") || comma < 0) return null;
  const bin = atob(str.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Every page of a PDF, one canvas each, fitted to the container's width.
export default function PdfPages({ data, background = "#ffffff" }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.innerHTML = "";
    setStatus("loading");
    const bytes = toBytes(data);
    if (!bytes) {
      setStatus("error");
      return undefined;
    }

    let cancelled = false;
    // pdf.js takes ownership of the buffer, so it gets its own copy.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    (async () => {
      try {
        const pdf = await task.promise;
        const width = Math.max(320, host.clientWidth - 16);
        const ratio = window.devicePixelRatio || 1;
        for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
          canvas.style.display = "block";
          canvas.style.margin = "0 auto 12px";
          canvas.style.background = background;
          canvas.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          console.warn("[PdfPages] could not render PDF:", err);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      try { task.destroy(); } catch (_) {}
    };
  }, [data, background]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
      {status === "loading" && (
        <div style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", padding: "12px" }}>Opening PDF…</div>
      )}
      {status === "error" && (
        <div style={{ color: "#fca5a5", fontSize: "13px", textAlign: "center", padding: "12px" }}>
          Could not open this PDF. Use Download to save it instead.
        </div>
      )}
      <div ref={hostRef} />
    </div>
  );
}
