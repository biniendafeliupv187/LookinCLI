import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager } from '../src/core/cache.js';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
  });

  // ─── 10.1: hierarchy cache stores and retrieves ───

  describe('hierarchy cache', () => {
    const hierarchyData = {
      $class: 'LookinHierarchyInfo',
      appInfo: { appName: 'TestApp' },
      displayItems: [{ oid: 1, className: 'UIWindow' }],
    };

    it('returns null on cache miss', () => {
      const entry = cache.getHierarchy();
      expect(entry).toBeNull();
    });

    it('stores and retrieves hierarchy', () => {
      cache.setHierarchy(hierarchyData);
      const entry = cache.getHierarchy();
      expect(entry).not.toBeNull();
      expect(entry!.data).toBe(hierarchyData);
    });

    it('returns cacheHit=true on second access', () => {
      cache.setHierarchy(hierarchyData);
      cache.getHierarchy(); // first access
      const entry = cache.getHierarchy();
      expect(entry!.cacheHit).toBe(true);
    });

    it('clear removes hierarchy', () => {
      cache.setHierarchy(hierarchyData);
      cache.clear();
      expect(cache.getHierarchy()).toBeNull();
    });

    it('keeps hierarchies isolated across scope keys', () => {
      cache.setHierarchy('scope-a', hierarchyData);
      cache.setHierarchy('scope-b', { ...hierarchyData, appInfo: { appName: 'OtherApp' } });

      expect(cache.getHierarchy('scope-a')?.data.appInfo.appName).toBe('TestApp');
      expect(cache.getHierarchy('scope-b')?.data.appInfo.appName).toBe('OtherApp');
      expect(cache.getHierarchy('scope-c')).toBeNull();
    });
  });

  // ─── 10.1: view detail cache stores by oid ───

  describe('view detail cache (by oid)', () => {
    const viewData = { oid: 42, attrGroups: [{ identifier: 'Class' }] };

    it('returns null for uncached oid', () => {
      expect(cache.getViewDetail(42)).toBeNull();
    });

    it('stores and retrieves by oid', () => {
      cache.setViewDetail(42, viewData);
      const entry = cache.getViewDetail(42);
      expect(entry).not.toBeNull();
      expect(entry!.data.oid).toBe(42);
    });

    it('different oids are independent', () => {
      cache.setViewDetail(42, viewData);
      expect(cache.getViewDetail(99)).toBeNull();
    });

    it('invalidateViewDetail removes only that oid', () => {
      cache.setViewDetail(42, viewData);
      cache.setViewDetail(99, { oid: 99, attrGroups: [] });
      cache.invalidateViewDetail(42);
      expect(cache.getViewDetail(42)).toBeNull();
      expect(cache.getViewDetail(99)).not.toBeNull();
    });

    it('clear removes all view details', () => {
      cache.setViewDetail(42, viewData);
      cache.setViewDetail(99, { oid: 99, attrGroups: [] });
      cache.clear();
      expect(cache.getViewDetail(42)).toBeNull();
      expect(cache.getViewDetail(99)).toBeNull();
    });

    it('isolates view detail cache by scope key', () => {
      cache.setViewDetail('scope-a', 42, viewData);
      cache.setViewDetail('scope-b', 42, { oid: 42, attrGroups: [{ identifier: 'Other' }] });

      expect(cache.getViewDetail('scope-a', 42)?.data.attrGroups[0].identifier).toBe('Class');
      expect(cache.getViewDetail('scope-b', 42)?.data.attrGroups[0].identifier).toBe('Other');
      expect(cache.getViewDetail('scope-c', 42)).toBeNull();
    });
  });

  // ─── 10.1: search index derived from hierarchy ───

  describe('search index', () => {
    const hierarchyData = {
      $class: 'LookinHierarchyInfo',
      appInfo: { appName: 'TestApp' },
      displayItems: [
        {
          viewObject: { oid: 1, classChainList: ['UIWindow'] },
          layerObject: { oid: 10 },
          frame: { x: 0, y: 0, width: 390, height: 844 },
          isHidden: false,
          alpha: 1,
          subitems: [
            {
              viewObject: { oid: 2, classChainList: ['UILabel'], memoryAddress: '0x1234' },
              layerObject: { oid: 20 },
              frame: { x: 10, y: 10, width: 100, height: 30 },
              isHidden: false,
              alpha: 1,
              subitems: [],
            },
          ],
        },
      ],
    };

    it('returns null when no hierarchy cached', () => {
      expect(cache.getSearchIndex()).toBeNull();
    });

    it('builds and returns search index from hierarchy', () => {
      cache.setHierarchy(hierarchyData);
      const index = cache.getSearchIndex();
      expect(index).not.toBeNull();
      expect(index!.length).toBe(2); // UIWindow + UILabel
    });

    it('search index items contain className and parentChain', () => {
      cache.setHierarchy(hierarchyData);
      const index = cache.getSearchIndex()!;
      const label = index.find((i) => i.className === 'UILabel');
      expect(label).toBeDefined();
      expect(label!.parentChain).toContain('UIWindow');
    });

    it('search index is cached after first build', () => {
      cache.setHierarchy(hierarchyData);
      const idx1 = cache.getSearchIndex();
      const idx2 = cache.getSearchIndex();
      expect(idx1).toBe(idx2); // same reference (not rebuilt)
    });

    it('search index is invalidated when hierarchy is updated', () => {
      cache.setHierarchy(hierarchyData);
      const idx1 = cache.getSearchIndex();
      cache.setHierarchy(hierarchyData); // re-set
      const idx2 = cache.getSearchIndex();
      expect(idx1).not.toBe(idx2); // rebuilt
    });

    it('isolates search index by scope key', () => {
      cache.setHierarchy('scope-a', hierarchyData);
      cache.setHierarchy('scope-b', {
        ...hierarchyData,
        displayItems: [],
      });

      expect(cache.getSearchIndex('scope-a')).toHaveLength(2);
      expect(cache.getSearchIndex('scope-b')).toHaveLength(0);
    });
  });

  // ─── 10.1: markHierarchyStale ───

  describe('stale marking', () => {
    const hierarchyData = {
      $class: 'LookinHierarchyInfo',
      appInfo: { appName: 'TestApp' },
      displayItems: [],
    };

    it('marks hierarchy as stale (stalePossible=true)', () => {
      cache.setHierarchy(hierarchyData);
      cache.markHierarchyStale();
      const entry = cache.getHierarchy();
      expect(entry).not.toBeNull();
      expect(entry!.stale).toBe(true);
    });

    it('marks only the targeted scope as stale', () => {
      cache.setHierarchy('scope-a', hierarchyData);
      cache.setHierarchy('scope-b', hierarchyData);

      cache.markHierarchyStale('scope-a');

      expect(cache.getHierarchy('scope-a')?.stale).toBe(true);
      expect(cache.getHierarchy('scope-b')?.stale).toBe(false);
    });
  });

  // ─── 10.3: cache metadata ───

  describe('cache metadata', () => {
    const hierarchyData = {
      $class: 'LookinHierarchyInfo',
      displayItems: [],
    };

    it('getHierarchy entry has timestamp', () => {
      const before = Date.now();
      cache.setHierarchy(hierarchyData);
      const entry = cache.getHierarchy()!;
      expect(entry.storedAt).toBeGreaterThanOrEqual(before);
      expect(entry.storedAt).toBeLessThanOrEqual(Date.now());
    });

    it('getViewDetail entry has timestamp', () => {
      cache.setViewDetail(42, { oid: 42 });
      const entry = cache.getViewDetail(42)!;
      expect(entry.storedAt).toBeLessThanOrEqual(Date.now());
    });

    it('first get returns cacheHit=false, subsequent returns cacheHit=true', () => {
      cache.setHierarchy(hierarchyData);
      const first = cache.getHierarchy()!;
      expect(first.cacheHit).toBe(false);
      const second = cache.getHierarchy()!;
      expect(second.cacheHit).toBe(true);
    });
  });

  // ─── 10.5: slow-operation hint ───

  describe('slow-operation hint', () => {
    it('buildMeta with elapsedMs below threshold has no hint', () => {
      const meta = CacheManager.buildMeta({
        cacheHit: false,
        source: 'live',
        stalePossible: false,
        elapsedMs: 500,
      });
      expect(meta.hint).toBeUndefined();
    });

    it('buildMeta with elapsedMs above threshold includes hint', () => {
      const meta = CacheManager.buildMeta({
        cacheHit: false,
        source: 'live',
        stalePossible: false,
        elapsedMs: 3500,
      });
      expect(meta.hint).toBeDefined();
      expect(meta.hint).toContain('slow');
    });

    it('buildMeta from cache never has slow hint even with high elapsedMs', () => {
      const meta = CacheManager.buildMeta({
        cacheHit: true,
        source: 'cache',
        stalePossible: false,
        elapsedMs: 5000,
      });
      expect(meta.hint).toBeUndefined();
    });

    it('meta contains all required fields', () => {
      const meta = CacheManager.buildMeta({
        cacheHit: true,
        source: 'cache',
        stalePossible: true,
        elapsedMs: 10,
      });
      expect(meta).toHaveProperty('cacheHit', true);
      expect(meta).toHaveProperty('source', 'cache');
      expect(meta).toHaveProperty('stalePossible', true);
      expect(meta).toHaveProperty('elapsedMs', 10);
    });
  });

  // ─── viewDetails cleared on hierarchy refresh ───

  describe('viewDetails cleared on setHierarchy', () => {
    it('clears all viewDetails when hierarchy is refreshed', () => {
      cache.setViewDetail(42, { oid: 42 });
      cache.setViewDetail(99, { oid: 99 });
      expect(cache.getViewDetail(42)).not.toBeNull();

      cache.setHierarchy({ $class: 'LookinHierarchyInfo', displayItems: [] });

      expect(cache.getViewDetail(42)).toBeNull();
      expect(cache.getViewDetail(99)).toBeNull();
    });
  });

  // ─── viewDetails max-size cap ───

  describe('viewDetails max-size cap', () => {
    it('evicts oldest entries when exceeding max size', () => {
      const smallCache = new CacheManager(30_000, 5);

      // Add 5 entries (fills up)
      for (let i = 1; i <= 5; i++) {
        smallCache.setViewDetail(i, { oid: i });
      }
      expect(smallCache.getViewDetail(1)).not.toBeNull();

      // Add a 6th — oldest (oid=1) should be evicted
      smallCache.setViewDetail(6, { oid: 6 });
      expect(smallCache.getViewDetail(1)).toBeNull();
      expect(smallCache.getViewDetail(6)).not.toBeNull();
    });

    it('does not evict when under max size', () => {
      const smallCache = new CacheManager(30_000, 5);
      for (let i = 1; i <= 5; i++) {
        smallCache.setViewDetail(i, { oid: i });
      }
      // All 5 should still be present
      for (let i = 1; i <= 5; i++) {
        expect(smallCache.getViewDetail(i)).not.toBeNull();
      }
    });
  });

  // ─── TTL auto-expiry ───

  describe('TTL auto-expiry', () => {
    const hierarchyData = {
      $class: 'LookinHierarchyInfo',
      appInfo: { appName: 'TestApp' },
      displayItems: [{ oid: 1, className: 'UIWindow' }],
    };

    it('hierarchy is returned within TTL', () => {
      const shortCache = new CacheManager(60_000);
      shortCache.setHierarchy(hierarchyData);
      expect(shortCache.getHierarchy()).not.toBeNull();
    });

    it('hierarchy returns null after TTL expires', () => {
      const shortCache = new CacheManager(50); // 50ms TTL
      shortCache.setHierarchy(hierarchyData);
      // Manually backdate storedAt to simulate expiry
      (shortCache as any).hierarchy.storedAt = Date.now() - 100;
      expect(shortCache.getHierarchy()).toBeNull();
    });

    it('viewDetail returns null after TTL expires', () => {
      const shortCache = new CacheManager(50);
      shortCache.setViewDetail(42, { oid: 42 });
      (shortCache as any).viewDetails.get(42).storedAt = Date.now() - 100;
      expect(shortCache.getViewDetail(42)).toBeNull();
    });

    it('expired viewDetail is removed from map', () => {
      const shortCache = new CacheManager(50);
      shortCache.setViewDetail(42, { oid: 42 });
      (shortCache as any).viewDetails.get(42).storedAt = Date.now() - 100;
      shortCache.getViewDetail(42); // triggers eviction
      expect((shortCache as any).viewDetails.has(42)).toBe(false);
    });

    it('searchIndex returns null after hierarchy TTL expires', () => {
      const shortCache = new CacheManager(50);
      shortCache.setHierarchy(hierarchyData);
      shortCache.getSearchIndex(); // build index
      (shortCache as any).hierarchy.storedAt = Date.now() - 100;
      expect(shortCache.getSearchIndex()).toBeNull();
    });

    it('expired hierarchy also clears searchIndex', () => {
      const shortCache = new CacheManager(50);
      shortCache.setHierarchy(hierarchyData);
      shortCache.getSearchIndex(); // build index
      (shortCache as any).hierarchy.storedAt = Date.now() - 100;
      shortCache.getHierarchy(); // triggers eviction
      expect((shortCache as any).searchIndex).toBeNull();
    });

    it('custom TTL is respected', () => {
      const longCache = new CacheManager(999_999);
      longCache.setHierarchy(hierarchyData);
      // Even after 30s, still valid with long TTL
      (longCache as any).hierarchy.storedAt = Date.now() - 50_000;
      expect(longCache.getHierarchy()).not.toBeNull();
    });

    it('default TTL is 30 seconds', () => {
      const defaultCache = new CacheManager();
      defaultCache.setHierarchy(hierarchyData);
      // 29s: still valid
      (defaultCache as any).hierarchy.storedAt = Date.now() - 29_000;
      expect(defaultCache.getHierarchy()).not.toBeNull();
      // 31s: expired
      (defaultCache as any).hierarchy.storedAt = Date.now() - 31_000;
      expect(defaultCache.getHierarchy()).toBeNull();
    });
  });
});
