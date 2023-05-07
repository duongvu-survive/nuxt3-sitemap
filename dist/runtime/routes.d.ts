/**
 * Exclude routes by matching glob patterns on url
 *
 * @param   {string[]} patterns
 * @param   {Array}    routes
 * @returns {Array}
 */
export declare function excludeRoutes(patterns: any, routes: any): any;
/**
 * Get static routes from Nuxt router and ignore dynamic routes
 *
 * @param   {Object} router
 * @returns {Array}
 */
export declare function getStaticRoutes(router: any): never[];
