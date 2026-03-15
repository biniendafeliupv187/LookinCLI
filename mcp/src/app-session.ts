import * as net from 'node:net';
import { FrameEncoder, FrameDecoder } from './transport.js';
import { RequestCorrelator } from './correlator.js';
import { BridgeClient } from './bridge-client.js';
import { UsbmuxdClient } from './usbmuxd.js';
import type { DeviceEndpoint } from './discovery.js';

/** Lookin request type constants */
export const LookinRequestType = {
  Ping: 200,
  App: 201,
  Hierarchy: 202,
  HierarchyDetails: 203,
  InbuiltAttrModification: 204,
  AttrModificationPatch: 205,
  InvokeMethod: 206,
  FetchObject: 207,
  FetchImageViewImage: 208,
  ModifyRecognizerEnable: 209,
  AllAttrGroups: 210,
  AllSelectorNames: 213,
  CustomAttrModification: 214,
} as const;

/**
 * Manages a TCP connection to a single LookinServer instance.
 * Handles frame encoding/decoding, request correlation, and bridge decode.
 */
export class AppSession {
  private endpoint: DeviceEndpoint;
  private socket: net.Socket | null = null;
  private decoder = new FrameDecoder();
  private correlator = new RequestCorrelator();
  private bridge = new BridgeClient();
  private connected = false;
  private closed = false;

  constructor(endpoint: DeviceEndpoint, bridgeClient?: BridgeClient) {
    this.endpoint = endpoint;
    if (bridgeClient) this.bridge = bridgeClient;

    this.decoder.onFrame = (frame) => {
      this.correlator.resolve(frame.type, frame.tag, frame.payload);
    };
  }

  /** Ensure TCP connection is established */
  private connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Session is closed'));
    }
    if (this.connected && this.socket) {
      return Promise.resolve();
    }

    if (this.endpoint.transport === 'usb' && this.endpoint.deviceID != null) {
      return this.connectViaUsbmuxd();
    }
    return this.connectViaTcp();
  }

  /** Direct TCP connection (simulator) */
  private connectViaTcp(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      this.socket.connect(this.endpoint.port, this.endpoint.host, () => {
        this.connected = true;
        resolve();
      });

      this.socket.on('data', (data) => {
        this.decoder.push(data);
      });

      this.socket.on('error', (err) => {
        this.connected = false;
        this.correlator.rejectAll(err);
        reject(err);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.correlator.rejectAll(new Error('Connection closed'));
      });
    });
  }

  /** Connect via usbmuxd tunnel (USB real device) */
  private async connectViaUsbmuxd(): Promise<void> {
    const client = new UsbmuxdClient();
    const socket = await client.connect(this.endpoint.deviceID!, this.endpoint.port, 5000);

    this.socket = socket;
    this.connected = true;

    socket.on('data', (data) => {
      this.decoder.push(data);
    });

    socket.on('error', (err) => {
      this.connected = false;
      this.correlator.rejectAll(err);
    });

    socket.on('close', () => {
      this.connected = false;
      this.correlator.rejectAll(new Error('Connection closed'));
    });
  }

  /**
   * Send a raw request and wait for the response payload.
   * Connects automatically if not already connected.
   */
  async request(type: number, payload?: Buffer, timeoutMs = 10000): Promise<Buffer> {
    await this.connect();
    const tag = this.correlator.nextTag();
    const frame = FrameEncoder.encode(type, tag, payload);
    const promise = this.correlator.register(type, tag, timeoutMs);
    this.socket!.write(frame);
    return promise;
  }

  /**
   * Send a Ping (Type 200) and decode the response via the Swift bridge.
   * Returns the decoded LookinConnectionResponseAttachment as JSON.
   */
  async ping(timeoutMs = 5000): Promise<any> {
    const responseBuf = await this.request(LookinRequestType.Ping, undefined, timeoutMs);
    const base64 = responseBuf.toString('base64');
    return this.bridge.decode(base64);
  }

  /** Close the TCP connection and clean up */
  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
