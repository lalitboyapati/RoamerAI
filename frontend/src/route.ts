import { useEffect, useState } from "react";

/**
 * Three surfaces, one bundle. A hash route rather than a router: the whole site
 * is one static file, and adding a dependency to read `location.hash` would be
 * a poor trade.
 */
export type Route = "landing" | "atlas" | "profile" | "layers";

const parse = (): Route => {
  const h = location.hash.replace(/^#\/?/, "");
  return h === "atlas" || h === "profile" || h === "layers" ? h : "landing";
};

export const go = (r: Route) => {
  location.hash = r === "landing" ? "/" : `/${r}`;
};

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
