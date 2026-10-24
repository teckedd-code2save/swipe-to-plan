import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import PlannerApp from "./PlannerApp.jsx";

function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const change = () => { if(location.hash.startsWith('#/'))setHash(location.hash); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  return hash.startsWith('#/room') ? <><a className="legacy-home-link" href="#/">← Back to the planning studio</a><App/></> : <PlannerApp key={hash.startsWith('#/day/')?hash:'studio'}/>;
}
createRoot(document.getElementById("root")).render(<Root />);
