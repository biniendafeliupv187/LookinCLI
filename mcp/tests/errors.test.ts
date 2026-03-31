import { describe, it, expect, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerStatusTool } from '../src/mcp/status-tool.js';
import { registerHierarchyTool } from '../src/mcp/hierarchy-tool.js';
import { registerGetViewTool } from '../src/mcp/view-tool.js';
import { LookinError, classifyError, errorResponse } from '../src/core/errors.js';
import { DeviceDiscovery } from '../src/core/discovery.js';

const { appSessionMock } = vi.hoisted(() => ({
  appSessionMock: vi.fn(),
}));

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Ping: 200,
    Hierarchy: 202,
    AllAttrGroups: 210,
  },
  AppSession: appSessionMock,
}));

function resetAppSessionMock(): void {
  appSessionMock.mockReset();
  appSessionMock.mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue({
      $class: 'LookinConnectionResponseAttachment',
      lookinServerVersion: 7,
      appIsInBackground: false,
    }),
    request: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    close: vi.fn(),
  }));
}

function parseToolResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function setupMcpPair(
  registerFn: (server: McpServer) => void,
): Promise<{ client: Client; server: McpServer }> {
  const server = new McpServer(
    { name: 'test', version: '0.1.1' },
    { capabilities: { tools: {} } },
  );
  registerFn(server);
  const client = new Client({ name: 'test-client', version: '0.1.1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server };
}

describe('LookinError', () => {
  it('creates error with code, message, and details', () => {
    const err = new LookinError('TRANSPORT_TIMEOUT', 'timed out', { requestType: 202 });
    expect(err.code).toBe('TRANSPORT_TIMEOUT');
    expect(err.message).toBe('timed out');
    expect(err.details).toEqual({ requestType: 202 });
    expect(err.name).toBe('LookinError');
    expect(err).toBeInstanceOf(Error);
  });

  it('toJSON returns structured error object', () => {
    const err = new LookinError('TRANSPORT_REFUSED', 'connection refused', { host: '127.0.0.1', port: 47175 });
    const json = err.toJSON();
    expect(json).toEqual({
      error: 'connection refused',
      code: 'TRANSPORT_REFUSED',
      details: { host: '127.0.0.1', port: 47175 },
    });
  });

  it('toJSON omits details when undefined', () => {
    const err = new LookinError('DISCOVERY_NO_DEVICE', 'no device');
    const json = err.toJSON();
    expect(json).toEqual({ error: 'no device', code: 'DISCOVERY_NO_DEVICE' });
    expect(json).not.toHaveProperty('details');
  });
});

describe('classifyError', () => {
  it('passes through existing LookinError unchanged', () => {
    const original = new LookinError('BRIDGE_DECODE_FAILED', 'decode fail');
    expect(classifyError(original)).toBe(original);
  });

  it('classifies correlator timeout', () => {
    const err = new Error('Request type=202 tag=5 timeout after 15000ms');
    const classified = classifyError(err);
    expect(classified.code).toBe('TRANSPORT_TIMEOUT');
    expect(classified.details).toEqual({ requestType: 202, tag: 5, timeoutMs: 15000 });
  });

  it('classifies ECONNREFUSED', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:47175');
    const classified = classifyError(err);
    expect(classified.code).toBe('TRANSPORT_REFUSED');
    expect(classified.details).toEqual({ host: '127.0.0.1', port: 47175 });
  });

  it('classifies ECONNRESET', () => {
    const classified = classifyError(new Error('read ECONNRESET'));
    expect(classified.code).toBe('TRANSPORT_CLOSED');
  });

  it('classifies connection closed', () => {
    const classified = classifyError(new Error('Connection closed'));
    expect(classified.code).toBe('TRANSPORT_CLOSED');
  });

  it('classifies session closed', () => {
    const classified = classifyError(new Error('Session is closed'));
    expect(classified.code).toBe('TRANSPORT_CLOSED');
  });

  it('classifies bridge decode failure', () => {
    const classified = classifyError(new Error('bridge decode failed (code 1): invalid data'));
    expect(classified.code).toBe('BRIDGE_DECODE_FAILED');
  });

  it('classifies bridge encode failure', () => {
    const classified = classifyError(new Error('bridge encode failed (code 1): invalid json'));
    expect(classified.code).toBe('BRIDGE_ENCODE_FAILED');
  });

  it('classifies unexpected response', () => {
    const classified = classifyError(new Error('Unexpected response: missing LookinHierarchyInfo'));
    expect(classified.code).toBe('PROTOCOL_UNEXPECTED_RESPONSE');
  });

  it('wraps unknown error as TRANSPORT_CLOSED', () => {
    const classified = classifyError(new Error('some unknown error'));
    expect(classified.code).toBe('TRANSPORT_CLOSED');
    expect(classified.message).toBe('some unknown error');
  });

  it('handles string error', () => {
    const classified = classifyError('raw string error');
    expect(classified).toBeInstanceOf(LookinError);
    expect(classified.message).toBe('raw string error');
  });
});

describe('errorResponse', () => {
  it('returns structured MCP content with code', () => {
    const err = new Error('Request type=200 tag=1 timeout after 5000ms');
    const resp = errorResponse(err);
    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe('text');
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.code).toBe('TRANSPORT_TIMEOUT');
    expect(parsed.error).toContain('timeout');
  });

  it('returns code for ECONNREFUSED', () => {
    const resp = errorResponse(new Error('connect ECONNREFUSED 127.0.0.1:19999'));
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.code).toBe('TRANSPORT_REFUSED');
    expect(parsed.details?.port).toBe(19999);
  });
});

describe('transport timeout structured error', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    resetAppSessionMock();
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  it('status tool returns TRANSPORT_TIMEOUT code on timeout', async () => {
    appSessionMock.mockImplementationOnce(() => ({
      ping: vi.fn().mockRejectedValue(new Error('Request type=200 tag=1 timeout after 5000ms')),
      close: vi.fn(),
    }));

    const pair = await setupMcpPair((s) =>
      registerStatusTool(s, { host: '127.0.0.1', port: 47164, transport: 'simulator' }),
    );
    client = pair.client;
    mcpServer = pair.server;

    const result = await client.callTool({ name: 'status' });
    const data = parseToolResult(result);

    expect(data.connected).toBe(false);
    expect(data.error).toContain('timeout');
    expect(data.code).toBe('TRANSPORT_TIMEOUT');
  });

  it('get_hierarchy returns TRANSPORT_TIMEOUT code on timeout', async () => {
    appSessionMock.mockImplementationOnce(() => ({
      request: vi.fn().mockRejectedValue(new Error('Request type=202 tag=1 timeout after 15000ms')),
      close: vi.fn(),
    }));

    const pair = await setupMcpPair((s) =>
      registerHierarchyTool(s, { host: '127.0.0.1', port: 47164, transport: 'simulator' }),
    );
    client = pair.client;
    mcpServer = pair.server;

    const result = await client.callTool({ name: 'get_hierarchy', arguments: {} });
    const data = parseToolResult(result);

    expect(data.error).toContain('timeout');
    expect(data.code).toBe('TRANSPORT_TIMEOUT');
  });
});

describe('connection refused structured error', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    resetAppSessionMock();
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  it('status tool returns TRANSPORT_REFUSED code when port unreachable', async () => {
    appSessionMock.mockImplementationOnce(() => ({
      ping: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:19998')),
      close: vi.fn(),
    }));

    const pair = await setupMcpPair((s) =>
      registerStatusTool(s, { host: '127.0.0.1', port: 19998, transport: 'simulator' }),
    );
    client = pair.client;
    mcpServer = pair.server;

    const result = await client.callTool({ name: 'status' });
    const data = parseToolResult(result);

    expect(data.connected).toBe(false);
    expect(data.code).toBe('TRANSPORT_REFUSED');
    expect(data.error).toContain('ECONNREFUSED');
  });

  it('get_hierarchy returns TRANSPORT_REFUSED code when port unreachable', async () => {
    appSessionMock.mockImplementationOnce(() => ({
      request: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:19998')),
      close: vi.fn(),
    }));

    const pair = await setupMcpPair((s) =>
      registerHierarchyTool(s, { host: '127.0.0.1', port: 19998, transport: 'simulator' }),
    );
    client = pair.client;
    mcpServer = pair.server;

    const result = await client.callTool({ name: 'get_hierarchy', arguments: {} });
    const data = parseToolResult(result);

    expect(data.code).toBe('TRANSPORT_REFUSED');
    expect(data.error).toContain('ECONNREFUSED');
  });

  it('get_view returns TRANSPORT_REFUSED code when port unreachable', async () => {
    // getView makes 2 requests (hierarchy + attr groups). Both must fail for TRANSPORT_REFUSED.
    appSessionMock.mockImplementation(() => ({
      request: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:19998')),
      close: vi.fn(),
    }));

    const pair = await setupMcpPair((s) =>
      registerGetViewTool(s, { host: '127.0.0.1', port: 19998, transport: 'simulator' }),
    );
    client = pair.client;
    mcpServer = pair.server;

    const result = await client.callTool({ name: 'get_view', arguments: { oid: 123 } });
    const data = parseToolResult(result);

    expect(data.code).toBe('TRANSPORT_REFUSED');
  });
});

describe('discovery failure structured error', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    resetAppSessionMock();
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  it('status returns DISCOVERY_NO_DEVICE when no endpoint and discovery fails', async () => {
    vi.spyOn(DeviceDiscovery.prototype, 'probeFirst').mockResolvedValueOnce(null);
    const { registerStatusTool: registerFn } = await import('../src/mcp/status-tool.js');
    mcpServer = new McpServer(
      { name: 'test', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerFn(mcpServer);

    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);

    const result = await client.callTool({ name: 'status' });
    const data = parseToolResult(result);

    expect(data.connected).toBe(false);
    expect(data.code).toBe('DISCOVERY_NO_DEVICE');
  });

  it('get_hierarchy returns DISCOVERY_NO_DEVICE when no endpoint found', async () => {
    vi.spyOn(DeviceDiscovery.prototype, 'probeFirst').mockResolvedValueOnce(null);
    const { registerHierarchyTool: registerFn } = await import('../src/mcp/hierarchy-tool.js');
    mcpServer = new McpServer(
      { name: 'test', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerFn(mcpServer);

    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);

    const result = await client.callTool({ name: 'get_hierarchy', arguments: {} });
    const data = parseToolResult(result);

    expect(data.code).toBe('DISCOVERY_NO_DEVICE');
  });
});
