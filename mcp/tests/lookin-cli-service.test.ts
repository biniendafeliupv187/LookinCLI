import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock, closeMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  closeMock: vi.fn(),
}));

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Ping: 200,
    App: 201,
    Hierarchy: 202,
    HierarchyDetails: 203,
    InbuiltAttrModification: 204,
    AttrModificationPatch: 205,
    InvokeMethod: 206,
    FetchObject: 207,
    FetchImageViewImage: 208,
    ModifyRecognizerEnable: 209,
    AllAttrGroups: 210,
    AllSelectorNames: 213,
    CustomAttrModification: 214,
  },
  AppSession: vi.fn().mockImplementation(() => ({
    request: requestMock,
    close: closeMock,
  })),
}));

import { LookinCliService } from '../src/core/lookin-cli-service.js';
import { LookinError } from '../src/core/errors.js';
import { CacheManager } from '../src/core/cache.js';

const HIERARCHY_BUFFER = Buffer.from('hierarchy-response');
const MODIFY_BUFFER = Buffer.from('modify-response');

function createBridgeStub() {
  return {
    encode: vi.fn().mockResolvedValue(Buffer.from('encoded-request').toString('base64')),
    decode: vi.fn().mockImplementation(async (base64: string) => {
      if (base64 === HIERARCHY_BUFFER.toString('base64')) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: {
            $class: 'LookinHierarchyInfo',
            displayItems: [
              {
                $class: 'LookinDisplayItem',
                layerObject: {
                  $class: 'LookinObject',
                  classChainList: ['CALayer'],
                  oid: 414,
                },
                viewObject: {
                  $class: 'LookinObject',
                  classChainList: ['UILabel'],
                  oid: 42,
                },
              },
            ],
          },
        };
      }

      if (base64 === MODIFY_BUFFER.toString('base64')) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: {
            frameValue: null,
            boundsValue: null,
            hiddenValue: false,
            alphaValue: 1,
            attributesGroupList: [],
          },
        };
      }

      throw new Error(`Unexpected decode payload: ${base64}`);
    }),
  };
}

describe('LookinCliService.modifyView target validation', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
  });

  it('rejects text modification when the provided id matches a layerOid instead of a view oid', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) {
        return HIERARCHY_BUFFER;
      }
      if (type === 204) {
        return MODIFY_BUFFER;
      }
      throw new Error(`Unexpected request type ${type}`);
    });

    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createBridgeStub() as any,
    });

    await expect(
      service.modifyView({ oid: 414, attribute: 'text', value: 'hello' }),
    ).rejects.toMatchObject<Partial<LookinError>>({
      code: 'VALIDATION_INVALID_TARGET',
      message: expect.stringContaining('layerOid'),
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(202, undefined, 15000);
  });

  it('allows text modification when the provided id matches the view oid', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) {
        return HIERARCHY_BUFFER;
      }
      if (type === 204) {
        return MODIFY_BUFFER;
      }
      throw new Error(`Unexpected request type ${type}`);
    });

    const bridge = createBridgeStub();
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });

    const result = await service.modifyView({
      oid: 42,
      attribute: 'text',
      value: 'hello',
    });

    expect(result.attribute).toBe('text');
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenNthCalledWith(1, 202, undefined, 15000);
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      204,
      Buffer.from('encoded-request'),
      10000,
    );
    expect(bridge.encode).toHaveBeenCalledOnce();
  });
});

// ─── Fix 1: extractTextFromAttrGroups misses non-label groups ───

const HIERARCHY_WITH_BUTTON_BUFFER = Buffer.from('hierarchy-with-button');
const BUTTON_ATTR_GROUPS_BUFFER = Buffer.from('button-attr-groups');

describe('LookinCliService.search text — extractTextFromAttrGroups', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
  });

  it('finds UIButton text via bt_t_t attribute in the bt group', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_WITH_BUTTON_BUFFER;
      if (type === 210) return BUTTON_ATTR_GROUPS_BUFFER;
      throw new Error(`Unexpected request type ${type}`);
    });

    const bridge = {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded-request').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === HIERARCHY_WITH_BUTTON_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: {
              $class: 'LookinHierarchyInfo',
              displayItems: [
                {
                  $class: 'LookinDisplayItem',
                  viewObject: { $class: 'LookinObject', classChainList: ['UIButton'], oid: 99 },
                  layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 100 },
                  frame: { x: 0, y: 0, width: 100, height: 44 },
                  isHidden: false,
                  alpha: 1,
                },
              ],
            },
          };
        }
        if (base64 === BUTTON_ATTR_GROUPS_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: [
              {
                identifier: 'bt',
                attrSections: [
                  {
                    identifier: 'bt_t',
                    attributes: [{ identifier: 'bt_t_t', value: '推荐歌单', attrType: 24 }],
                  },
                ],
              },
            ],
          };
        }
        throw new Error(`Unexpected decode payload: ${base64}`);
      }),
    };

    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });

    const result = await service.search('UIButton', '推荐歌单') as any;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].oid).toBe(99);
    expect(result.results[0].text).toBe('推荐歌单');
  });
});

// ─── Fix 2: Skip getView when oid === 0 ───

const HIERARCHY_NO_OID_BUFFER = Buffer.from('hierarchy-no-oid');

describe('LookinCliService.search text — oid=0 guard', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
  });

  it('does not call getView (type 210) for hierarchy items with no oid (fallback to 0)', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_NO_OID_BUFFER;
      throw new Error(`Unexpected request type ${type} — getView must not be called for oid=0`);
    });

    const bridge = {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded-request').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === HIERARCHY_NO_OID_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: {
              $class: 'LookinHierarchyInfo',
              displayItems: [
                {
                  $class: 'LookinDisplayItem',
                  viewObject: {
                    $class: 'LookinObject',
                    classChainList: ['UILabel'],
                    // oid intentionally omitted → defaults to 0
                  },
                  layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 500 },
                  frame: { x: 0, y: 0, width: 200, height: 40 },
                  isHidden: false,
                  alpha: 1,
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected decode payload: ${base64}`);
      }),
    };

    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });

    const result = await service.search('UILabel', 'anything') as any;

    // getView should never be called for oid=0
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(202, undefined, 15000);
    expect(result.results).toHaveLength(0);
  });
});

// ─── Fix 5: Performance warning for text-only search ───

const LARGE_HIERARCHY_BUFFER = Buffer.from('large-hierarchy');
const EMPTY_VIEW_BUFFER = Buffer.from('empty-view');

describe('LookinCliService.search text — performance guard', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
  });

  it('adds a hint to _meta when text-only search (no query) has more than 50 candidates', async () => {
    const manyItems = Array.from({ length: 60 }, (_, i) => ({
      $class: 'LookinDisplayItem',
      viewObject: { $class: 'LookinObject', classChainList: ['UILabel'], oid: 1000 + i },
      layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 2000 + i },
      frame: { x: 0, y: i * 10, width: 200, height: 40 },
      isHidden: false,
      alpha: 1,
    }));

    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return LARGE_HIERARCHY_BUFFER;
      if (type === 210) return EMPTY_VIEW_BUFFER;
      throw new Error(`Unexpected request type ${type}`);
    });

    const bridge = {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded-request').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === LARGE_HIERARCHY_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: { $class: 'LookinHierarchyInfo', displayItems: manyItems },
          };
        }
        if (base64 === EMPTY_VIEW_BUFFER.toString('base64')) {
          return { $class: 'LookinConnectionResponseAttachment', data: [] };
        }
        throw new Error(`Unexpected decode payload: ${base64}`);
      }),
    };

    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });

    // No query (undefined), text only — all 60 nodes are candidates
    const result = await service.search(undefined, 'anything') as any;

    expect(result._meta.hint).toBeDefined();
    expect(result._meta.hint).toMatch(/50|candidates|query/i);
  });
});

// ─── Fix 3: Cache metadata propagation in searchByText no-cache path ───

const HIER_META_BUFFER = Buffer.from('hier-for-meta-test');
const VIEW_META_BUFFER = Buffer.from('view-for-meta-test');

describe('LookinCliService.searchByText — cache metadata propagation', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
  });

  it('reports cacheHit:true and source:cache on second text search when hierarchy is cached', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIER_META_BUFFER;
      if (type === 210) return VIEW_META_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });

    const bridge = {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded-request').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === HIER_META_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: {
              $class: 'LookinHierarchyInfo',
              displayItems: [
                {
                  $class: 'LookinDisplayItem',
                  viewObject: { $class: 'LookinObject', classChainList: ['UILabel'], oid: 77 },
                  layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 78 },
                  frame: { x: 0, y: 0, width: 100, height: 30 },
                  isHidden: false,
                  alpha: 1,
                },
              ],
            },
          };
        }
        if (base64 === VIEW_META_BUFFER.toString('base64')) {
          return { $class: 'LookinConnectionResponseAttachment', data: [] };
        }
        throw new Error(`Unexpected decode payload: ${base64}`);
      }),
    };

    const cache = new CacheManager();
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
      cache,
    });

    // First call: hierarchy fetched live
    const first = await service.search('UILabel', 'hello') as any;
    expect(first._meta.cacheHit).toBe(false);
    expect(first._meta.source).toBe('live');

    // Reset so type 202 must NOT be called again
    requestMock.mockReset();
    requestMock.mockImplementation(async (type: number) => {
      if (type === 210) return VIEW_META_BUFFER;
      throw new Error(`type ${type} must not be called on second search — hierarchy must come from cache`);
    });

    // Second call: hierarchy should come from cache
    const second = await service.search('UILabel', 'hello') as any;
    expect(second._meta.cacheHit).toBe(true);
    expect(second._meta.source).toBe('cache');
  });
});
