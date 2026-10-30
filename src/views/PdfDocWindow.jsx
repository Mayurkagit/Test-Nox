import React, { useEffect, useState } from "react";
import PdfPages from "../components/PdfPages.jsx";

// Window main opens for a PDF the DDA page tried to show (main.js
// openPdfViewerWindow); the bytes come from main by the one-time token.
export default function PdfDocWindow({ token }) {
  const [doc, setDoc] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    window.ddaElectronAPI?.getPdfDocument?.(token)
      .then((d) => {
        if (d?.bytes) {
          setDoc(d);
          document.title = d.title || "Document";
        } else {
          setMissing(true);
        }
      })
      .catch(() => setMissing(true));
  }, [token]);

  return (
    <div style={{ height: "100vh", background: "#0f172a", padding: "12px", boxSizing: "border-box" }}>
      {missing ? (
        <div style={{ color: "#e2e8f0", fontSize: "14px", textAlign: "center", paddingTop: "40px" }}>
          This document is no longer available. Open it again from the DDA page.
        </div>
      ) : doc ? (
        <PdfPages data={doc.bytes} />
      ) : (
        <div style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", paddingTop: "40px" }}>Opening PDF…</div>
      )}
    </div>
  );
}
