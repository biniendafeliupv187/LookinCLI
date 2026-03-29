import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { FrameEncoder } from '../src/core/transport.js';

const socketState = {
  mode: 'success' as 'success' | 'refused' | 'hang',
  responseBase64:
    'YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGkCwwdHlUkbnVsbNgNDg8QERITFBUWFxgZGhUYXxAQY3VycmVudERhdGFDb3VudF8QE2xvb2tpblNlcnZlclZlcnNpb25WJGNsYXNzUTBfEBFhcHBJc0luQmFja2dyb3VuZFExXmRhdGFUb3RhbENvdW50VWVycm9ygAIQB4ADgAAIEACAAoAAEAHSHyAhIlokY2xhc3NuYW1lWCRjbGFzc2VzXxAiTG9va2luQ29ubmVjdGlvblJlc3BvbnNlQXR0YWNobWVudKMjJCVfECJMb29raW5Db25uZWN0aW9uUmVzcG9uc2VBdHRhY2htZW50XxAaTG9va2luQ29ubmVjdGlvbkF0dGFjaG1lbnRYTlNPYmplY3QACAARABoAJAApADIANwBJAEwAUQBTAFgAXgBvAIIAmACfAKEAtQC3AMYAzADOANAA0gDUANUA1wDZANsA3QDiAO0A9gEbAR8BRAFhAAAAAAAAAgEAAAAAAAAAJgAAAAAAAAAAAAAAAAAAAWo=',
};

class FakeSocket extends EventEmitter {
  connect(_port: number, _host: string, onConnect?: () => void): this {
    if (socketState.mode === 'success') {
      setTimeout(() => onConnect?.(), 0);
    } else if (socketState.mode === 'refused') {
      setTimeout(() => this.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:19999')), 0);
    }
    return this;
  }

  write(frame: Buffer): boolean {
    if (socketState.mode !== 'success') {
      return true;
    }

    const type = frame.readUInt32BE(4);
    const tag = frame.readUInt32BE(8);
    const payloadBuf = Buffer.from(socketState.responseBase64, 'base64');
    setTimeout(() => {
      this.emit('data', FrameEncoder.encode(type, tag, payloadBuf));
    }, 0);
    return true;
  }

  destroy(): void {
    this.emit('close');
  }
}

vi.mock('node:net', () => ({
  Socket: FakeSocket,
}));

const bridgeDecodeMock = vi.fn().mockResolvedValue({
  $class: 'LookinConnectionResponseAttachment',
  lookinServerVersion: 7,
  appIsInBackground: false,
});

describe('AppSession', () => {
  afterEach(() => {
    socketState.mode = 'success';
    bridgeDecodeMock.mockClear();
  });

  it('ping sends Type 200 and returns decoded response', async () => {
    const { AppSession } = await import('../src/core/app-session.js');
    const session = new AppSession(
      { host: '127.0.0.1', port: 47164, transport: 'simulator' },
      { decode: bridgeDecodeMock } as any,
    );

    try {
      const result = await session.ping();
      expect(result['$class']).toBe('LookinConnectionResponseAttachment');
      expect(result.lookinServerVersion).toBe(7);
      expect(result.appIsInBackground).toBe(false);
      expect(bridgeDecodeMock).toHaveBeenCalledTimes(1);
    } finally {
      await session.close();
    }
  });

  it('ping rejects when server is unreachable', async () => {
    socketState.mode = 'refused';
    const { AppSession } = await import('../src/core/app-session.js');
    const session = new AppSession(
      { host: '127.0.0.1', port: 19999, transport: 'simulator' },
      { decode: bridgeDecodeMock } as any,
    );

    await expect(session.ping(500)).rejects.toThrow('ECONNREFUSED');
    await session.close();
  });

  it('connectViaTcp rejects with timeout error when TCP handshake hangs', async () => {
    socketState.mode = 'hang';
    const { AppSession } = await import('../src/core/app-session.js');
    const session = new AppSession(
      { host: '192.0.2.1', port: 47175, transport: 'simulator' },
      { decode: bridgeDecodeMock } as any,
      { connectTimeoutMs: 300 },
    );

    try {
      const start = Date.now();
      await expect(session.ping(10_000)).rejects.toThrow(/connect timeout/i);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
    } finally {
      await session.close();
    }
  }, 10_000);

  it('close cleans up TCP connection', async () => {
    const { AppSession } = await import('../src/core/app-session.js');
    const session = new AppSession(
      { host: '127.0.0.1', port: 47164, transport: 'simulator' },
      { decode: bridgeDecodeMock } as any,
    );

    await session.ping();
    await session.close();

    await expect(session.ping(500)).rejects.toThrow('Session is closed');
  });
});
