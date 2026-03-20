import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import { AppSession } from '../src/core/app-session.js';
import { FrameEncoder } from '../src/core/transport.js';
import { BridgeClient } from '../src/core/bridge-client.js';

/**
 * Creates a minimal TCP server that speaks the Peertalk frame protocol.
 * Responds to Type 200 (ping) with a LookinConnectionResponseAttachment.
 */
function createMockLookinServer(responseBase64: string): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);

      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        // Wait for full header (16 bytes)
        while (buffer.byteLength >= 16) {
          const type = buffer.readUInt32BE(4);
          const tag = buffer.readUInt32BE(8);
          const payloadSize = buffer.readUInt32BE(12);
          const totalSize = 16 + payloadSize;

          if (buffer.byteLength < totalSize) break;

          // Consume the frame
          buffer = buffer.subarray(totalSize);

          // Respond with the given base64 as payload
          const payloadBuf = Buffer.from(responseBase64, 'base64');
          const responseFrame = FrameEncoder.encode(type, tag, payloadBuf);
          socket.write(responseFrame);
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe('AppSession', () => {
  let mockServer: net.Server | null = null;

  afterEach(() => {
    if (mockServer) {
      mockServer.close();
      mockServer = null;
    }
  });

  it('ping sends Type 200 and returns decoded response', async () => {
    // Generate a fixture for the ping response
    const { server, port } = await createMockLookinServer(
      // This is the connectionResponse fixture base64 from bridge-fixtures.json
      // (LookinConnectionResponseAttachment with serverVersion=7)
      'YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGkCwwdHlUkbnVsbNgNDg8QERITFBUWFxgZGhUYXxAQY3VycmVudERhdGFDb3VudF8QE2xvb2tpblNlcnZlclZlcnNpb25WJGNsYXNzUTBfEBFhcHBJc0luQmFja2dyb3VuZFExXmRhdGFUb3RhbENvdW50VWVycm9ygAIQB4ADgAAIEACAAoAAEAHSHyAhIlokY2xhc3NuYW1lWCRjbGFzc2VzXxAiTG9va2luQ29ubmVjdGlvblJlc3BvbnNlQXR0YWNobWVudKMjJCVfECJMb29raW5Db25uZWN0aW9uUmVzcG9uc2VBdHRhY2htZW50XxAaTG9va2luQ29ubmVjdGlvbkF0dGFjaG1lbnRYTlNPYmplY3QACAARABoAJAApADIANwBJAEwAUQBTAFgAXgBvAIIAmACfAKEAtQC3AMYAzADOANAA0gDUANUA1wDZANsA3QDiAO0A9gEbAR8BRAFhAAAAAAAAAgEAAAAAAAAAJgAAAAAAAAAAAAAAAAAAAWo=',
    );
    mockServer = server;

    const session = new AppSession({
      host: '127.0.0.1',
      port,
      transport: 'simulator',
    });

    try {
      const result = await session.ping();

      expect(result['$class']).toBe('LookinConnectionResponseAttachment');
      expect(result.lookinServerVersion).toBe(7);
      expect(result.appIsInBackground).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('ping rejects when server is unreachable', async () => {
    const session = new AppSession({
      host: '127.0.0.1',
      port: 19999, // No server here
      transport: 'simulator',
    });

    await expect(session.ping(500)).rejects.toThrow();
    await session.close();
  });

  it('close cleans up TCP connection', async () => {
    const { server, port } = await createMockLookinServer(
      'YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGkCwwdHlUkbnVsbNgNDg8QERITFBUWFxgZGhUYXxAQY3VycmVudERhdGFDb3VudF8QE2xvb2tpblNlcnZlclZlcnNpb25WJGNsYXNzUTBfEBFhcHBJc0luQmFja2dyb3VuZFExXmRhdGFUb3RhbENvdW50VWVycm9ygAIQB4ADgAAIEACAAoAAEAHSHyAhIlokY2xhc3NuYW1lWCRjbGFzc2VzXxAiTG9va2luQ29ubmVjdGlvblJlc3BvbnNlQXR0YWNobWVudKMjJCVfECJMb29raW5Db25uZWN0aW9uUmVzcG9uc2VBdHRhY2htZW50XxAaTG9va2luQ29ubmVjdGlvbkF0dGFjaG1lbnRYTlNPYmplY3QACAARABoAJAApADIANwBJAEwAUQBTAFgAXgBvAIIAmACfAKEAtQC3AMYAzADOANAA0gDUANUA1wDZANsA3QDiAO0A9gEbAR8BRAFhAAAAAAAAAgEAAAAAAAAAJgAAAAAAAAAAAAAAAAAAAWo=',
    );
    mockServer = server;

    const session = new AppSession({
      host: '127.0.0.1',
      port,
      transport: 'simulator',
    });

    // Connect by doing a ping
    await session.ping();
    await session.close();

    // After close, ping should fail (connection closed)
    await expect(session.ping(500)).rejects.toThrow();
  });
});
