import * as sm from 'sitemap';
/**
 * Initialize a fresh sitemap instance
 *
 * @param   {Object}  options
 * @param   {Array}   routes
 * @param   {string}  base
 * @param   {Request} req
 * @returns {Sitemap} sitemap instance
 */
export declare function createSitemap(options: any, routes: any, base?: null, req?: null): sm.Sitemap;
/**
 * Initialize a fresh sitemapindex instance
 *
 * @param   {Object}  options
 * @param   {string}  base
 * @param   {Request} req
 * @returns {string}
 */
export declare function createSitemapIndex(options: any, base?: null, req?: null): string;
