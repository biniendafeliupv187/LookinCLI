import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerReloadTool } from '../src/mcp/reload-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const requestMock = vi.fn().mockResolvedValue(
  Buffer.from(fixtures.hierarchyResponse.base64, 'base64'),
);

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Hierarchy: 202,
  },
  AppSession: vi.fn().mockImplementation(() => ({
    request: requestMock,
    close: vi.fn(),
  })),
}));

vi.mock('../src/core/bridge-client.js', () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({
    decode: vi.fn().mockResolvedValue(fixtures.hierarchyResponse.expected),
    encode: vi.fn().mockResolvedValue(''),
  })),
}));

describe('reload MCP tool', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    requestMock.mockClear();
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  async function setupMcpPair() {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerReloadTool(mcpServer, {
      host: '127.0.0.1',
      port: 47164,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  it('reload tool is listed', async () => {
    await setupMcpPair();

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'reload');
    expect(tool).toBeDefined();
    expect(tool!.description!.toLowerCase()).toContain('reload');
  });

  it('reload fetches fresh hierarchy and returns summary', async () => {
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'reload',
      arguments: {},
    });
    expect(result.isError).toBeFalsy();

    const data = JSON.parse((result.content as any)[0].text);
    expect(data.status).toBe('reloaded');
    expect(data.summary).toBeDefined();
    expect(data.summary.nodeCount).toBeGreaterThan(0);
    expect(data.summary.appName).toBe('TestApp');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('reload reports error when server is unreachable', async () => {
    requestMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:19998'));
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'reload',
      arguments: {},
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.error).toBeDefined();
    expect(data.code).toBe('TRANSPORT_REFUSED');
  });
});
