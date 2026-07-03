import { useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { Play } from "./pages/Play";
import { Tv } from "./pages/Tv";

/** tiny hash router: #/tv/:roomId  |  #/play/:code  |  anything else = landing */
function parseHash(): { page: "landing" | "tv" | "play"; param: string } {
  const m = location.hash.match(/^#\/(tv|play)\/([^/?]+)/);
  if (m) return { page: m[1] as "tv" | "play", param: decodeURIComponent(m[2]) };
  return { page: "landing", param: "" };
}

export function navigate(hash: string): void {
  location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.page === "tv") return <Tv roomId={route.param} />;
  if (route.page === "play") return <Play code={route.param.toUpperCase()} />;
  return <Landing />;
}
