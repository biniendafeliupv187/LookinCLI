import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  UsbmuxdClient,
  type UsbmuxdDevice,
  encodeUsbmuxPacket,
  parseUsbmuxPacket,
  swapPort,
} from '../src/core/usbmuxd.js';

describe('usbmuxd packet encoding', () => {
  it('swapPort converts host port to network byte order uint16', () => {
    // port 47175 = 0xB847 → swap → 0x47B8
    expect(swapPort(47175)).toBe(0x47B8);
    expect(swapPort(80)).toBe(0x5000); // 80 = 0x0050 → swap → 0x5000
    expect(swapPort(swapPort(47175))).toBe(47175); // round-trip
  });

  it('encodeUsbmuxPacket creates correct header + XML plist payload', () => {
    const plist = { MessageType: 'Listen' };
    const buf = encodeUsbmuxPacket(1, 8, 1, plist);

    // First 4 bytes: total size (LE)
    const size = buf.readUInt32LE(0);
    expect(size).toBe(buf.byteLength);

    // protocol=1 (plist), type=8 (PlistPayload), tag=1
    expect(buf.readUInt32LE(4)).toBe(1);  // protocol
    expect(buf.readUInt32LE(8)).toBe(8);  // type
    expect(buf.readUInt32LE(12)).toBe(1); // tag

    // Payload is XML plist
    const payload = buf.subarray(16).toString('utf8');
    expect(payload).toContain('<?xml');
    expect(payload).toContain('Listen');
  });

  it('parseUsbmuxPacket parses header and plist body', () => {
    const plist = { MessageType: 'Result', Number: 0 };
    const buf = encodeUsbmuxPacket(1, 8, 42, plist);

    const parsed = parseUsbmuxPacket(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.protocol).toBe(1);
    expect(parsed!.type).toBe(8);
    expect(parsed!.tag).toBe(42);
    expect(parsed!.payload.MessageType).toBe('Result');
    expect(parsed!.payload.Number).toBe(0);
  });

  it('parseUsbmuxPacket returns null for incomplete buffer', () => {
    const buf = Buffer.alloc(8); // too small for a header
    expect(parseUsbmuxPacket(buf)).toBeNull();
  });
});

describe('UsbmuxdClient with mock usbmuxd', () => {
  let socketPath: string;
  let mockServer: net.Server;

  beforeEach(async () => {
    // Create a temp Unix socket
    socketPath = path.join(os.tmpdir(), `mock-usbmuxd-${process.pid}-${Date.now()}.sock`);
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  });

  afterEach(() => {
    if (mockServer) mockServer.close();
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  });

  function startMockUsbmuxd(handler: (socket: net.Socket, packet: any, tag: number) => void): Promise<void> {
    return new Promise((resolve) => {
      mockServer = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        socket.on('data', (data) => {
          buffer = Buffer.concat([buffer, data]);
          // Try to parse a complete packet
          while (buffer.byteLength >= 16) {
            const size = buffer.readUInt32LE(0);
            if (buffer.byteLength < size) break;
            const pktBuf = buffer.subarray(0, size);
            buffer = buffer.subarray(size);
            const parsed = parseUsbmuxPacket(pktBuf);
            if (parsed) {
              handler(socket, parsed.payload, parsed.tag);
            }
          }
        });
      });
      mockServer.listen(socketPath, () => resolve());
    });
  }

  function sendResponse(socket: net.Socket, tag: number, payload: Record<string, any>) {
    const buf = encodeUsbmuxPacket(1, 8, tag, payload);
    socket.write(buf);
  }

  it('listDevices returns attached devices', async () => {
    await startMockUsbmuxd((socket, pkt, tag) => {
      if (pkt.MessageType === 'Listen') {
        // Send OK response
        sendResponse(socket, tag, { MessageType: 'Result', Number: 0 });
        // Broadcast an Attached device
        sendResponse(socket, 0, {
          MessageType: 'Attached',
          DeviceID: 42,
          Properties: {
            ConnectionType: 'USB',
            DeviceID: 42,
            SerialNumber: 'ABC123',
          },
        });
      }
    });

    const client = new UsbmuxdClient(socketPath);
    const devices = await client.listDevices(500);
    client.close();

    expect(devices.length).toBeGreaterThanOrEqual(1);
    expect(devices[0].deviceID).toBe(42);
    expect(devices[0].serialNumber).toBe('ABC123');
  });

  it('connect returns a TCP socket tunneled to device port', async () => {
    const TEST_DATA = 'hello from device';

    await startMockUsbmuxd((socket, pkt, tag) => {
      if (pkt.MessageType === 'Connect') {
        // Verify port is in network byte order
        expect(pkt.DeviceID).toBe(42);
        // Send success
        sendResponse(socket, tag, { MessageType: 'Result', Number: 0 });
        // After connect response, the socket becomes a raw TCP tunnel
        // Send some raw data as if the device is responding
        setTimeout(() => socket.write(TEST_DATA), 50);
      }
    });

    const client = new UsbmuxdClient(socketPath);
    const tunnelSocket = await client.connect(42, 47175, 2000);

    const received = await new Promise<string>((resolve) => {
      tunnelSocket.once('data', (data) => resolve(data.toString()));
    });

    expect(received).toBe(TEST_DATA);
    tunnelSocket.destroy();
  });

  it('connect rejects on connection refused', async () => {
    await startMockUsbmuxd((socket, pkt, tag) => {
      if (pkt.MessageType === 'Connect') {
        sendResponse(socket, tag, { MessageType: 'Result', Number: 3 }); // ConnectionRefused
      }
    });

    const client = new UsbmuxdClient(socketPath);
    await expect(client.connect(42, 47175, 2000)).rejects.toThrow('connection refused');
  });

  it('listDevices returns empty array when no devices attached', async () => {
    await startMockUsbmuxd((socket, pkt, tag) => {
      if (pkt.MessageType === 'Listen') {
        sendResponse(socket, tag, { MessageType: 'Result', Number: 0 });
        // No device broadcast — just silence
      }
    });

    const client = new UsbmuxdClient(socketPath);
    const devices = await client.listDevices(300);
    client.close();

    expect(devices).toEqual([]);
  });

  it('connect rejects on timeout', async () => {
    await startMockUsbmuxd((_socket, _pkt, _tag) => {
      // Never respond
    });

    const client = new UsbmuxdClient(socketPath);
    await expect(client.connect(42, 47175, 300)).rejects.toThrow();
  });
});
