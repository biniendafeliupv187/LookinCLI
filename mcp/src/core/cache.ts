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

/** Slow-operation threshold in milliseconds */
const SLOW_THRESHOLD_MS = 3000;

/** Default TTL for cache entries */
const DEFAULT_TTL_MS = 30_000;

/**
 * In-memory cache for hierarchy, view details, and search index.
 * Shared across tool invocations within the MCP server process.
 *
 * Entries expire after `ttlMs` (default 30s). Expired entries are
 * treated as cache misses, causing tools to fetch live data and
 * re-populate the cache transparently.
 */
export class CacheManager {
  private hierarchy: CacheEntry<any> | null = null;
  private viewDetails = new Map<number, CacheEntry<any>>();
  private searchIndex: SearchIndexItem[] | null = null;
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Check if a cache entry has expired */
  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.storedAt > this.ttlMs;
  }

  // ─── Hierarchy ───

  setHierarchy(data: any): void {
    this.hierarchy = { data, storedAt: Date.now(), stale: false, accessed: false };
    this.searchIndex = null; // invalidate derived search index
  }

  getHierarchy(): (CacheEntry<any> & { cacheHit: boolean }) | null {
    if (!this.hierarchy) return null;
    if (this.isExpired(this.hierarchy)) {
      // TTL expired — evict and return null so tools fetch live
      this.hierarchy = null;
      this.searchIndex = null;
      return null;
    }
    const cacheHit = this.hierarchy.accessed;
    this.hierarchy.accessed = true;
    return { ...this.hierarchy, cacheHit };
  }

  peekHierarchy(): CacheEntry<any> | null {
    if (!this.hierarchy) return null;
    if (this.isExpired(this.hierarchy)) {
      this.hierarchy = null;
      this.searchIndex = null;
      return null;
    }
    return { ...this.hierarchy };
  }

  markHierarchyStale(): void {
    if (this.hierarchy) {
      this.hierarchy.stale = true;
    }
  }

  // ─── View Details ───

  setViewDetail(oid: number, data: any): void {
    this.viewDetails.set(oid, { data, storedAt: Date.now(), stale: false, accessed: false });
  }

  getViewDetail(oid: number): (CacheEntry<any> & { cacheHit: boolean }) | null {
    const entry = this.viewDetails.get(oid);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.viewDetails.delete(oid);
      return null;
    }
    const cacheHit = entry.accessed;
    entry.accessed = true;
    return { ...entry, cacheHit };
  }

  peekViewDetail(oid: number): CacheEntry<any> | null {
    const entry = this.viewDetails.get(oid);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.viewDetails.delete(oid);
      return null;
    }
    return { ...entry };
  }

  invalidateViewDetail(oid: number): void {
    this.viewDetails.delete(oid);
  }

  // ─── Search Index (derived from hierarchy) ───

  getSearchIndex(): SearchIndexItem[] | null {
    if (!this.hierarchy) return null;
    if (this.isExpired(this.hierarchy)) {
      this.hierarchy = null;
      this.searchIndex = null;
      return null;
    }
    if (this.searchIndex) return this.searchIndex;
    this.searchIndex = buildSearchIndex(this.hierarchy.data.displayItems ?? []);
    return this.searchIndex;
  }

  // ─── Clear ───

  clear(): void {
    this.hierarchy = null;
    this.viewDetails.clear();
    this.searchIndex = null;
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
