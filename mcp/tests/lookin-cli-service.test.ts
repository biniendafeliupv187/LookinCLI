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

import { AppSession } from '../src/core/app-session.js';
import { LookinCliService } from '../src/core/lookin-cli-service.js';
import { LookinError } from '../src/core/errors.js';
import { CacheManager } from '../src/core/cache.js';

const AppSessionMock = vi.mocked(AppSession);

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

  it('rejects layer modification when the provided id matches a view oid instead of a layerOid', async () => {
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
      service.modifyView({ oid: 42, attribute: 'hidden', value: true }),
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

  it('uses setHidden: for layer hidden mutations', async () => {
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

    await service.modifyView({
      oid: 414,
      attribute: 'hidden',
      value: true,
    });

    expect(bridge.encode).toHaveBeenCalledOnce();
    expect(bridge.encode).toHaveBeenCalledWith(
      expect.objectContaining({
          $class: 'LookinConnectionAttachment',
          data: expect.objectContaining({
            $class: 'LookinAttributeModification',
            targetOid: 414,
            setterSelector: 'setHidden:',
            attrType: 14,
            value: true,
        }),
      }),
    );
  });

  it('surfaces remote modification errors instead of returning an empty success payload', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) {
        return HIERARCHY_BUFFER;
      }
      if (type === 204) {
        return MODIFY_BUFFER;
      }
      throw new Error(`Unexpected request type ${type}`);
    });

    const bridge = {
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
            error: {
              domain: 'LookinError',
              code: -500,
              description: 'Failed to get target object in iOS app',
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

    await expect(
      service.modifyView({ oid: 414, attribute: 'hidden', value: true }),
    ).rejects.toMatchObject({
      code: 'PROTOCOL_REMOTE_ERROR',
      message: expect.stringContaining('Failed to get target object in iOS app'),
      details: expect.objectContaining({
        domain: 'LookinError',
        remoteCode: -500,
      }),
    });
  });
});

// ─── modifyView response should include userCustomTitle in attributesGroupList ───

const MODIFY_WITH_TITLE_BUFFER = Buffer.from('modify-with-title');

describe('LookinCliService.modifyView — userCustomTitle in response', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
  });

  it('includes userCustomTitle in updatedDetail.attributesGroupList', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 204) return MODIFY_WITH_TITLE_BUFFER;
      throw new Error(`Unexpected request type ${type}`);
    });

    const bridge = {
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
                    oid: 42,
                  },
                  viewObject: {
                    $class: 'LookinObject',
                    classChainList: ['UILabel'],
                    oid: 41,
                  },
                },
              ],
            },
          };
        }
        if (base64 === MODIFY_WITH_TITLE_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: {
              frameValue: null,
              boundsValue: null,
              hiddenValue: true,
              alphaValue: 1,
              attributesGroupList: [
                {
                  identifier: 'lb',
                  userCustomTitle: 'My Custom Label',
                  attrSections: [
                    {
                      identifier: 'lb_t',
                      attributes: [{ identifier: 'lb_t_t', value: 'hello', attrType: 24 }],
                    },
                  ],
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

    const result = await service.modifyView({
      oid: 42,
      attribute: 'hidden',
      value: true,
    }) as any;

    expect(result.updatedDetail.attributesGroupList).toHaveLength(1);
    const group = result.updatedDetail.attributesGroupList[0];
    expect(group.userCustomTitle).toBe('My Custom Label');
    expect(group.identifier).toBe('lb');
    expect(group.sections).toHaveLength(1);
  });
});

describe('LookinCliService scoped cache routing', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
  });

  it('routes getView cache writes to the active scope for the current endpoint', async () => {
    const cache = new CacheManager();
    const endpoint = { host: '127.0.0.1', port: 47175, transport: 'simulator' as const };
    const endpointCacheKey = 'simulator:127.0.0.1:47175';
    const scopeA = 'com.test.a::iPhone A::A';
    const scopeB = 'com.test.b::iPhone B::B';

    cache.setHierarchy(scopeA, {
      $class: 'LookinHierarchyInfo',
      appInfo: {
        appName: 'App A',
        appBundleIdentifier: 'com.test.a',
        deviceDescription: 'iPhone A',
      },
      displayItems: [{ viewObject: { oid: 111, classChainList: ['UILabel'] } }],
    });
    cache.setHierarchy(scopeB, {
      $class: 'LookinHierarchyInfo',
      appInfo: {
        appName: 'App B',
        appBundleIdentifier: 'com.test.b',
        deviceDescription: 'iPhone B',
      },
      displayItems: [{ viewObject: { oid: 222, classChainList: ['UILabel'] } }],
    });
    (cache as any).setActiveScopeKey(endpointCacheKey, scopeB);

    requestMock.mockImplementation(async (type: number) => {
      if (type === 210) {
        return MODIFY_BUFFER;
      }
      throw new Error(`Unexpected request type ${type}`);
    });

    const bridge = {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded-request').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === MODIFY_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: [],
          };
        }
        throw new Error(`Unexpected decode payload: ${base64}`);
      }),
    };

    const service = new LookinCliService({
      fixedEndpoint: endpoint,
      cache,
      bridgeClient: bridge as any,
    });

    await service.getView(222);

    expect(cache.getViewDetail(scopeA, 222)).toBeNull();
    expect(cache.getViewDetail(scopeB, 222)).not.toBeNull();
  });

  it('reuses the resolved endpoint when cached getView data is available', async () => {
    const cache = new CacheManager();
    const endpoint = { host: '127.0.0.1', port: 47175, transport: 'usb' as const, deviceID: 2 };
    const endpointCacheKey = 'usb:127.0.0.1:47175';
    const scope = 'com.test.cached::iPhone::cached';
    const discovery = {
      probeFirst: vi.fn().mockResolvedValue(endpoint),
    };

    cache.setHierarchy(scope, {
      $class: 'LookinHierarchyInfo',
      appInfo: {
        appName: 'Cached App',
        appBundleIdentifier: 'com.test.cached',
        deviceDescription: 'iPhone',
      },
      displayItems: [
        {
          layerObject: { oid: 222, classChainList: ['CALayer'] },
          viewObject: {
            oid: 333,
            classChainList: ['UILabel'],
            memoryAddress: '0xabcdef',
          },
          frame: { x: 0, y: 0, width: 10, height: 10 },
          isHidden: false,
          alpha: 1,
        },
      ],
    });
    cache.setActiveScopeKey(endpointCacheKey, scope);
    cache.setViewDetail(scope, 222, { oid: 222, attrGroups: [] });

    const service = new LookinCliService({
      cache,
      discovery: discovery as any,
      bridgeClient: createBridgeStub() as any,
    });

    const result = await service.getView(222) as any;

    expect(result.viewMemoryAddress).toBe('0xabcdef');
    expect(result._meta.cacheHit).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
    expect(discovery.probeFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to active-scope cached app info when ping fails', async () => {
    const cache = new CacheManager();
    const endpoint = { host: '127.0.0.1', port: 47175, transport: 'simulator' as const };
    const endpointCacheKey = 'simulator:127.0.0.1:47175';
    const scopeB = 'com.test.b::iPhone B::B';

    cache.setHierarchy(scopeB, {
      $class: 'LookinHierarchyInfo',
      appInfo: {
        appName: 'Cached App B',
        appBundleIdentifier: 'com.test.b',
        deviceDescription: 'iPhone B',
        osDescription: 'iOS 18.2',
        osMainVersion: 18,
        deviceType: 1,
        serverVersion: 7,
        serverReadableVersion: '7.0',
        screenWidth: 430,
        screenHeight: 932,
        screenScale: 3,
      },
      displayItems: [],
    });
    cache.setActiveScopeKey(endpointCacheKey, scopeB);

    AppSessionMock.mockImplementationOnce(() => ({
      ping: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:47175')),
      request: requestMock,
      close: closeMock,
    }) as any);

    const service = new LookinCliService({
      fixedEndpoint: endpoint,
      cache,
      bridgeClient: createBridgeStub() as any,
    });

    const result = await service.getAppInfo();

    expect(result.appName).toBe('Cached App B');
    expect(result.bundleIdentifier).toBe('com.test.b');
    expect(result._meta).toMatchObject({
      cacheHit: true,
      source: 'cache',
    });
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

// ─── Session reuse: fetchTextMatches should open only ONE session for all getView calls ───

const SESSION_REUSE_HIER_BUFFER = Buffer.from('session-reuse-hier');
const SESSION_REUSE_VIEW_BUFFER = Buffer.from('session-reuse-view');

describe('LookinCliService.search text — session reuse', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    AppSessionMock.mockClear();
  });

  it('opens only 2 AppSessions for text search with 10 candidates (1 hierarchy + 1 for all getView calls)', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      $class: 'LookinDisplayItem',
      viewObject: { $class: 'LookinObject', classChainList: ['UILabel'], oid: 500 + i },
      layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 600 + i },
      frame: { x: 0, y: i * 10, width: 200, height: 40 },
      isHidden: false,
      alpha: 1,
    }));

    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return SESSION_REUSE_HIER_BUFFER;
      if (type === 210) return SESSION_REUSE_VIEW_BUFFER;
      throw new Error(`Unexpected request type ${type}`);
    });

    const bridge = {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded-request').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === SESSION_REUSE_HIER_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: { $class: 'LookinHierarchyInfo', displayItems: items },
          };
        }
        if (base64 === SESSION_REUSE_VIEW_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: [
              {
                identifier: 'lb',
                attrSections: [
                  {
                    identifier: 'lb_t',
                    attributes: [{ identifier: 'lb_t_t', value: '匹配文字', attrType: 24 }],
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

    const result = await service.search('UILabel', '匹配文字') as any;

    // All 10 candidates should match (all have text '匹配文字')
    expect(result.results).toHaveLength(10);

    // KEY ASSERTION: only 2 AppSession instances created —
    // 1 for fetchHierarchyInfo, 1 shared session for all 10 getView calls
    expect(AppSessionMock).toHaveBeenCalledTimes(2);

    // close() should also be called exactly 2 times
    expect(closeMock).toHaveBeenCalledTimes(2);

    // request type 210 (AllAttrGroups) should be called 10 times on the shared session
    const attrGroupCalls = requestMock.mock.calls.filter((c: any[]) => c[0] === 210);
    expect(attrGroupCalls).toHaveLength(10);
  });
});
