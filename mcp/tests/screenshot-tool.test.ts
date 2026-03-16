import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/transport.js';
import { registerGetScreenshotTool } from '../src/screenshot-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const SCREENSHOT_RESPONSE_B64: string = fixtures.screenshotResponse.base64;

/**
 * Mock server that responds to Type 203 (HierarchyDetails) with screenshot fixture.
 */
function createMockScreenshotServer(): Promise<{
  server: net.Server;
  port: number;
  getLastPayload: () => Buffer | null;
}> {
  return new Promise((resolve) => {
    let lastPayload: Buffer | null = null;
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.byteLength >= 16) {
          const type = buffer.readUInt32BE(4);
          const tag = buffer.readUInt32BE(8);
          const payloadSize = buffer.readUInt32BE(12);
          const totalSize = 16 + payloadSize;
          if (buffer.byteLength < totalSize) break;
          lastPayload = buffer.subarray(16, totalSize);
          buffer = buffer.subarray(totalSize);

          const payloadBuf = Buffer.from(SCREENSHOT_RESPONSE_B64, 'base64');
          socket.write(FrameEncoder.encode(type, tag, payloadBuf));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port, getLastPayload: () => lastPayload });
    });
  });
}

describe('get_screenshot MCP tool', () => {
  let mockServer: net.Server | null = null;
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
    if (mockServer) { mockServer.close(); mockServer = null; }
  });

  async function setupMcpPair(mockPort: number) {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    registerGetScreenshotTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  it('get_screenshot tool is listed with correct name and oid parameter', async () => {
    const { server, port } = await createMockScreenshotServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_screenshot');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('screenshot');
    const schema = tool!.inputSchema as any;
    expect(schema.properties).toHaveProperty('oid');
    expect(schema.required).toContain('oid');
  });

  it('get_screenshot returns base64 PNG image with mime type', async () => {
    const { server, port } = await createMockScreenshotServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'get_screenshot',
      arguments: { oid: 42 },
    });
    expect(result.isError).toBeFalsy();

    const content = result.content as any[];
    // Should have an image content item
    const imageContent = content.find((c) => c.type === 'image');
    expect(imageContent).toBeDefined();
    expect(imageContent.mimeType).toBe('image/png');
    // Base64 PNG data should start with PNG header bytes
    const pngBuf = Buffer.from(imageContent.data, 'base64');
    expect(pngBuf[0]).toBe(0x89);
    expect(pngBuf[1]).toBe(0x50); // 'P'
    expect(pngBuf[2]).toBe(0x4e); // 'N'
    expect(pngBuf[3]).toBe(0x47); // 'G'
  });

  it('get_screenshot includes metadata text with oid and dimensions', async () => {
    const { server, port } = await createMockScreenshotServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'get_screenshot',
      arguments: { oid: 42 },
    });
    expect(result.isError).toBeFalsy();

    const content = result.content as any[];
    const textContent = content.find((c) => c.type === 'text');
    expect(textContent).toBeDefined();
    const meta = JSON.parse(textContent.text);
    expect(meta.oid).toBe(42);
    expect(meta.frame).toBeDefined();
    expect(meta.bounds).toBeDefined();
  });

  it('get_screenshot sends Type 203 request with encoded task package payload', async () => {
    const { server, port, getLastPayload } = await createMockScreenshotServer();
    mockServer = server;
    await setupMcpPair(port);

    await client!.callTool({
      name: 'get_screenshot',
      arguments: { oid: 42 },
    });

    const payload = getLastPayload();
    expect(payload).not.toBeNull();
    expect(payload!.byteLength).toBeGreaterThan(0);
  });

  it('get_screenshot reports error when server is unreachable', async () => {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    registerGetScreenshotTool(mcpServer, {
      host: '127.0.0.1',
      port: 19997,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);

    const result = await client!.callTool({
      name: 'get_screenshot',
      arguments: { oid: 42 },
    });
    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });
});
