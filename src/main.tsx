import React from "react";
import { createRoot } from "react-dom/client";
import App from "./Portal";
import "./style.css";
if (location.hostname === "ironman-offbeat.github.io") {
  location.replace(`https://forestwom.2hayoung.com/${location.hash}`);
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
