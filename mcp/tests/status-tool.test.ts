import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/transport.js';
import { registerStatusTool } from '../src/status-tool.js';

/** Fixture: LookinConnectionResponseAttachment with serverVersion=7, appIsInBackground=false */
const PING_RESPONSE_B64 =
  'YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGkCwwdHlUkbnVsbNgNDg8QERITFBUWFxgZGhUYXxAQY3VycmVudERhdGFDb3VudF8QE2xvb2tpblNlcnZlclZlcnNpb25WJGNsYXNzUTBfEBFhcHBJc0luQmFja2dyb3VuZFExXmRhdGFUb3RhbENvdW50VWVycm9ygAIQB4ADgAAIEACAAoAAEAHSHyAhIlokY2xhc3NuYW1lWCRjbGFzc2VzXxAiTG9va2luQ29ubmVjdGlvblJlc3BvbnNlQXR0YWNobWVudKMjJCVfECJMb29raW5Db25uZWN0aW9uUmVzcG9uc2VBdHRhY2htZW50XxAaTG9va2luQ29ubmVjdGlvbkF0dGFjaG1lbnRYTlNPYmplY3QACAARABoAJAApADIANwBJAEwAUQBTAFgAXgBvAIIAmACfAKEAtQC3AMYAzADOANAA0gDUANUA1wDZANsA3QDiAO0A9gEbAR8BRAFhAAAAAAAAAgEAAAAAAAAAJgAAAAAAAAAAAAAAAAAAAWo=';

/**
 * Creates a mock LookinServer that responds to Type 200 (ping) frames.
 */
function createMockLookinServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
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
          buffer = buffer.subarray(totalSize);

          const payloadBuf = Buffer.from(PING_RESPONSE_B64, 'base64');
          socket.write(FrameEncoder.encode(type, tag, payloadBuf));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe('status MCP tool', () => {
  let mockServer: net.Server | null = null;
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
    if (mockServer) { mockServer.close(); mockServer = null; }
  });

  /** Helper to create a connected MCP client + server pair */
  async function setupMcpPair(mockPort: number) {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    // Register the status tool with a fixed endpoint pointing to our mock server
    registerStatusTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });

    client = new Client({ name: 'test-client', version: '0.1.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  it('status tool is listed with correct name', async () => {
    const { server, port } = await createMockLookinServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const statusTool = tools.find((t) => t.name === 'status');
    expect(statusTool).toBeDefined();
    expect(statusTool!.description).toContain('connection');
  });

  it('status returns connection health and protocol version', async () => {
    const { server, port } = await createMockLookinServer();
    mockServer = server;
    await setupMcpPair(port);

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
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    registerStatusTool(mcpServer, {
      host: '127.0.0.1',
      port: 19998, // unreachable
      transport: 'simulator' as const,
    });

    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client!.callTool({ name: 'status' });

    const text = (result.content as any)[0].text;
    const status = JSON.parse(text);
    expect(status.connected).toBe(false);
    expect(status.error).toBeDefined();
  });
});
