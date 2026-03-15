import * as net from 'node:net';
import * as plist from './plist.js';

// --- usbmuxd packet constants ---

const USBMUX_PROTOCOL_PLIST = 1;
const USBMUX_TYPE_PLIST_PAYLOAD = 8;
const USBMUX_HEADER_SIZE = 16;

// Reply codes
const USBMUX_REPLY_OK = 0;
// const USBMUX_REPLY_BAD_COMMAND = 1;
// const USBMUX_REPLY_BAD_DEVICE = 2;
const USBMUX_REPLY_CONNECTION_REFUSED = 3;
// const USBMUX_REPLY_BAD_VERSION = 6;

const REPLY_ERROR_MESSAGES: Record<number, string> = {
  1: 'illegal command',
  2: 'unknown device',
  3: 'connection refused',
  6: 'invalid version',
};

// --- Packet encoding/decoding ---

/**
 * Swap bytes of a uint16 port number (host ↔ network byte order).
 * usbmuxd expects port in network byte order packed into a uint32.
 */
export function swapPort(port: number): number {
  return ((port << 8) & 0xFF00) | ((port >> 8) & 0xFF);
}

/**
 * Encode a usbmuxd packet: 16-byte LE header + XML plist payload.
 */
export function encodeUsbmuxPacket(
  protocol: number,
  type: number,
  tag: number,
  payload: Record<string, any>,
): Buffer {
  const xmlStr = plist.toXml(payload);
  const xmlBuf = Buffer.from(xmlStr, 'utf8');
  const totalSize = USBMUX_HEADER_SIZE + xmlBuf.byteLength;

  const buf = Buffer.alloc(totalSize);
  buf.writeUInt32LE(totalSize, 0);
  buf.writeUInt32LE(protocol, 4);
  buf.writeUInt32LE(type, 8);
  buf.writeUInt32LE(tag, 12);
  xmlBuf.copy(buf, USBMUX_HEADER_SIZE);

  return buf;
}

/**
 * Parse a complete usbmuxd packet buffer into header + plist payload.
 * Returns null if the buffer is incomplete.
 */
export function parseUsbmuxPacket(
  buf: Buffer,
): { protocol: number; type: number; tag: number; payload: any } | null {
  if (buf.byteLength < USBMUX_HEADER_SIZE) return null;

  const size = buf.readUInt32LE(0);
  if (buf.byteLength < size) return null;

  const protocol = buf.readUInt32LE(4);
  const type = buf.readUInt32LE(8);
  const tag = buf.readUInt32LE(12);

  let payload: any = {};
  if (size > USBMUX_HEADER_SIZE) {
    const xmlBuf = buf.subarray(USBMUX_HEADER_SIZE, size);
    payload = plist.fromXml(xmlBuf.toString('utf8'));
  }

  return { protocol, type, tag, payload };
}

// --- Device type ---

export interface UsbmuxdDevice {
  deviceID: number;
  serialNumber: string;
  connectionType: string;
}

// --- Client ---

const USBMUXD_SOCKET_PATH = '/var/run/usbmuxd';

/**
 * Node.js client for the macOS usbmuxd Unix socket.
 * Supports device listing (Listen) and TCP tunnel creation (Connect).
 */
export class UsbmuxdClient {
  private socketPath: string;
  private tag = 0;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? USBMUXD_SOCKET_PATH;
  }

  private nextTag(): number {
    return ++this.tag;
  }

  private listenSocket: net.Socket | null = null;

  /**
   * Open a Listen session and collect device Attached broadcasts for `waitMs`.
   * Returns all devices seen during that window.
   */
  async listDevices(waitMs = 1000): Promise<UsbmuxdDevice[]> {
    const socket = net.createConnection(this.socketPath);
    this.listenSocket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    const devices: UsbmuxdDevice[] = [];
    const tag = this.nextTag();

    // Send Listen request
    const pkt = encodeUsbmuxPacket(
      USBMUX_PROTOCOL_PLIST,
      USBMUX_TYPE_PLIST_PAYLOAD,
      tag,
      { MessageType: 'Listen' },
    );
    socket.write(pkt);

    return new Promise<UsbmuxdDevice[]>((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let listenAcked = false;
      const timer = setTimeout(() => {
        cleanup();
        resolve(devices);
      }, waitMs);

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeAllListeners('data');
        socket.removeAllListeners('error');
      };

      socket.on('error', (err) => {
        cleanup();
        reject(err);
      });

      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.byteLength >= USBMUX_HEADER_SIZE) {
          const size = buffer.readUInt32LE(0);
          if (buffer.byteLength < size) break;

          const pktBuf = buffer.subarray(0, size);
          buffer = buffer.subarray(size);

          const parsed = parseUsbmuxPacket(pktBuf);
          if (!parsed) continue;

          if (!listenAcked && parsed.tag === tag) {
            // Listen response
            const replyCode = parsed.payload?.Number ?? -1;
            if (replyCode !== USBMUX_REPLY_OK) {
              cleanup();
              reject(new Error(`Listen failed: ${REPLY_ERROR_MESSAGES[replyCode] ?? 'unknown error'}`));
              return;
            }
            listenAcked = true;
            continue;
          }

          // Broadcast (tag=0)
          if (parsed.payload?.MessageType === 'Attached') {
            const props = parsed.payload.Properties ?? {};
            devices.push({
              deviceID: parsed.payload.DeviceID ?? props.DeviceID,
              serialNumber: props.SerialNumber ?? '',
              connectionType: props.ConnectionType ?? 'USB',
            });
          }
        }
      });
    });
  }

  /**
   * Close the listen socket if one is open.
   */
  close(): void {
    if (this.listenSocket) {
      this.listenSocket.destroy();
      this.listenSocket = null;
    }
  }

  /**
   * Open a new usbmuxd connection and request a TCP tunnel to the given
   * device + port. On success, returns the raw Socket which can be used
   * for PeerTalk frame communication.
   */
  async connect(deviceID: number, port: number, timeoutMs = 5000): Promise<net.Socket> {
    const socket = net.createConnection(this.socketPath);

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    const tag = this.nextTag();
    const pkt = encodeUsbmuxPacket(
      USBMUX_PROTOCOL_PLIST,
      USBMUX_TYPE_PLIST_PAYLOAD,
      tag,
      {
        MessageType: 'Connect',
        DeviceID: deviceID,
        PortNumber: swapPort(port),
      },
    );

    socket.write(pkt);

    return new Promise<net.Socket>((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => {
        cleanup();
        socket.destroy();
        reject(new Error(`usbmuxd connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeAllListeners('data');
        socket.removeAllListeners('error');
      };

      socket.on('error', (err) => {
        cleanup();
        reject(err);
      });

      const onData = (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);

        if (buffer.byteLength < USBMUX_HEADER_SIZE) return;
        const size = buffer.readUInt32LE(0);
        if (buffer.byteLength < size) return;

        const pktBuf = buffer.subarray(0, size);
        const leftover = buffer.subarray(size);

        const parsed = parseUsbmuxPacket(pktBuf);
        cleanup();

        if (!parsed) {
          socket.destroy();
          reject(new Error('Failed to parse usbmuxd response'));
          return;
        }

        const replyCode = parsed.payload?.Number ?? -1;
        if (replyCode !== USBMUX_REPLY_OK) {
          socket.destroy();
          reject(new Error(REPLY_ERROR_MESSAGES[replyCode] ?? `usbmuxd error ${replyCode}`));
          return;
        }

        // Success — socket is now a raw TCP tunnel to the device.
        // If there's leftover data, push it back.
        if (leftover.byteLength > 0) {
          socket.unshift(leftover);
        }

        resolve(socket);
      };

      socket.on('data', onData);
    });
  }
}
