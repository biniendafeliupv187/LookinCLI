import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CacheManager } from '../src/core/cache.js';
import { registerStatusTool } from '../src/mcp/status-tool.js';
import { registerHierarchyTool } from '../src/mcp/hierarchy-tool.js';
import { registerSearchTool } from '../src/mcp/search-tool.js';
import { registerReloadTool } from '../src/mcp/reload-tool.js';
import { registerGetViewTool } from '../src/mcp/view-tool.js';
import { registerGetScreenshotTool } from '../src/mcp/screenshot-tool.js';
import { registerModifyViewTool } from '../src/mcp/modify-view-tool.js';
import { registerGetMemoryAddressTool } from '../src/mcp/get-memory-address-tool.js';
import { registerMeasureDistanceTool } from '../src/mcp/measure-distance-tool.js';
import { registerGetEventHandlersTool } from '../src/mcp/get-event-handlers-tool.js';
import { registerGetMethodsTool } from '../src/mcp/get-methods-tool.js';
import { registerGetImageTool } from '../src/mcp/get-image-tool.js';
import { registerToggleGestureTool } from '../src/mcp/toggle-gesture-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const HIERARCHY_RESPONSE_B64 = Buffer.from('e2e-hierarchy-response').toString('base64');
const IMAGE_RESPONSE_B64 = Buffer.from('e2e-image-response').toString('base64');
const METHODS_RESPONSE_B64 = Buffer.from('e2e-methods-response').toString('base64');
const GESTURE_RESPONSE_B64 = Buffer.from('e2e-gesture-response').toString('base64');
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const hierarchyResponseExpected = {
  $class: 'LookinConnectionResponseAttachment',
  data: {
    $class: 'LookinHierarchyInfo',
    appInfo: {
      appName: 'Mock Demo',
      appBundleIdentifier: 'com.example.demo',
      deviceDescription: 'iPhone',
      osDescription: '18.0',
    },
    serverVersion: 7,
    displayItems: [
      {
        $class: 'LookinDisplayItem',
        frame: { x: 0, y: 0, width: 200, height: 120 },
        isHidden: false,
        alpha: 1,
        layerObject: {
          $class: 'LookinObject',
          classChainList: ['CALayer'],
          oid: 500,
          memoryAddress: '0xdeadbeef00',
        },
        viewObject: {
          $class: 'LookinObject',
          classChainList: ['UIWindow'],
          oid: 501,
          memoryAddress: '0xaabbccdd00',
        },
        subitems: [
          {
            $class: 'LookinDisplayItem',
            frame: { x: 0, y: 0, width: 100, height: 40 },
            isHidden: false,
            alpha: 1,
            layerObject: {
              $class: 'LookinObject',
              classChainList: ['CALayer'],
              oid: 1,
              memoryAddress: '0xdeadbeef01',
            },
            viewObject: {
              $class: 'LookinObject',
              classChainList: ['UIButton'],
              oid: 2,
              memoryAddress: '0xaabbccdd01',
            },
            eventHandlers: [
              {
                $class: 'LookinEventHandler',
                handlerType: 0,
                eventName: 'UIControlEventTouchUpInside',
                targetActions: [{ first: '<LoginVC: 0x1234>', second: 'handleTap' }],
              },
              {
                $class: 'LookinEventHandler',
                handlerType: 1,
                eventName: 'UITapGestureRecognizer',
                targetActions: [],
                recognizerOid: 9999,
                gestureRecognizerIsEnabled: true,
                gestureRecognizerDelegator: null,
              },
            ],
          },
          {
            $class: 'LookinDisplayItem',
            frame: { x: 0, y: 60, width: 100, height: 20 },
            isHidden: false,
            alpha: 1,
            layerObject: {
              $class: 'LookinObject',
              classChainList: ['CALayer'],
              oid: 42,
              memoryAddress: '0xdeadbeef02',
            },
            viewObject: {
              $class: 'LookinObject',
              classChainList: ['UILabel'],
              oid: 43,
              memoryAddress: '0xaabbccdd02',
            },
          },
          {
            $class: 'LookinDisplayItem',
            frame: { x: 120, y: 0, width: 40, height: 40 },
            isHidden: false,
            alpha: 1,
            layerObject: {
              $class: 'LookinObject',
              classChainList: ['CALayer'],
              oid: 60,
              memoryAddress: '0xdeadbeef03',
            },
            viewObject: {
              $class: 'LookinObject',
              classChainList: ['UIImageView'],
              oid: 61,
              memoryAddress: '0xaabbccdd03',
            },
          },
        ],
      },
    ],
  },
  lookinServerVersion: 7,
};

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Ping: 200,
    App: 201,
    Hierarchy: 202,
    HierarchyDetails: 203,
    InbuiltAttrModification: 204,
    FetchImageViewImage: 208,
    ModifyRecognizerEnable: 209,
    AllAttrGroups: 210,
    AllSelectorNames: 213,
  },
  AppSession: vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue(fixtures.connectionResponse.expected),
    request: vi.fn().mockImplementation((type: number) => {
      if (type === 202) {
        return Promise.resolve(Buffer.from(HIERARCHY_RESPONSE_B64, 'base64'));
      }
      if (type === 210) {
        return Promise.resolve(Buffer.from(fixtures.attrGroupsResponse.base64, 'base64'));
      }
      if (type === 203) {
        return Promise.resolve(Buffer.from(fixtures.screenshotResponse.base64, 'base64'));
      }
      if (type === 204) {
        return Promise.resolve(Buffer.from(fixtures.modifyResponse.base64, 'base64'));
      }
      if (type === 208) {
        return Promise.resolve(Buffer.from(IMAGE_RESPONSE_B64, 'base64'));
      }
      if (type === 209) {
        return Promise.resolve(Buffer.from(GESTURE_RESPONSE_B64, 'base64'));
      }
      if (type === 213) {
        return Promise.resolve(Buffer.from(METHODS_RESPONSE_B64, 'base64'));
      }
      return Promise.reject(new Error(`Unknown request type: ${type}`));
    }),
    close: vi.fn(),
  })),
}));

vi.mock('../src/core/bridge-client.js', () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({
    decode: vi.fn().mockImplementation(async (base64: string) => {
      if (base64 === HIERARCHY_RESPONSE_B64) {
        return hierarchyResponseExpected;
      }
      if (base64 === fixtures.attrGroupsResponse.base64) {
        return fixtures.attrGroupsResponse.expected;
      }
      if (base64 === fixtures.screenshotResponse.base64) {
        return {
              $class: 'LookinConnectionResponseAttachment',
              data: [
                {
                  $class: 'LookinDisplayItemDetail',
                  displayItemOid: 500,
                  groupScreenshot: PNG_BASE64,
                },
              ],
          lookinServerVersion: 7,
        };
      }
      if (base64 === fixtures.modifyResponse.base64) {
        return fixtures.modifyResponse.expected;
      }
      if (base64 === fixtures.connectionResponse.base64) {
        return fixtures.connectionResponse.expected;
      }
      if (base64 === IMAGE_RESPONSE_B64) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: {
            imageBase64: PNG_BASE64,
            imageSize: { width: 1, height: 1 },
          },
          lookinServerVersion: 7,
        };
      }
      if (base64 === METHODS_RESPONSE_B64) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: ['layoutSubviews', 'setTitle:forState:'],
          lookinServerVersion: 7,
        };
      }
      if (base64 === GESTURE_RESPONSE_B64) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: { gestureType: 'UITapGestureRecognizer' },
          lookinServerVersion: 7,
        };
      }
      throw new Error(`unexpected bridge decode payload: ${base64.slice(0, 16)}`);
    }),
    encode: vi.fn().mockImplementation(async (json: unknown) =>
      Buffer.from(JSON.stringify(json)).toString('base64'),
    ),
  })),
}));

describe('E2E Integration', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  async function setupE2EMcpPair() {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    const cache = new CacheManager();

    const mockEndpoint = {
      host: '127.0.0.1',
      port: 47164,
      transport: 'simulator' as const,
    };

    registerStatusTool(mcpServer, mockEndpoint);
    registerHierarchyTool(mcpServer, mockEndpoint, cache);
    registerSearchTool(mcpServer, mockEndpoint, cache);
    registerReloadTool(mcpServer, mockEndpoint, cache);
    registerGetViewTool(mcpServer, mockEndpoint, cache);
    registerGetScreenshotTool(mcpServer, mockEndpoint);
    registerModifyViewTool(mcpServer, mockEndpoint, cache);
    registerGetMemoryAddressTool(mcpServer, mockEndpoint, cache);
    registerMeasureDistanceTool(mcpServer, mockEndpoint, cache);
    registerGetEventHandlersTool(mcpServer, mockEndpoint, cache);
    registerGetMethodsTool(mcpServer, mockEndpoint, cache);
    registerGetImageTool(mcpServer, mockEndpoint, cache);
    registerToggleGestureTool(mcpServer, mockEndpoint, cache);

    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  it('runs full e2e tool flow against mocked app session', async () => {
    await setupE2EMcpPair();

    let res = await client!.callTool({ name: 'status' });
    expect(res.isError).toBeFalsy();
    let data = JSON.parse((res.content as any)[0].text);
    expect(data.connected).toBe(true);
    expect(data.serverVersion).toBe(7);

    res = await client!.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.viewHierarchy.length).toBeGreaterThan(0);
    const rootLayerOid = data.viewHierarchy[0].layerOid;
    const rootViewOid = data.viewHierarchy[0].oid;

    res = await client!.callTool({ name: 'search', arguments: { query: 'UIView' } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.results).toBeDefined();

    res = await client!.callTool({ name: 'get_view', arguments: { oid: rootLayerOid } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.attrGroups).toBeDefined();

    res = await client!.callTool({ name: 'get_screenshot', arguments: { oid: rootLayerOid } });
    expect(res.isError).toBeFalsy();
    const content = res.content as any[];
    const screenshotMeta = JSON.parse(content.find((c) => c.type === 'text').text);
    expect(screenshotMeta.oid).toBe(rootLayerOid);
    expect(screenshotMeta.savedPath).toContain('.png');

    res = await client!.callTool({ name: 'modify_view', arguments: { oid: rootViewOid, attribute: 'text', value: 'Hello World' } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.updatedDetail).toBeDefined();

    res = await client!.callTool({ name: 'reload', arguments: {} });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.status).toBe('reloaded');
  });

  it('exposes all feature-gap MCP tools through the server', async () => {
    await setupE2EMcpPair();

    const { tools } = await client!.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain('get_memory_address');
    expect(names).toContain('measure_distance');
    expect(names).toContain('get_event_handlers');
    expect(names).toContain('get_methods');
    expect(names).toContain('get_image');
    expect(names).toContain('toggle_gesture');
  });

  it('runs feature-gap MCP tools against mocked app session', async () => {
    await setupE2EMcpPair();

    let res = await client!.callTool({
      name: 'get_memory_address',
      arguments: { query: 'UIButton' },
    });
    expect(res.isError).toBeFalsy();
    let data = JSON.parse((res.content as any)[0].text);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].viewMemoryAddress).toBe('0xaabbccdd01');

    res = await client!.callTool({
      name: 'measure_distance',
      arguments: { layerOidA: 1, layerOidB: 42 },
    });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.relationship).toBe('separated');
    expect(data.bottom).toBe(20);

    res = await client!.callTool({
      name: 'get_event_handlers',
      arguments: { oid: 1 },
    });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.eventHandlers).toHaveLength(2);
    expect(data.eventHandlers[1].recognizerOid).toBe(9999);

    res = await client!.callTool({
      name: 'get_methods',
      arguments: { className: 'UIButton', includeArgs: true },
    });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.methods).toContain('setTitle:forState:');

    res = await client!.callTool({
      name: 'get_image',
      arguments: { oid: 60 },
    });
    expect(res.isError).toBeFalsy();
    let content = res.content as any[];
    const imageMeta = JSON.parse(content.find((item) => item.type === 'text').text);
    expect(imageMeta.savedPath).toContain('UIImageView_image.png');
    expect(imageMeta.imageSize).toEqual({ width: 1, height: 1 });

    res = await client!.callTool({
      name: 'toggle_gesture',
      arguments: { recognizerOid: 9999, enabled: false },
    });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.success).toBe(true);
    expect(data.gestureType).toBe('UITapGestureRecognizer');
  });
});
