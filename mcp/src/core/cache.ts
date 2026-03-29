/** Search index item derived from hierarchy */
export interface SearchIndexItem {
  oid: number;
  layerOid: number;
  className: string;
  address: string;
  frame: { x: number; y: number; width: number; height: number };
  isHidden: boolean;
  alpha: number;
  parentChain: string;
}

/** Cache metadata attached to tool responses */
export interface CacheMeta {
  cacheHit: boolean;
  source: 'cache' | 'live';
  stalePossible: boolean;
  elapsedMs: number;
  hint?: string;
}

interface CacheEntry<T> {
  data: T;
  storedAt: number;
  stale: boolean;
  accessed: boolean; // tracks first access for cacheHit
}

interface CacheScope {
  hierarchy: CacheEntry<any> | null;
  viewDetails: Map<number, CacheEntry<any>>;
  searchIndex: SearchIndexItem[] | null;
}

/** Slow-operation threshold in milliseconds */
const SLOW_THRESHOLD_MS = 3000;

/** Default TTL for cache entries */
const DEFAULT_TTL_MS = 30_000;

/** Default max number of cached view details */
const DEFAULT_MAX_VIEW_DETAILS = 500;

/**
 * In-memory cache for hierarchy, view details, and search index.
 * Shared across tool invocations within the MCP server process.
 *
 * Entries expire after `ttlMs` (default 30s). Expired entries are
 * treated as cache misses, causing tools to fetch live data and
 * re-populate the cache transparently.
 */
export class CacheManager {
  private scopes = new Map<string, CacheScope>();
  private activeScopeByEndpoint = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly maxViewDetails: number;

  // Compatibility accessors for existing tests that inspect the default scope.
  private get hierarchy(): CacheEntry<any> | null {
    return this.getScope('global').hierarchy;
  }

  private get viewDetails(): Map<number, CacheEntry<any>> {
    return this.getScope('global').viewDetails;
  }

  private get searchIndex(): SearchIndexItem[] | null {
    return this.getScope('global').searchIndex;
  }

  constructor(ttlMs: number = DEFAULT_TTL_MS, maxViewDetails: number = DEFAULT_MAX_VIEW_DETAILS) {
    this.ttlMs = ttlMs;
    this.maxViewDetails = maxViewDetails;
  }

  /** Check if a cache entry has expired */
  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.storedAt > this.ttlMs;
  }

  private getScope(scopeKey = 'global'): CacheScope {
    let scope = this.scopes.get(scopeKey);
    if (!scope) {
      scope = {
        hierarchy: null,
        viewDetails: new Map<number, CacheEntry<any>>(),
        searchIndex: null,
      };
      this.scopes.set(scopeKey, scope);
    }
    return scope;
  }

  private evictScopeIfEmpty(scopeKey: string, scope: CacheScope): void {
    if (!scope.hierarchy && scope.viewDetails.size === 0 && !scope.searchIndex) {
      this.scopes.delete(scopeKey);
    }
  }

  getScopeKeys(): string[] {
    return [...this.scopes.keys()];
  }

  setActiveScopeKey(endpointKey: string, scopeKey: string): void {
    this.activeScopeByEndpoint.set(endpointKey, scopeKey);
  }

  getActiveScopeKey(endpointKey: string): string | null {
    return this.activeScopeByEndpoint.get(endpointKey) ?? null;
  }

  // ─── Hierarchy ───

  setHierarchy(scopeKeyOrData: string | any, maybeData?: any): void {
    const scopeKey = typeof scopeKeyOrData === 'string' ? scopeKeyOrData : 'global';
    const data = typeof scopeKeyOrData === 'string' ? maybeData : scopeKeyOrData;
    const scope = this.getScope(scopeKey);
    scope.hierarchy = { data, storedAt: Date.now(), stale: false, accessed: false };
    scope.searchIndex = null;
    scope.viewDetails.clear(); // old OIDs are invalid after hierarchy refresh
  }

  getHierarchy(scopeKey = 'global'): (CacheEntry<any> & { cacheHit: boolean }) | null {
    const scope = this.getScope(scopeKey);
    if (!scope.hierarchy) return null;
    if (this.isExpired(scope.hierarchy)) {
      scope.hierarchy = null;
      scope.searchIndex = null;
      scope.viewDetails.clear();
      this.evictScopeIfEmpty(scopeKey, scope);
      return null;
    }
    const cacheHit = scope.hierarchy.accessed;
    scope.hierarchy.accessed = true;
    return { ...scope.hierarchy, cacheHit };
  }

  peekHierarchy(scopeKey = 'global'): CacheEntry<any> | null {
    const scope = this.getScope(scopeKey);
    if (!scope.hierarchy) return null;
    if (this.isExpired(scope.hierarchy)) {
      scope.hierarchy = null;
      scope.searchIndex = null;
      scope.viewDetails.clear();
      this.evictScopeIfEmpty(scopeKey, scope);
      return null;
    }
    return { ...scope.hierarchy };
  }

  markHierarchyStale(scopeKey = 'global'): void {
    const scope = this.getScope(scopeKey);
    if (scope.hierarchy) {
      scope.hierarchy.stale = true;
    }
  }

  // ─── View Details ───

  setViewDetail(scopeKeyOrOid: string | number, oidOrData: number | any, maybeData?: any): void {
    const scopeKey = typeof scopeKeyOrOid === 'string' ? scopeKeyOrOid : 'global';
    const oid = typeof scopeKeyOrOid === 'string' ? oidOrData as number : scopeKeyOrOid;
    const data = typeof scopeKeyOrOid === 'string' ? maybeData : oidOrData;
    const scope = this.getScope(scopeKey);
    scope.viewDetails.set(oid, { data, storedAt: Date.now(), stale: false, accessed: false });
    if (scope.viewDetails.size > this.maxViewDetails) {
      // Evict oldest entry (Map iteration order = insertion order)
      const oldest = scope.viewDetails.keys().next().value;
      if (oldest !== undefined) scope.viewDetails.delete(oldest);
    }
  }

  getViewDetail(scopeKeyOrOid: string | number, maybeOid?: number): (CacheEntry<any> & { cacheHit: boolean }) | null {
    const scopeKey = typeof scopeKeyOrOid === 'string' ? scopeKeyOrOid : 'global';
    const oid = typeof scopeKeyOrOid === 'string' ? maybeOid! : scopeKeyOrOid;
    const scope = this.getScope(scopeKey);
    const entry = scope.viewDetails.get(oid);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      scope.viewDetails.delete(oid);
      this.evictScopeIfEmpty(scopeKey, scope);
      return null;
    }
    const cacheHit = entry.accessed;
    entry.accessed = true;
    return { ...entry, cacheHit };
  }

  peekViewDetail(scopeKeyOrOid: string | number, maybeOid?: number): CacheEntry<any> | null {
    const scopeKey = typeof scopeKeyOrOid === 'string' ? scopeKeyOrOid : 'global';
    const oid = typeof scopeKeyOrOid === 'string' ? maybeOid! : scopeKeyOrOid;
    const scope = this.getScope(scopeKey);
    const entry = scope.viewDetails.get(oid);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      scope.viewDetails.delete(oid);
      this.evictScopeIfEmpty(scopeKey, scope);
      return null;
    }
    return { ...entry };
  }

  invalidateViewDetail(scopeKeyOrOid: string | number, maybeOid?: number): void {
    const scopeKey = typeof scopeKeyOrOid === 'string' ? scopeKeyOrOid : 'global';
    const oid = typeof scopeKeyOrOid === 'string' ? maybeOid! : scopeKeyOrOid;
    const scope = this.getScope(scopeKey);
    scope.viewDetails.delete(oid);
    this.evictScopeIfEmpty(scopeKey, scope);
  }

  // ─── Search Index (derived from hierarchy) ───

  getSearchIndex(scopeKey = 'global'): SearchIndexItem[] | null {
    const scope = this.getScope(scopeKey);
    if (!scope.hierarchy) return null;
    if (this.isExpired(scope.hierarchy)) {
      scope.hierarchy = null;
      scope.searchIndex = null;
      scope.viewDetails.clear();
      this.evictScopeIfEmpty(scopeKey, scope);
      return null;
    }
    if (scope.searchIndex) return scope.searchIndex;
    scope.searchIndex = buildSearchIndex(scope.hierarchy.data.displayItems ?? []);
    return scope.searchIndex;
  }

  // ─── Clear ───

  clear(scopeKey?: string): void {
    if (scopeKey) {
      this.scopes.delete(scopeKey);
      for (const [endpointKey, activeScopeKey] of this.activeScopeByEndpoint.entries()) {
        if (activeScopeKey === scopeKey) {
          this.activeScopeByEndpoint.delete(endpointKey);
        }
      }
      return;
    }
    this.scopes.clear();
    this.activeScopeByEndpoint.clear();
  }

  // ─── Cache Meta Builder ───

  static buildMeta(opts: {
    cacheHit: boolean;
    source: 'cache' | 'live';
    stalePossible: boolean;
    elapsedMs: number;
  }): CacheMeta {
    const meta: CacheMeta = {
      cacheHit: opts.cacheHit,
      source: opts.source,
      stalePossible: opts.stalePossible,
      elapsedMs: opts.elapsedMs,
    };
    if (!opts.cacheHit && opts.source === 'live' && opts.elapsedMs > SLOW_THRESHOLD_MS) {
      meta.hint = `Live fetch was slow (${opts.elapsedMs}ms). Subsequent reads will use cache. Use reload to force refresh.`;
    }
    return meta;
  }
}

/** Flatten hierarchy tree into search index items */
function buildSearchIndex(
  items: any[],
  parentChain: string[] = [],
): SearchIndexItem[] {
  const result: SearchIndexItem[] = [];
  for (const item of items) {
    const viewObj = item.viewObject ?? item.layerObject;
    const className = viewObj?.classChainList?.[0] ?? 'Unknown';
    const oid = viewObj?.oid ?? 0;
    const layerOid = item.layerObject?.oid ?? oid;

    result.push({
      oid,
      layerOid,
      className,
      address: viewObj?.memoryAddress ?? '',
      frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
      isHidden: item.isHidden ?? false,
      alpha: item.alpha ?? 0,
      parentChain: parentChain.join(' > '),
    });

    if (item.subitems && item.subitems.length > 0) {
      result.push(...buildSearchIndex(item.subitems, [...parentChain, className]));
    }
  }
  return result;
}
