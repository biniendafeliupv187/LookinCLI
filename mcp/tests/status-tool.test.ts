import { describe, it, expect, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerStatusTool } from '../src/mcp/status-tool.js';

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Ping: 200,
  },
  AppSession: vi.fn().mockImplementation((_endpoint, _bridge, options) => ({
    ping: vi.fn().mockResolvedValue({
      $class: 'LookinConnectionResponseAttachment',
      lookinServerVersion: 7,
      appIsInBackground: false,
    }),
    close: vi.fn(),
    options,
  })),
}));

describe('status MCP tool', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  async function setupMcpPair() {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );

    registerStatusTool(mcpServer, {
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

  it('status tool is listed with correct name', async () => {
    await setupMcpPair();

    const { tools } = await client!.listTools();
    const statusTool = tools.find((t) => t.name === 'status');
    expect(statusTool).toBeDefined();
    expect(statusTool!.description).toContain('connection');
  });

  it('status returns connection health and protocol version', async () => {
    await setupMcpPair();

    const result = await client!.callTool({ name: 'status' });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text;
    const status = JSON.parse(text);

    expect(status.connected).toBe(true);
    expect(status.serverVersion).toBe(7);
    expect(status.appIsInBackground).toBe(false);
    expect(status.transport).toBe('simulator');
  });

  it('status reports error when server is unreachable', async () => {
    const { AppSession } = await import('../src/core/app-session.js');
    vi.mocked(AppSession).mockImplementationOnce(() => ({
      ping: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:19998')),
      close: vi.fn(),
    } as any));

    await setupMcpPair();

    const result = await client!.callTool({ name: 'status' });

    const text = (result.content as any)[0].text;
    const status = JSON.parse(text);
    expect(status.connected).toBe(false);
    expect(status.error).toBeDefined();
    expect(status.code).toBe('TRANSPORT_REFUSED');
  });
});
