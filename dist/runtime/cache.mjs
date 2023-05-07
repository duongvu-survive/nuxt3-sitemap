import { promisify } from "util";
import AsyncCache from "async-cache";
import unionBy from "lodash.unionby";
import generateETag from "etag";
import fresh from "fresh";
export function createRoutesCache(globalCache, options) {
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
export function validHttpCache(entity, options, req, res) {
  if (!options) {
    return false;
  }
  const { hash } = options;
  const etag = hash ? hash(entity, options) : generateETag(entity, options);
  if (fresh(req.headers, { etag })) {
    res.statusCode = 304;
    res.end();
    return true;
  }
  res.setHeader("ETag", etag);
  return false;
}
