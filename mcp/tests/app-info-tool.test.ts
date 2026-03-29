import { describe, it, expect, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerGetAppInfoTool } from '../src/mcp/app-info-tool.js';

const { appSessionMock } = vi.hoisted(() => ({
  appSessionMock: vi.fn(),
}));

appSessionMock.mockImplementation(() => ({
  ping: vi.fn().mockResolvedValue({
    $class: 'LookinConnectionResponseAttachment',
    lookinServerVersion: 7,
    appIsInBackground: false,
    data: {
      appName: 'PingApp',
      appBundleIdentifier: 'com.test.ping',
      deviceDescription: 'iPhone Ping',
      osDescription: 'iOS 18.1',
      osMainVersion: 18,
      deviceType: 1,
      serverVersion: 7,
      serverReadableVersion: '7.0',
      screenWidth: 390,
      screenHeight: 844,
      screenScale: 3,
    },
  }),
  request: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  close: vi.fn(),
}));

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Ping: 200,
    Hierarchy: 202,
  },
  AppSession: appSessionMock,
}));

describe('get_app_info MCP tool', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    appSessionMock.mockClear();
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  async function setupMcpPair() {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerGetAppInfoTool(mcpServer, {
      host: '127.0.0.1',
      port: 47164,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  it('get_app_info tool is listed with correct name', async () => {
    await setupMcpPair();

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_app_info');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('app');
  });

  it('prefers ping attachment metadata over hierarchy-derived app info', async () => {
    await setupMcpPair();

    const result = await client!.callTool({ name: 'get_app_info' });
    expect(result.isError).toBeFalsy();

    const data = JSON.parse((result.content as any)[0].text);
    expect(data.appName).toBe('PingApp');
    expect(data.bundleIdentifier).toBe('com.test.ping');
    expect(data.deviceDescription).toBe('iPhone Ping');
    expect(data.osDescription).toBe('iOS 18.1');
    expect(data.screenWidth).toBe(390);
    expect(data.screenHeight).toBe(844);
    expect(data.screenScale).toBe(3);
  });

  it('returns structured error when ping fails', async () => {
    appSessionMock.mockImplementationOnce(() => ({
      ping: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:19997')),
      request: vi.fn(),
      close: vi.fn(),
    }));

    await setupMcpPair();

    const result = await client!.callTool({ name: 'get_app_info' });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.error).toBeDefined();
    expect(data.code).toBe('TRANSPORT_REFUSED');
  });

  it('has no required parameters', async () => {
    await setupMcpPair();

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_app_info');
    const schema = tool!.inputSchema as any;
    expect(schema.required ?? []).toEqual([]);
  });
});
