/**
 * Initialize a cache instance for sitemap routes
 *
 * @param   {Object} globalCache
 * @param   {Object} options
 * @returns {AsyncCache.Cache<any>} Cache instance
 */
export declare function createRoutesCache(globalCache: any, options: any): any;
/**
 * Validate the freshness of HTTP cache using headers
 *
 * @param {Object} entity
 * @param {Object} options
 * @param {Request} req
 * @param {Response} res
 * @returns {boolean}
 */
export declare function validHttpCache(entity: any, options: any, req: any, res: any): boolean;
