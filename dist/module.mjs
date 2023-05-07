import path, { join } from 'path';
import fs from 'fs-extra';
import { createResolver, addServerHandler, defineNuxtModule } from '@nuxt/kit';
import { transformSync } from '@babel/core';
import { gzipSync } from 'zlib';
import { hostname } from 'os';
import { URL } from 'url';
import isHTTPS from 'is-https';
import * as sm from 'sitemap';
import consola from 'consola';
import { promisify } from 'util';
import AsyncCache from 'async-cache';
import unionBy from 'lodash.unionby';
import 'etag';
import 'fresh';
import Minimatch from 'minimatch';

function warn(message, options = null) {
  consola.warn({
    message: `[sitemap-module] ${message}`,
    additional: options ? JSON.stringify(options, null, 2) : null
  });
}
function fatal(message, options = null) {
  consola.fatal({
    message: `[sitemap-module] ${message}`,
    additional: options ? JSON.stringify(options, null, 2) : null
  });
}
const logger = { success: consola.success, info: consola.info, fatal, warn };

function createSitemap(options, routes, base = null, req = null) {
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
function createSitemapIndex(options, base = null, req = null) {
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

function createRoutesCache(globalCache, options) {
  const cache = new AsyncCache({
    maxAge: options.cacheTime,
    async load(_, callback) {
      try {
        let routes = await Promise.all(await promisifyRoute(options.routes));
        routes = joinRoutes(globalCache.staticRoutes ? globalCache.staticRoutes() : [], routes);
        callback(null, routes);
      } catch (err) {
        callback(err);
      }
    }
  });
  cache.get = promisify(cache.get);
  return cache;
}
function promisifyRoute(fn) {
  if (Array.isArray(fn)) {
    return Promise.resolve(
      fn.map(async (r) => {
        if (typeof r === "function") {
          return await promisifyRoute(r);
        }
        return r;
      })
    );
  }
  if (fn.length === 1) {
    return new Promise((resolve, reject) => {
      fn(function(err, routeParams) {
        if (err) {
          reject(err);
        }
        resolve(routeParams);
      });
    });
  }
  let promise = fn();
  if (!promise || !(promise instanceof Promise) && typeof promise.then !== "function") {
    promise = Promise.resolve(promise);
  }
  return promise;
}
function joinRoutes(staticRoutes, dynamicRoutes) {
  staticRoutes = staticRoutes.map(ensureIsValidRoute);
  dynamicRoutes = dynamicRoutes.map(ensureIsValidRoute);
  return unionBy(dynamicRoutes, staticRoutes, "url");
}
function ensureIsValidRoute(route) {
  let _route = typeof route === "object" ? { ...route } : route;
  _route = typeof _route === "object" ? _route.route ? { url: _route.route } : _route : { url: _route };
  _route.url = String(_route.url);
  return _route;
}

const MODULE_NAME = "Nuxt 3 Sitemap Module";
const DEFAULT_NUXT_PUBLIC_PATH = "/_nuxt/";
function setDefaultSitemapOptions(options, nuxtInstance, isLinkedToSitemapIndex = false) {
  const defaults = {
    path: "/sitemap.xml",
    hostname: nuxtInstance.options.app.buildAssetsDir !== DEFAULT_NUXT_PUBLIC_PATH ? nuxtInstance.options.app.buildAssetsDir : void 0,
    exclude: [],
    routes: nuxtInstance.options.generate.routes || [],
    cacheTime: 1e3 * 60 * 15,
    etag: nuxtInstance.options.render?.etag || { weak: true },
    filter: void 0,
    gzip: false,
    xmlNs: void 0,
    xslUrl: void 0,
    trailingSlash: false,
    lastmod: void 0,
    i18n: void 0,
    defaults: {},
    base: "/"
  };
  const sitemapOptions = {
    ...defaults,
    ...options
  };
  if (sitemapOptions.i18n) {
    const modules = nuxtInstance.options._installedModules.map((m) => m.meta?.name);
    if (!modules.includes("@nuxtjs/i18n")) {
      logger.warn(
        `To enable the "i18n" option, the "${MODULE_NAME}" must be declared after the "nuxt-i18n" module in your config`
      );
    }
    if (typeof sitemapOptions.i18n === "string") {
      sitemapOptions.i18n = true;
    }
    sitemapOptions.i18n = {
      locales: [],
      routesNameSeparator: "___",
      ...sitemapOptions.i18n
    };
  }
  if (sitemapOptions.generate) {
    logger.warn("The `generate` option isn't needed anymore in your config. Please remove it!");
  }
  if (!sitemapOptions.path) {
    logger.fatal("The `path` option is either empty or missing in your config for a sitemap", options);
  }
  if (sitemapOptions.lastmod && !isLinkedToSitemapIndex) {
    logger.warn("The `lastmod` option is only available in the config of a sitemap linked to a sitemap index");
  }
  sitemapOptions.pathGzip = sitemapOptions.gzip ? `${sitemapOptions.path}.gz` : sitemapOptions.path;
  return sitemapOptions;
}
function setDefaultSitemapIndexOptions(options, nuxtInstance) {
  const defaults = {
    path: "/sitemapindex.xml",
    hostname: void 0,
    sitemaps: [],
    lastmod: void 0,
    etag: nuxtInstance.options.render?.etag || { weak: true },
    gzip: false,
    xmlNs: void 0,
    xslUrl: void 0,
    base: "/"
  };
  const sitemapIndexOptions = {
    ...defaults,
    ...options
  };
  if (sitemapIndexOptions.generate) {
    logger.warn("The `generate` option isn't needed anymore in your config. Please remove it!");
  }
  if (!sitemapIndexOptions.path) {
    logger.fatal("The `path` option is either empty or missing in your config for a sitemap index", options);
  }
  sitemapIndexOptions.sitemaps.forEach((sitemapOptions) => {
    if (!sitemapOptions.path) {
      logger.fatal("The `path` option is either empty or missing in your config for a sitemap", sitemapOptions);
    }
    sitemapOptions.hostname = sitemapOptions.hostname || sitemapIndexOptions.hostname;
  });
  sitemapIndexOptions.pathGzip = sitemapIndexOptions.gzip ? `${sitemapIndexOptions.path}.gz` : sitemapIndexOptions.path;
  return sitemapIndexOptions;
}

function excludeRoutes(patterns, routes) {
  patterns.forEach((pattern) => {
    const minimatch = new Minimatch.Minimatch(pattern);
    minimatch.negate = true;
    routes = routes.filter(({ url }) => minimatch.match(url));
  });
  return routes;
}
function getStaticRoutes(router) {
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

async function generateSitemaps(options, globalCache, nuxtInstance, depth = 0) {
  if (depth > 1) {
    logger.warn("A sitemap index file can't list other sitemap index files, but only sitemap files");
  }
  if (!nuxtInstance.options.generate?.dir) {
    nuxtInstance.options.generate.dir = nuxtInstance.options.srcDir;
  }
  const publicDir = "/.output/public";
  const isSitemapIndex = options && options.sitemaps && Array.isArray(options.sitemaps) && options.sitemaps.length > 0;
  if (isSitemapIndex) {
    await generateSitemapIndex(options, globalCache, nuxtInstance, depth, publicDir);
  } else {
    await generateSitemap(options, globalCache, nuxtInstance, depth, publicDir);
  }
}
async function generateSitemap(options, globalCache, nuxtInstance, depth = 0, publicDir) {
  options = setDefaultSitemapOptions(options, nuxtInstance, depth > 0);
  const cache = { staticRoutes: null, routes: null };
  cache.staticRoutes = () => excludeRoutes(options.exclude, globalCache.staticRoutes);
  cache.routes = createRoutesCache(cache, options);
  const routes = await cache.routes.get("routes");
  const base = nuxtInstance.options.router.base;
  const sitemap = await createSitemap(options, routes, base);
  const xmlFilePath = path.join(nuxtInstance.options.generate.dir, publicDir, options.path);
  fs.outputFileSync(xmlFilePath, sitemap.toXML());
  logger.success("Generated", getPathname(nuxtInstance.options.generate.dir, xmlFilePath));
  if (options.gzip) {
    const gzipFilePath = path.join(nuxtInstance.options.generate.dir, publicDir, options.pathGzip);
    fs.outputFileSync(gzipFilePath, sitemap.toGzip());
    logger.success("Generated", getPathname(nuxtInstance.options.generate.dir, gzipFilePath));
  }
}
async function generateSitemapIndex(options, globalCache, nuxtInstance, depth = 0, publicDir) {
  options = setDefaultSitemapIndexOptions(options, nuxtInstance);
  const base = nuxtInstance.options.router.base;
  const xml = createSitemapIndex(options, base);
  const xmlFilePath = path.join(nuxtInstance.options.generate.dir, publicDir, options.path);
  fs.outputFileSync(xmlFilePath, xml);
  logger.success("Generated", getPathname(nuxtInstance.options.generate.dir, xmlFilePath));
  if (options.gzip) {
    const gzip = gzipSync(xml);
    const gzipFilePath = path.join(nuxtInstance.options.generate.dir, publicDir, options.pathGzip);
    fs.outputFileSync(gzipFilePath, gzip);
    logger.success("Generated", getPathname(nuxtInstance.options.generate.dir, gzipFilePath));
  }
  await Promise.all(
    options.sitemaps.map((sitemapOptions) => generateSitemaps(sitemapOptions, globalCache, nuxtInstance, depth + 1))
  );
}
function getPathname(dirPath, filePath) {
  return [, ...path.relative(dirPath, filePath).split(path.sep)].join("/");
}

function registerSitemaps(options, globalCache, nuxtInstance, depth = 0) {
  if (depth > 1) {
    logger.warn("A sitemap index file can't list other sitemap index files, but only sitemap files");
  }
  const isSitemapIndex = options && options.sitemaps && Array.isArray(options.sitemaps) && options.sitemaps.length > 0;
  if (isSitemapIndex) {
    registerSitemapIndex(options, globalCache, nuxtInstance, depth);
  } else {
    registerSitemap(options, globalCache, nuxtInstance, depth);
  }
}
function registerSitemap(options, globalCache, nuxtInstance, depth = 0) {
  options = setDefaultSitemapOptions(options, nuxtInstance, depth > 0);
  options = prepareOptionPaths(options, nuxtInstance);
  globalCache.options[options.path] = options;
  const { resolve } = createResolver(import.meta.url);
  nuxtInstance.options.alias["~sitemap"] = resolve("./");
  if (options.gzip) {
    const _path = options.pathGzip || options.path + ".gz";
    globalCache.options[_path] = options;
    addServerHandler({
      route: _path,
      handler: resolve("./runtime/sitemap.gzip.mjs")
    });
  }
  addServerHandler({
    route: options.path,
    handler: resolve("./runtime/sitemap.mjs")
  });
}
function registerSitemapIndex(options, globalCache, nuxtInstance, depth = 0) {
  options = setDefaultSitemapIndexOptions(options, nuxtInstance);
  options = prepareOptionPaths(options, nuxtInstance);
  globalCache.options[options.path] = options;
  const { resolve } = createResolver(import.meta.url);
  nuxtInstance.options.alias["~sitemap"] = resolve("./");
  if (options.gzip) {
    const _path = options.pathGzip || options.path + ".gz";
    globalCache.options[_path] = options;
    addServerHandler({
      route: _path,
      handler: resolve("./runtime/sitemapindex.gzip.mjs")
    });
  }
  addServerHandler({
    route: options.path,
    handler: resolve("./runtime/sitemapindex.mjs")
  });
  options.sitemaps.forEach((sitemapOptions) => registerSitemaps(sitemapOptions, globalCache, nuxtInstance, depth + 1));
}
function prepareOptionPaths(options, nuxtInstance) {
  options.base = nuxtInstance.options.app.baseURL || "/";
  options.path = options.base !== "/" || options.path.startsWith("/") ? options.path : "/" + options.path;
  options.pathGzip = options.base !== "/" || options.pathGzip.startsWith("/") ? options.pathGzip : "/" + options.pathGzip;
  return options;
}

const module = defineNuxtModule({
  async setup(moduleOptions, nuxtInstance) {
    const options = await initOptions(nuxtInstance, moduleOptions);
    if (options === false) {
      logger.info("Sitemap disabled");
      return;
    }
    const jsonStaticRoutesPath = !nuxtInstance.options.dev ? path.resolve(nuxtInstance.options.buildDir, path.join("dist", "sitemap-routes.json")) : null;
    const staticRoutes = fs.readJsonSync(jsonStaticRoutesPath, { throws: false });
    const globalCache = { staticRoutes, options: {} };
    nuxtInstance.hook("pages:extend", (routes) => {
      globalCache.staticRoutes = getStaticRoutes(routes);
      if (!nuxtInstance.options.dev) {
        fs.outputJsonSync(jsonStaticRoutesPath, globalCache.staticRoutes);
      }
    });
    nuxtInstance.hook("nitro:build:before", async (nitro) => {
      nitro.options.runtimeConfig.sitemap = {
        options: await optionsToString(globalCache.options),
        staticRoutes: globalCache.staticRoutes
      };
      let isPreRender = false;
      nitro.hooks.hook("prerender:route", (ctx) => {
        if (!ctx.route.includes(".js") && !globalCache.staticRoutes.find((r) => r.url === ctx.route)) {
          globalCache.staticRoutes.push({ url: ctx.route, path: ctx.route, name: ctx.route.replaceAll("/", "-") });
          nitro.options.runtimeConfig.sitemap = {
            options: nitro.options.runtimeConfig.sitemap.options,
            staticRoutes: globalCache.staticRoutes
          };
          isPreRender = true;
        }
      });
      nitro.hooks.hook("close", async () => {
        if (isPreRender || moduleOptions.generateOnBuild) {
          await nuxtInstance.callHook("sitemap:generate:before", nuxtInstance, options);
          logger.info("Generating sitemaps");
          await Promise.all(options.map((options2) => generateSitemaps(options2, globalCache, nuxtInstance)));
          await nuxtInstance.callHook("sitemap:generate:done", nuxtInstance);
        }
      });
    });
    options.forEach((options2) => {
      registerSitemaps(options2, globalCache, nuxtInstance);
    });
  }
});
async function optionsToString(options) {
  let string = "";
  if (Array.isArray(options)) {
    string += `[${await Promise.all(options.map((o) => optionsToString(o)))}]`;
    return string;
  }
  if (typeof options === "object") {
    string += "{";
    for (const [key, value] of Object.entries(options)) {
      if (string.length > 1) {
        string += ", ";
      }
      if (Array.isArray(value)) {
        string += `"${key}": [${await Promise.all(value.map((o) => optionsToString(o)))}]`;
        continue;
      }
      string += `"${key}": ${await optionsToString(value)}`;
    }
    string += "}";
    return string;
  }
  if (typeof options === "function") {
    const code = transformSync(options, {
      minified: true
    });
    return code.code.slice(0, -1);
  }
  if (["function", "boolean", "number"].includes(typeof options)) {
    return options.toString();
  }
  if (options === void 0) {
    return "null";
  }
  return `'${options.toString()}'`;
}
async function initOptions(nuxtInstance, moduleOptions) {
  if (nuxtInstance.options.sitemap === false || moduleOptions === false) {
    return false;
  }
  let options = nuxtInstance.options.sitemap || moduleOptions;
  if (typeof options === "function") {
    options = await options.call(nuxtInstance);
  }
  if (options === false) {
    return false;
  }
  return Array.isArray(options) ? options : [options];
}

export { module as default };
