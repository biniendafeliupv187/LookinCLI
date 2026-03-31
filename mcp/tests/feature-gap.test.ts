/**
 * TDD tests for lookincli-feature-gap change.
 * Tasks: 1.1, 1.2, 1.3, 1.4, 2.x, 3.x, 4.x, 5.x, 6.x, 7.x
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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

const HIERARCHY_BUFFER = Buffer.from('hierarchy-response');
const DETAIL_BUFFER = Buffer.from('detail-response');

function createBridgeStub(hierarchyData?: object, detailData?: object) {
  return {
    encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
    decode: vi.fn().mockImplementation(async (base64: string) => {
      if (base64 === HIERARCHY_BUFFER.toString('base64')) {
        return hierarchyData ?? defaultHierarchyData();
      }
      if (base64 === DETAIL_BUFFER.toString('base64')) {
        return detailData ?? defaultDetailData();
      }
      throw new Error(`Unexpected decode payload: ${base64}`);
    }),
  };
}

function defaultHierarchyData() {
  return {
    $class: 'LookinConnectionResponseAttachment',
    data: {
      $class: 'LookinHierarchyInfo',
      displayItems: [
        {
          $class: 'LookinDisplayItem',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          isHidden: false,
          alpha: 1,
          layerObject: {
            $class: 'LookinObject',
            classChainList: ['CALayer'],
            oid: 100,
            memoryAddress: '0xdeadbeef01',
          },
          viewObject: {
            $class: 'LookinObject',
            classChainList: ['UIWindow'],
            oid: 1,
            memoryAddress: '0xaabbccdd01',
          },
        },
        {
          $class: 'LookinDisplayItem',
          frame: { x: 10, y: 20, width: 100, height: 44 },
          isHidden: false,
          alpha: 1,
          layerObject: {
            $class: 'LookinObject',
            classChainList: ['CALayer'],
            oid: 101,
            memoryAddress: '0xdeadbeef02',
          },
          viewObject: {
            $class: 'LookinObject',
            classChainList: ['UIButton'],
            oid: 2,
            memoryAddress: '0xaabbccdd02',
            specialTrace: 'LoginViewController.view',
            ivarTraces: [
              {
                hostClassName: 'LoginViewController',
                ivarName: '_loginButton',
                relation: 'superview',
              },
            ],
          },
        },
        // layer-only node (no viewObject)
        {
          $class: 'LookinDisplayItem',
          frame: { x: 0, y: 0, width: 50, height: 50 },
          isHidden: false,
          alpha: 1,
          layerObject: {
            $class: 'LookinObject',
            classChainList: ['CAShapeLayer'],
            oid: 102,
            memoryAddress: '0xdeadbeef03',
          },
        },
      ],
    },
  };
}

function defaultDetailData() {
  return {
    $class: 'LookinConnectionResponseAttachment',
    data: {
      $class: 'LookinDisplayItemDetail',
      frameValue: { x: 10, y: 20, width: 100, height: 44 },
      boundsValue: { x: 0, y: 0, width: 100, height: 44 },
      hiddenValue: false,
      alphaValue: 1,
      attributesGroupList: [],
    },
  };
}

function makeService(hierarchyData?: object, detailData?: object) {
  return new LookinCliService({
    fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
    bridgeClient: createBridgeStub(hierarchyData, detailData) as any,
  });
}

// ─── Task 1.1: search results include viewMemoryAddress ─────────────────────

describe('Task 1.1 — search results include viewMemoryAddress', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockResolvedValue(HIERARCHY_BUFFER);
  });

  it('search result has viewMemoryAddress when viewObject has memoryAddress', async () => {
    const service = makeService();
    const result = await service.search('UIWindow') as any;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].viewMemoryAddress).toBe('0xaabbccdd01');
  });

  it('search result has null viewMemoryAddress for layer-only nodes', async () => {
    const service = makeService();
    const result = await service.search('CAShapeLayer') as any;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].viewMemoryAddress).toBeNull();
  });
});

// ─── Task 1.2: get_hierarchy JSON includes viewMemoryAddress ─────────────────

describe('Task 1.2 — get_hierarchy JSON includes viewMemoryAddress', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockResolvedValue(HIERARCHY_BUFFER);
  });

  it('JSON hierarchy node has viewMemoryAddress from viewObject', async () => {
    const service = makeService();
    const result = await service.getHierarchy({ format: 'json' });
    const nodes = (result.data as any).viewHierarchy as any[];
    const windowNode = nodes.find((n: any) => n.className === 'UIWindow');
    expect(windowNode).toBeDefined();
    expect(windowNode.viewMemoryAddress).toBe('0xaabbccdd01');
  });

  it('JSON hierarchy node has null viewMemoryAddress for layer-only node', async () => {
    const service = makeService();
    const result = await service.getHierarchy({ format: 'json' });
    const nodes = (result.data as any).viewHierarchy as any[];
    const layerNode = nodes.find((n: any) => n.className === 'CAShapeLayer');
    expect(layerNode).toBeDefined();
    expect(layerNode.viewMemoryAddress).toBeNull();
  });
});

// ─── Task 1.3: get_view includes specialTrace and ivarTraces ─────────────────

const ATTR_GROUPS_BUFFER = Buffer.from('attr-groups-response');

function createIvarBridgeStub() {
  return {
    encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
    decode: vi.fn().mockImplementation(async (base64: string) => {
      if (base64 === HIERARCHY_BUFFER.toString('base64')) {
        return defaultHierarchyData();
      }
      if (base64 === ATTR_GROUPS_BUFFER.toString('base64')) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: [],  // empty attrGroups array
        };
      }
      throw new Error(`Unexpected decode payload: ${base64}`);
    }),
  };
}

describe('Task 1.3 — get_view includes specialTrace and ivarTraces', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 210) return ATTR_GROUPS_BUFFER;  // AllAttrGroups
      throw new Error(`Unexpected type ${type}`);
    });
  });

  it('get_view returns specialTrace and ivarTraces for layerOid=101 (UIButton)', async () => {
    // layerOid=101 corresponds to viewObject UIButton with ivarTrace data
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createIvarBridgeStub() as any,
    });
    const result = await service.getView(101) as any;
    expect(result.specialTrace).toBe('LoginViewController.view');
    expect(result.ivarTraces).toHaveLength(1);
    expect(result.ivarTraces[0]).toMatchObject({
      hostClassName: 'LoginViewController',
      ivarName: '_loginButton',
      relation: 'superview',
    });
  });

  it('get_view returns null specialTrace and empty ivarTraces for layerOid=100 (UIWindow)', async () => {
    // layerOid=100 corresponds to UIWindow which has no ivar data
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createIvarBridgeStub() as any,
    });
    const result = await service.getView(100) as any;
    expect(result.specialTrace).toBeNull();
    expect(result.ivarTraces).toEqual([]);
  });
});

// ─── Task 1.4: get_hierarchy text includes ivar annotation ──────────────────

describe('Task 1.4 — get_hierarchy text output includes ivar annotation', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockResolvedValue(HIERARCHY_BUFFER);
  });

  it('text line for node with ivarTrace includes [OwnerClass._ivarName]', async () => {
    const service = makeService();
    const result = await service.getHierarchy({ format: 'text' });
    const lines = result.text!.split('\n');
    const buttonLine = lines.find((l) => l.includes('UIButton'));
    expect(buttonLine).toBeDefined();
    expect(buttonLine).toContain('[LoginViewController._loginButton]');
  });

  it('text line for node without ivarTrace has no bracket annotation', async () => {
    const service = makeService();
    const result = await service.getHierarchy({ format: 'text' });
    const lines = result.text!.split('\n');
    const windowLine = lines.find((l) => l.includes('UIWindow'));
    expect(windowLine).toBeDefined();
    expect(windowLine).not.toMatch(/\[.*\._.*\]/);
  });
});

// ─── Task 2.1–2.3: modify_view new layer attributes ─────────────────────────

describe('Task 2 — modify_view supports new layer attributes', () => {
  const MODIFY_BUFFER = Buffer.from('modify-response');

  function createModifyBridgeStub() {
    return {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === HIERARCHY_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: {
              $class: 'LookinHierarchyInfo',
              displayItems: [
                {
                  $class: 'LookinDisplayItem',
                  layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 100 },
                  viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 1 },
                },
              ],
            },
          };
        }
        if (base64 === MODIFY_BUFFER.toString('base64')) {
          return { $class: 'LookinConnectionResponseAttachment', data: {} };
        }
        throw new Error(`Unexpected: ${base64}`);
      }),
    };
  }

  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 204) return MODIFY_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
  });

  it('modify_view accepts cornerRadius with a number value', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createModifyBridgeStub() as any,
    });
    const result = await service.modifyView({ oid: 100, attribute: 'cornerRadius' as any, value: 12.0 });
    expect(result.attribute).toBe('cornerRadius');
  });

  it('modify_view accepts borderColor with an RGBA array', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createModifyBridgeStub() as any,
    });
    const result = await service.modifyView({ oid: 100, attribute: 'borderColor' as any, value: [0, 0, 0, 1] });
    expect(result.attribute).toBe('borderColor');
  });

  it('modify_view accepts masksToBounds with a boolean', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createModifyBridgeStub() as any,
    });
    const result = await service.modifyView({ oid: 100, attribute: 'masksToBounds' as any, value: true });
    expect(result.attribute).toBe('masksToBounds');
  });

  it('modify_view rejects non-number value for cornerRadius', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createModifyBridgeStub() as any,
    });
    await expect(
      service.modifyView({ oid: 100, attribute: 'cornerRadius' as any, value: 'large' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_INVALID_VALUE' });
  });

  it('modify_view encodes cornerRadius with attrType 13 (Double)', async () => {
    const bridge = createModifyBridgeStub();
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });
    await service.modifyView({ oid: 100, attribute: 'cornerRadius' as any, value: 12.0 });
    const encodeCall = bridge.encode.mock.calls[0][0];
    expect(encodeCall.data.attrType).toBe(13);
    expect(encodeCall.data.setterSelector).toBe('setCornerRadius:');
  });

  it('modify_view encodes shadowOpacity with attrType 12 (Float)', async () => {
    const bridge = createModifyBridgeStub();
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });
    await service.modifyView({ oid: 100, attribute: 'shadowOpacity' as any, value: 0.5 });
    const encodeCall = bridge.encode.mock.calls[0][0];
    expect(encodeCall.data.attrType).toBe(12);
    expect(encodeCall.data.setterSelector).toBe('setShadowOpacity:');
  });
});

// ─── Task 3: get_view includeConstraints ────────────────────────────────────

describe('Task 3 — get_view includeConstraints parameter', () => {
  const DETAIL_WITH_CONSTRAINTS_BUFFER = Buffer.from('detail-constraints-response');

  function createConstraintBridgeStub() {
    return {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === HIERARCHY_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: {
              $class: 'LookinHierarchyInfo',
              displayItems: [
                {
                  layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 200 },
                  viewObject: { $class: 'LookinObject', classChainList: ['UILabel'], oid: 1 },
                },
              ],
            },
          };
        }
        if (base64 === DETAIL_WITH_CONSTRAINTS_BUFFER.toString('base64')) {
          // data is an array of LookinAttributesGroup
          // constraints live in group "a" → section "a_c" → attribute "al_c_c" (attrType=28, value=[...])
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: [
              {
                $class: 'LookinAttributesGroup',
                identifier: 'a',  // LookinAttrGroup_AutoLayout
                attrSections: [
                  {
                    $class: 'LookinAttributesSection',
                    identifier: 'a_c',  // LookinAttrSec_AutoLayout_Constraints
                    attributes: [
                      {
                        $class: 'LookinAttribute',
                        identifier: 'al_c_c',  // LookinAttr_AutoLayout_Constraints_Constraints
                        attrType: 28,  // LookinAttrTypeCustomObj
                        value: [
                          {
                            $class: 'LookinAutoLayoutConstraint',
                            effective: true,
                            active: true,
                            firstItem: { $class: 'LookinObject', classChainList: ['UILabel'], oid: 1 },
                            firstAttribute: 3,   // top
                            relation: 0,         // ==
                            secondItem: { $class: 'LookinObject', classChainList: ['UIView'], oid: 10 },
                            secondAttribute: 3,  // top
                            multiplier: 1.0,
                            constant: 16.0,
                            priority: 1000,
                            identifier: 'titleLabel.top',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          };
        }
        throw new Error(`Unexpected: ${base64}`);
      }),
    };
  }

  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 210) return DETAIL_WITH_CONSTRAINTS_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
  });

  it('get_view without includeConstraints does not return constraints field', async () => {
    // getView takes layerOid — use 200 (the CALayer oid for UILabel)
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createConstraintBridgeStub() as any,
    });
    const result = await service.getView(200) as any;
    expect(result.constraints).toBeUndefined();
  });

  it('get_view with includeConstraints:true returns constraints array', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createConstraintBridgeStub() as any,
    });
    const result = await service.getView(200, { includeConstraints: true }) as any;
    expect(result.constraints).toBeDefined();
    expect(Array.isArray(result.constraints)).toBe(true);
  });

  it('constraint entries have human-readable firstAttribute string', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createConstraintBridgeStub() as any,
    });
    const result = await service.getView(200, { includeConstraints: true }) as any;
    const constraint = result.constraints[0];
    expect(constraint.firstAttribute).toBe('top');
    expect(constraint.secondAttribute).toBe('top');
  });

  it('constraint entries include all required fields', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createConstraintBridgeStub() as any,
    });
    const result = await service.getView(200, { includeConstraints: true }) as any;
    const c = result.constraints[0];
    expect(c.identifier).toBe('titleLabel.top');
    expect(c.effective).toBe(true);
    expect(c.active).toBe(true);
    expect(c.relation).toBe('==');
    expect(c.multiplier).toBe(1.0);
    expect(c.constant).toBe(16.0);
    expect(c.priority).toBe(1000);
    expect(c.firstItem).toMatchObject({ class: 'UILabel', oid: 1 });
  });
});

// ─── Task 4: Screenshot persistence ─────────────────────────────────────────

describe('Task 4 — getScreenshot saves image to disk', () => {
  const SCREENSHOT_BUFFER = Buffer.from('screenshot-response');
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookin-test-'));
    requestMock.mockReset();
    closeMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createScreenshotBridgeStub() {
    return {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === HIERARCHY_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: { $class: 'LookinHierarchyInfo', displayItems: [] },
          };
        }
        if (base64 === SCREENSHOT_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: [
              {
                $class: 'LookinDisplayItemDetail',
                displayItemOid: 100,
                groupScreenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              },
            ],
          };
        }
        throw new Error(`Unexpected decode: ${base64.slice(0, 20)}`);
      }),
    };
  }

  it('getScreenshot result includes savedPath field', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 203) return SCREENSHOT_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createScreenshotBridgeStub() as any,
      screenshotsDir: tmpDir,
    } as any);
    const result = await service.getScreenshot(100) as any;
    expect(result.savedPath).toBeDefined();
    expect(typeof result.savedPath).toBe('string');
    expect(result.savedPath).toContain('.png');
  });

  it('getScreenshot saves a file at the returned savedPath', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 203) return SCREENSHOT_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createScreenshotBridgeStub() as any,
      screenshotsDir: tmpDir,
    } as any);
    const result = await service.getScreenshot(100) as any;
    expect(fs.existsSync(result.savedPath)).toBe(true);
  });
});

// ─── Task 5: get_memory_address ──────────────────────────────────────────────

describe('Task 5 — getMemoryAddress', () => {
  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockResolvedValue(HIERARCHY_BUFFER);
  });

  it('getMemoryAddress by query returns viewMemoryAddress for matched node', async () => {
    const service = makeService();
    const result = await service.getMemoryAddress({ query: 'UIWindow' }) as any;
    expect(result.results).toBeDefined();
    expect(result.results[0].viewMemoryAddress).toBe('0xaabbccdd01');
  });

  it('getMemoryAddress by viewOid returns address for node with matching viewObject.oid', async () => {
    const service = makeService();
    const result = await service.getMemoryAddress({ viewOid: 2 }) as any;
    expect(result.results).toBeDefined();
    expect(result.results[0].viewMemoryAddress).toBe('0xaabbccdd02');
  });

  it('getMemoryAddress throws when no input provided', async () => {
    const service = makeService();
    await expect(service.getMemoryAddress({} as any)).rejects.toMatchObject({
      code: 'VALIDATION_MISSING_INPUT',
    });
  });

  it('getMemoryAddress by text matches text content instead of class name', async () => {
    const TEXT_ATTRS_BUFFER = Buffer.from('memory-text-attrs-response');
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 210) return TEXT_ATTRS_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: {
        encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
        decode: vi.fn().mockImplementation(async (base64: string) => {
          if (base64 === HIERARCHY_BUFFER.toString('base64')) {
            return defaultHierarchyData();
          }
          if (base64 === TEXT_ATTRS_BUFFER.toString('base64')) {
            return {
              $class: 'LookinConnectionResponseAttachment',
              data: [
                {
                  $class: 'LookinAttributesGroup',
                  identifier: 'text',
                  attrSections: [
                    {
                      $class: 'LookinAttributesSection',
                      identifier: 'text_section',
                      attributes: [
                        {
                          $class: 'LookinAttribute',
                          identifier: 'lb_t_t',
                          value: 'Login',
                        },
                      ],
                    },
                  ],
                },
              ],
            };
          }
          throw new Error(`Unexpected decode payload: ${base64}`);
        }),
      } as any,
    });
    const result = await service.getMemoryAddress({ query: 'UI', text: 'Login' }) as any;
    expect(result.results).toHaveLength(2);
    expect(result.results.map((entry: any) => entry.viewMemoryAddress)).toContain('0xaabbccdd01');
    expect(result.results.map((entry: any) => entry.viewMemoryAddress)).toContain('0xaabbccdd02');
    expect(result.results.map((entry: any) => entry.layerOid)).toEqual(expect.arrayContaining([100, 101]));
  });
});

// ─── Task 6: measure_distance ────────────────────────────────────────────────

describe('Task 6 — measureDistance geometry', () => {
  // Hierarchy with two views: A above B (not overlapping)
  function hierarchyWithTwoViews() {
    return {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            $class: 'LookinDisplayItem',
            frame: { x: 0, y: 0, width: 300, height: 300 },
            isHidden: false,
            alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 1 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIWindow'], oid: 100 },
            subitems: [
              {
                $class: 'LookinDisplayItem',
                frame: { x: 0, y: 0, width: 100, height: 50 },
                isHidden: false,
                alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 10 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 1 },
              },
              {
                $class: 'LookinDisplayItem',
                frame: { x: 0, y: 60, width: 100, height: 50 },
                isHidden: false,
                alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 20 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 2 },
              },
            ],
          },
        ],
      },
    };
  }

  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockResolvedValue(HIERARCHY_BUFFER);
  });

  it('measureDistance returns all 4 direction gaps for separated views', async () => {
    const service = makeService(hierarchyWithTwoViews());
    const result = await service.measureDistance(10, 20) as any;
    expect(result.top).toBeDefined();
    expect(result.bottom).toBeDefined();
    expect(result.left).toBeDefined();
    expect(result.right).toBeDefined();
  });

  it('measureDistance top/bottom gaps are correct for vertically separated views', async () => {
    const service = makeService(hierarchyWithTwoViews());
    // A: y=0, h=50; B: y=60, h=50
    // A bottom = 50, B top = 60 → gap = 10
    const result = await service.measureDistance(10, 20) as any;
    expect(result.bottom).toBe(10); // gap from A bottom to B top
    expect(result.top).toBe(10);    // gap from B top to A bottom (symmetric)
  });

  it('measureDistance returns relationship=separated for non-overlapping views', async () => {
    const service = makeService(hierarchyWithTwoViews());
    const result = await service.measureDistance(10, 20) as any;
    expect(result.relationship).toBe('separated');
  });

  it('measureDistance returns relationship=overlapping for intersecting frames', async () => {
    const overlappingData = {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            frame: { x: 0, y: 0, width: 300, height: 300 },
            isHidden: false, alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 1 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIWindow'], oid: 100 },
            subitems: [
              {
                frame: { x: 0, y: 0, width: 100, height: 100 },
                isHidden: false, alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 10 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 1 },
              },
              {
                frame: { x: 50, y: 50, width: 100, height: 100 },
                isHidden: false, alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 20 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 2 },
              },
            ],
          },
        ],
      },
    };
    const service = makeService(overlappingData);
    const result = await service.measureDistance(10, 20) as any;
    expect(result.relationship).toBe('overlapping');
    expect(result.top).toBe(-50);
    expect(result.bottom).toBe(-50);
    expect(result.left).toBe(-50);
    expect(result.right).toBe(-50);
  });

  it('measureDistance throws for unknown layerOid', async () => {
    const service = makeService(hierarchyWithTwoViews());
    await expect(service.measureDistance(10, 999)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('measureDistance returns containing relationship and inset distances', async () => {
    const containingData = {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            frame: { x: 0, y: 0, width: 200, height: 200 },
            isHidden: false, alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 10 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 1 },
            subitems: [
              {
                frame: { x: 20, y: 30, width: 50, height: 60 },
                isHidden: false, alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 20 },
                viewObject: { $class: 'LookinObject', classChainList: ['UILabel'], oid: 2 },
              },
            ],
          },
        ],
      },
    };
    const service = makeService(containingData);
    const result = await service.measureDistance(10, 20) as any;
    expect(result.relationship).toBe('containing');
    expect(result.classA).toBe('UIView');
    expect(result.classB).toBe('UILabel');
    expect(result.top).toBe(30);
    expect(result.bottom).toBe(110);
    expect(result.left).toBe(20);
    expect(result.right).toBe(130);
  });

  it('measureDistance accounts for nested subview frames in a common root coordinate system', async () => {
    const nestedData = {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            frame: { x: 0, y: 0, width: 400, height: 400 },
            isHidden: false, alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 1 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIWindow'], oid: 100 },
            subitems: [
              {
                frame: { x: 50, y: 100, width: 200, height: 200 },
                isHidden: false, alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 10 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 1 },
                subitems: [
                  {
                    frame: { x: 10, y: 20, width: 30, height: 40 },
                    isHidden: false, alpha: 1,
                    layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 11 },
                    viewObject: { $class: 'LookinObject', classChainList: ['UILabel'], oid: 2 },
                  },
                ],
              },
              {
                frame: { x: 100, y: 170, width: 20, height: 20 },
                isHidden: false, alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 20 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIButton'], oid: 3 },
              },
            ],
          },
        ],
      },
    };
    const service = makeService(nestedData);
    const result = await service.measureDistance(11, 20) as any;
    expect(result.relationship).toBe('separated');
    expect(result.top).toBe(10);
    expect(result.bottom).toBe(10);
    expect(result.left).toBe(10);
    expect(result.right).toBe(10);
  });

  it('measureDistance rejects views from different root coordinate systems', async () => {
    const multiRootData = {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            frame: { x: 0, y: 0, width: 100, height: 100 },
            isHidden: false, alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 1 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIWindow'], oid: 100 },
            subitems: [
              {
                frame: { x: 0, y: 0, width: 100, height: 100 },
                isHidden: false, alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 10 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 1 },
              },
            ],
          },
          {
            frame: { x: 200, y: 200, width: 100, height: 100 },
            isHidden: false, alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 2 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIWindow'], oid: 200 },
            subitems: [
              {
                frame: { x: 0, y: 0, width: 100, height: 100 },
                isHidden: false, alpha: 1,
                layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 20 },
                viewObject: { $class: 'LookinObject', classChainList: ['UIView'], oid: 2 },
              },
            ],
          },
        ],
      },
    };
    const service = makeService(multiRootData);
    await expect(service.measureDistance(10, 20)).rejects.toMatchObject({
      code: 'VALIDATION_INVALID_TARGET',
    });
  });
});

// ─── Task 7: get_event_handlers ──────────────────────────────────────────────

describe('Task 7 — getEventHandlers', () => {
  function hierarchyWithEventHandlers() {
    return {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            $class: 'LookinDisplayItem',
            frame: { x: 0, y: 0, width: 100, height: 44 },
            isHidden: false,
            alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 50 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIButton'], oid: 5 },
            eventHandlers: [
              {
                $class: 'LookinEventHandler',
                handlerType: 0, // targetAction
                eventName: 'UIControlEventTouchUpInside',
                targetActions: [
                  { first: '<LoginVC: 0x1234>', second: 'handleTap' },
                ],
                recognizerOid: 0,
              },
              {
                $class: 'LookinEventHandler',
                handlerType: 1, // gesture
                eventName: 'UITapGestureRecognizer',
                targetActions: [],
                gestureRecognizerIsEnabled: true,
                recognizerOid: 9999,
              },
            ],
          },
        ],
      },
    };
  }

  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockResolvedValue(HIERARCHY_BUFFER);
  });

  it('getEventHandlers returns event handlers for a layerOid', async () => {
    const service = makeService(hierarchyWithEventHandlers());
    const result = await service.getEventHandlers(50) as any;
    expect(result.eventHandlers).toBeDefined();
    expect(result.eventHandlers).toHaveLength(2);
  });

  it('getEventHandlers first handler is targetAction type', async () => {
    const service = makeService(hierarchyWithEventHandlers());
    const result = await service.getEventHandlers(50) as any;
    const handler = result.eventHandlers[0];
    expect(handler.type).toBe('targetAction');
    expect(handler.eventName).toBe('UIControlEventTouchUpInside');
  });

  it('getEventHandlers second handler is gesture type with recognizerOid', async () => {
    const service = makeService(hierarchyWithEventHandlers());
    const result = await service.getEventHandlers(50) as any;
    const handler = result.eventHandlers[1];
    expect(handler.type).toBe('gesture');
    expect(handler.recognizerOid).toBe(9999);
    expect(handler.enabled).toBe(true);
    expect(handler.delegator).toBeNull();
    expect(handler.targetActions).toEqual([]);
  });

  it('getEventHandlers returns empty array for view with no handlers', async () => {
    const service = makeService(); // defaultHierarchyData has no eventHandlers
    const result = await service.getEventHandlers(100) as any;
    expect(result.eventHandlers).toEqual([]);
  });

  it('getEventHandlers throws NOT_FOUND for unknown layerOid', async () => {
    const service = makeService();
    await expect(service.getEventHandlers(9999)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ─── Task 8: get_methods ─────────────────────────────────────────────────────

const METHODS_BUFFER = Buffer.from('methods-response');

describe('Task 8 — getMethods', () => {
  function hierarchyWithMethodChain() {
    return {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            frame: { x: 10, y: 20, width: 100, height: 44 },
            isHidden: false,
            alpha: 1,
            layerObject: {
              $class: 'LookinObject',
              classChainList: ['CALayer'],
              oid: 101,
            },
            viewObject: {
              $class: 'LookinObject',
              classChainList: ['UIButton', 'UIControl', 'UIView'],
              oid: 2,
              memoryAddress: '0xaabbccdd02',
            },
          },
        ],
      },
    };
  }

  function createMethodsBridgeStub() {
    return {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === HIERARCHY_BUFFER.toString('base64')) {
          return hierarchyWithMethodChain();
        }
        if (base64 === METHODS_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: ['initWithFrame:', 'layoutSubviews', 'setTitle:forState:', 'addTarget:action:forControlEvents:'],
          };
        }
        throw new Error(`Unexpected: ${base64.slice(0, 20)}`);
      }),
    };
  }

  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      if (type === 213) return METHODS_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
  });

  it('getMethods by className returns selector list', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createMethodsBridgeStub() as any,
    });
    const result = await service.getMethods({ className: 'UIButton' }) as any;
    expect(result.methods).toBeDefined();
    expect(Array.isArray(result.methods)).toBe(true);
    expect(result.methods.length).toBeGreaterThan(0);
    expect(result.methods).toEqual(['layoutSubviews']);
    expect(result.methodsByClass).toEqual({ UIButton: ['layoutSubviews'] });
  });

  it('getMethods by oid resolves className from hierarchy', async () => {
    // layerOid=101 → UIButton class name
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createMethodsBridgeStub() as any,
    });
    const result = await service.getMethods({ oid: 101 }) as any;
    expect(result.className).toBe('UIButton');
    expect(result.methods).toBeDefined();
    expect(result.classHierarchy).toEqual(['UIButton', 'UIControl', 'UIView']);
  });

  it('getMethods sends AllSelectorNames (213) request', async () => {
    const bridge = createMethodsBridgeStub();
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });
    await service.getMethods({ className: 'UIButton' });
    const called213 = requestMock.mock.calls.some((c: any[]) => c[0] === 213);
    expect(called213).toBe(true);
  });

  it('getMethods encodes className in data dict (not raw string)', async () => {
    const bridge = createMethodsBridgeStub();
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });
    await service.getMethods({ className: 'UIButton' });
    const encodeCalls = (bridge.encode as any).mock.calls;
    const methodsEncodeCall = encodeCalls.find((args: any[]) => {
      const obj = args[0];
      return obj?.$class === 'LookinConnectionAttachment' && typeof obj?.data !== 'string';
    });
    expect(methodsEncodeCall).toBeDefined();
    expect(methodsEncodeCall[0].data).toEqual({ className: 'UIButton', hasArg: false });
  });

  it('getMethods throws when neither oid nor className provided', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createMethodsBridgeStub() as any,
    });
    await expect(service.getMethods({} as any)).rejects.toMatchObject({
      code: 'VALIDATION_MISSING_INPUT',
    });
  });

  it('getMethods includes selectors with arguments when includeArgs is true', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createMethodsBridgeStub() as any,
    });
    const result = await service.getMethods({ className: 'UIButton', includeArgs: true }) as any;
    expect(result.methods).toContain('setTitle:forState:');
    expect(result.methods).toContain('addTarget:action:forControlEvents:');
  });
});

// ─── Task 9: get_image ───────────────────────────────────────────────────────

const IMAGE_BUFFER = Buffer.from('image-view-response');

describe('Task 9 — getImage', () => {
  const FAKE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const IMAGE_HIERARCHY_BUFFER = Buffer.from('image-hierarchy-response');

  function imageHierarchyData() {
    return {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            $class: 'LookinDisplayItem',
            frame: { x: 0, y: 0, width: 100, height: 44 },
            isHidden: false,
            alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 201 },
            viewObject: { $class: 'LookinObject', classChainList: ['UIImageView'], oid: 21 },
          },
        ],
      },
    };
  }

  function imageSubclassHierarchyData() {
    return {
      $class: 'LookinConnectionResponseAttachment',
      data: {
        $class: 'LookinHierarchyInfo',
        displayItems: [
          {
            $class: 'LookinDisplayItem',
            frame: { x: 0, y: 0, width: 100, height: 44 },
            isHidden: false,
            alpha: 1,
            layerObject: { $class: 'LookinObject', classChainList: ['CALayer'], oid: 301 },
            viewObject: {
              $class: 'LookinObject',
              classChainList: ['NMAnimatedImageView', 'UIImageView', 'UIView'],
              oid: 31,
            },
          },
        ],
      },
    };
  }

  function createImageBridgeStub(tmpDir: string) {
    return {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === IMAGE_HIERARCHY_BUFFER.toString('base64')) {
          return imageHierarchyData();
        }
        if (base64 === IMAGE_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: { imageBase64: FAKE_PNG, imageSize: { width: 1, height: 1 } },
          };
        }
        throw new Error(`Unexpected: ${base64.slice(0, 20)}`);
      }),
    };
  }

  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookin-img-test-'));
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return IMAGE_HIERARCHY_BUFFER;
      if (type === 208) return IMAGE_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getImage returns imageBase64 and savedPath', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createImageBridgeStub(tmpDir) as any,
      screenshotsDir: tmpDir,
    } as any);
    const result = await service.getImage(201) as any;
    expect(result.imageBase64).toBeDefined();
    expect(result.savedPath).toBeDefined();
    expect(result.savedPath).toContain('.png');
    expect(result.savedPath).toMatch(/UIImageView_image\.png$/);
  });

  it('getImage saves the file to disk', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createImageBridgeStub(tmpDir) as any,
      screenshotsDir: tmpDir,
    } as any);
    const result = await service.getImage(201) as any;
    expect(fs.existsSync(result.savedPath)).toBe(true);
  });

  it('getImage sends FetchImageViewImage (208) request', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createImageBridgeStub(tmpDir) as any,
      screenshotsDir: tmpDir,
    } as any);
    await service.getImage(201);
    const called208 = requestMock.mock.calls.some((c: any[]) => c[0] === 208);
    expect(called208).toBe(true);
  });

  it('getImage throws a descriptive error for non-UIImageView targets', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return HIERARCHY_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: {
        encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
        decode: vi.fn().mockImplementation(async (base64: string) => {
          if (base64 === HIERARCHY_BUFFER.toString('base64')) {
            return defaultHierarchyData();
          }
          throw new Error(`Unexpected: ${base64.slice(0, 20)}`);
        }),
      } as any,
      screenshotsDir: tmpDir,
    } as any);
    await expect(service.getImage(101)).rejects.toMatchObject({
      code: 'VALIDATION_INVALID_TARGET',
      message: expect.stringContaining('UIButton'),
    });
  });

  it('getImage accepts UIImageView subclasses from the class chain', async () => {
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) return IMAGE_HIERARCHY_BUFFER;
      if (type === 208) return IMAGE_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: {
        encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
        decode: vi.fn().mockImplementation(async (base64: string) => {
          if (base64 === IMAGE_HIERARCHY_BUFFER.toString('base64')) {
            return imageSubclassHierarchyData();
          }
          if (base64 === IMAGE_BUFFER.toString('base64')) {
            return {
              $class: 'LookinConnectionResponseAttachment',
              data: { imageBase64: FAKE_PNG, imageSize: { width: 1, height: 1 } },
            };
          }
          throw new Error(`Unexpected: ${base64.slice(0, 20)}`);
        }),
      } as any,
      screenshotsDir: tmpDir,
    } as any);
    const result = await service.getImage(301) as any;
    expect(result.savedPath).toMatch(/NMAnimatedImageView_image\.png$/);
  });
});

// ─── Task 10: toggle_gesture ─────────────────────────────────────────────────

const GESTURE_BUFFER = Buffer.from('gesture-toggle-response');

describe('Task 10 — toggleGesture', () => {
  function createGestureBridgeStub() {
    return {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded').toString('base64')),
      decode: vi.fn().mockImplementation(async (base64: string) => {
        if (base64 === GESTURE_BUFFER.toString('base64')) {
          return {
            $class: 'LookinConnectionResponseAttachment',
            data: { gestureType: 'UITapGestureRecognizer' },
          };
        }
        throw new Error(`Unexpected: ${base64.slice(0, 20)}`);
      }),
    };
  }

  beforeEach(() => {
    requestMock.mockReset();
    closeMock.mockReset();
    requestMock.mockImplementation(async (type: number) => {
      if (type === 209) return GESTURE_BUFFER;
      throw new Error(`Unexpected type ${type}`);
    });
  });

  it('toggleGesture returns success confirmation', async () => {
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: createGestureBridgeStub() as any,
    });
    const result = await service.toggleGesture({ recognizerOid: 9999, enabled: false }) as any;
    expect(result.success).toBe(true);
    expect(result.recognizerOid).toBe(9999);
    expect(result.enabled).toBe(false);
    expect(result.gestureType).toBe('UITapGestureRecognizer');
  });

  it('toggleGesture sends ModifyRecognizerEnable (209) request', async () => {
    const bridge = createGestureBridgeStub();
    const service = new LookinCliService({
      fixedEndpoint: { host: '127.0.0.1', port: 47175, transport: 'simulator' },
      bridgeClient: bridge as any,
    });
    await service.toggleGesture({ recognizerOid: 9999, enabled: true });
    const called209 = requestMock.mock.calls.some((c: any[]) => c[0] === 209);
    expect(called209).toBe(true);
    expect(bridge.encode.mock.calls[0][0].data).toEqual({
      recognizerOid: 9999,
      enabled: true,
    });
  });
});
