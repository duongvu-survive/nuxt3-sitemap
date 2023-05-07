import { hostname } from "os";
import { join } from "path";
import { URL } from "url";
import isHTTPS from "is-https";
import * as sm from "sitemap";
import logger from "./logger.mjs";
export function createSitemap(options, routes, base = null, req = null) {
  const sitemapConfig = { cacheTime: null, hostname: null, xmlNs: null, xslUrl: null, urls: null };
  sitemapConfig.cacheTime = options.cacheTime || 0;
  sitemapConfig.hostname = getHostname(options, req, base);
  sitemapConfig.xmlNs = options.xmlNs;
  sitemapConfig.xslUrl = options.xslUrl;
  routes = routes.map((route) => ({ ...options.defaults, ...route }));
  if (options.trailingSlash) {
    routes = routes.map((route) => {
      if (!route.url.endsWith("/")) {
        route.url = `${route.url}/`;
      }
      return route;
    });
  }
  if (options.i18n) {
    const { locales, routesNameSeparator } = options.i18n;
    routes.reduce((i18nRoutes, route) => {
      if (!route.name) {
        return i18nRoutes;
      }
      const [page, lang, isDefault = false] = route.name.split(routesNameSeparator);
      if (!lang) {
        return i18nRoutes;
      }
      const link = {
        lang,
        url: join(".", route.url)
      };
      if (isDefault) {
        link.lang = "x-default";
      } else {
        const locale = locales.find(({ code }) => code === lang);
        if (locale && locale.iso) {
          link.lang = locale.iso;
        }
      }
      if (!i18nRoutes[page]) {
        i18nRoutes[page] = [];
      }
      const langs = i18nRoutes[page].map(({ lang: lang2 }) => lang2);
      langs.push(link.lang);
      const index = langs.sort().indexOf(link.lang);
      i18nRoutes[page].splice(index, 0, link);
      route.links = i18nRoutes[page];
      return i18nRoutes;
    }, {});
  }
  if (typeof options.filter === "function") {
    routes = options.filter({
      options: { ...sitemapConfig },
      routes
    });
  }
  routes = routes.map((route) => {
    const { chunkName, component, name, path, ...sitemapOptions } = route;
    return {
      ...sitemapOptions,
      url: join(".", String(sitemapOptions.url))
    };
  });
  sitemapConfig.urls = routes;
  return sm.createSitemap(sitemapConfig);
}
export function createSitemapIndex(options, base = null, req = null) {
  const sitemapIndexConfig = { urls: null, lastmod: null, xmlNs: null, xslUrl: null };
  const defaultHostname = options.hostname;
  sitemapIndexConfig.urls = options.sitemaps.map((options2) => {
    const path = join(".", options2.gzip ? `${options2.path}.gz` : options2.path);
    const hostname2 = getHostname(options2.hostname ? options2 : { ...options2, hostname: defaultHostname }, req, base);
    const url = new URL(path, hostname2);
    return { url: url.href, lastmod: options2.lastmod };
  });
  sitemapIndexConfig.lastmod = options.lastmod;
  sitemapIndexConfig.xmlNs = options.xmlNs;
  sitemapIndexConfig.xslUrl = options.xslUrl;
  return sm.buildSitemapIndex(sitemapIndexConfig);
}
function getHostname(options, req, base) {
  if (!options.hostname && !req) {
    logger.fatal("The `hostname` option is mandatory in your config on `spa` or `generate` build mode", options);
  }
  const href = new URL(
    base || "",
    options.hostname || req && `${isHTTPS(req) ? "https" : "http"}://${req.headers.host}` || `http://${hostname()}`
  ).href;
  return href.slice(-1) === "/" ? href : href + "/";
}
