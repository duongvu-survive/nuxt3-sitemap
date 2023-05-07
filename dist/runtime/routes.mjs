import Minimatch from "minimatch";
export function excludeRoutes(patterns, routes) {
  patterns.forEach((pattern) => {
    const minimatch = new Minimatch.Minimatch(pattern);
    minimatch.negate = true;
    routes = routes.filter(({ url }) => minimatch.match(url));
  });
  return routes;
}
export function getStaticRoutes(router) {
  return flattenStaticRoutes(router);
}
function flattenStaticRoutes(router, path = "", routes = []) {
  router.forEach((route) => {
    if ([":", "*"].some((c) => route.path.includes(c))) {
      return;
    }
    if (route.children && route.children.length > 0) {
      return flattenStaticRoutes(route.children, path + route.path + "/", routes);
    }
    route.url = path.length && !route.path.length ? path.slice(0, -1) : path + route.path;
    routes.push(route);
  });
  return routes;
}
