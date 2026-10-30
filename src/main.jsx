import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import PdfDocWindow from './views/PdfDocWindow.jsx';
import './index.css';

// ?pdfDoc=<token>: a PDF the DDA page opened, shown by main in its own window.
const pdfDocToken = new URLSearchParams(window.location.search).get('pdfDoc');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {pdfDocToken ? <PdfDocWindow token={pdfDocToken} /> : <App />}
  </React.StrictMode>
);
