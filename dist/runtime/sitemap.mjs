import { eventHandler } from 'h3'
import { createRequire } from 'module'
import { validHttpCache } from '~sitemap/runtime/cache.mjs'
import { createSitemap } from '~sitemap/runtime/builder.mjs'
import { excludeRoutes } from '~sitemap/runtime/routes.mjs'
import { createRoutesCache } from '~sitemap/runtime/cache.mjs'
import { useRuntimeConfig } from '#internal/nitro'

export const globalCache = { cache: {}, staticRoutes: null }

const getLocaleFromHost = (host) => {
  var strs = host.split('.')
  if (strs.length == 2) {
    return 'en'
  }
  return strs[0]
}

export default eventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const res = event.res
  const req = event.req
  process.env.LOCALE = getLocaleFromHost(req.headers.host)
  const KEY_CACHE = process.env.LOCALE + event.req.url


  const require = createRequire(import.meta.url)
  if (!require) {
    console.log('cant use require in middleware')
  }
  // eslint-disable-next-line no-new-func,no-eval

  const options = eval('(' + runtimeConfig.sitemap.options + ')')[event.req.url]

  const staticRoutes = runtimeConfig.sitemap.staticRoutes

  // Init cache
  if (!globalCache.staticRoutes) {
    globalCache.staticRoutes = () => excludeRoutes(options.exclude, staticRoutes)
  }

  if (!globalCache.cache[KEY_CACHE]) {
    globalCache.cache[KEY_CACHE] = createRoutesCache(globalCache, options)
  }

  try {
    // Init sitemap

    const routes = await globalCache.cache[KEY_CACHE].get('routes')
    const xml = createSitemap(options, routes, options.base, req).toXML()
    // Check cache headers
    if (validHttpCache(xml, options.etag, req, res)) {
      return
    }
    // Send http response
    res.setHeader('Content-Type', 'application/xml')
    res.end(xml)
  } catch (err) {
    /* istanbul ignore next */
    return err
  }
})
