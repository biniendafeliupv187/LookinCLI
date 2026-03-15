import * as net from 'node:net';
import { UsbmuxdClient } from './usbmuxd.js';

/** A candidate endpoint to connect to a LookinServer instance */
export interface DeviceEndpoint {
  host: string;
  port: number;
  transport: 'simulator' | 'usb';
  /** usbmuxd device ID — required for USB transport */
  deviceID?: number;
}

/** Simulator ports: 47164-47169 */
const SIMULATOR_PORT_START = 47164;
const SIMULATOR_PORT_END = 47169;

/** USB ports: 47175-47179 */
const USB_PORT_START = 47175;
const USB_PORT_END = 47179;

/** Provides simulator localhost endpoints */
export class SimulatorEndpointProvider {
  getEndpoints(): DeviceEndpoint[] {
    const endpoints: DeviceEndpoint[] = [];
    for (let port = SIMULATOR_PORT_START; port <= SIMULATOR_PORT_END; port++) {
      endpoints.push({ host: '127.0.0.1', port, transport: 'simulator' });
    }
    return endpoints;
  }
}

/** Provides USB mux endpoints by querying usbmuxd for attached devices */
export class USBMuxEndpointProvider {
  private usbmuxd: UsbmuxdClient;

  constructor(socketPath?: string) {
    this.usbmuxd = new UsbmuxdClient(socketPath);
  }

  /**
   * Static helper: returns the default USB port range endpoints without device IDs.
   * Used for backward-compatible tests.
   */
  getEndpoints(): DeviceEndpoint[] {
    const endpoints: DeviceEndpoint[] = [];
    for (let port = USB_PORT_START; port <= USB_PORT_END; port++) {
      endpoints.push({ host: '127.0.0.1', port, transport: 'usb' });
    }
    return endpoints;
  }

  /**
   * Discover real USB devices via usbmuxd and return endpoints with deviceID.
   */
  async discoverEndpoints(waitMs = 500): Promise<DeviceEndpoint[]> {
    try {
      const devices = await this.usbmuxd.listDevices(waitMs);
      this.usbmuxd.close();
      const endpoints: DeviceEndpoint[] = [];
      for (const dev of devices) {
        for (let port = USB_PORT_START; port <= USB_PORT_END; port++) {
          endpoints.push({
            host: '127.0.0.1',
            port,
            transport: 'usb',
            deviceID: dev.deviceID,
          });
        }
      }
      return endpoints;
    } catch {
      // usbmuxd not available (e.g. Linux, CI)
      return [];
    }
  }
}

/** Composite discovery: USB-first, then simulator */
export class DeviceDiscovery {
  private usb = new USBMuxEndpointProvider();
  private simulator = new SimulatorEndpointProvider();

  /** Get all candidate endpoints (static, no usbmuxd query), USB first */
  getAllEndpoints(): DeviceEndpoint[] {
    return [...this.usb.getEndpoints(), ...this.simulator.getEndpoints()];
  }

  /**
   * Discover and probe endpoints. For USB, queries usbmuxd for real devices
   * and probes via usbmuxd tunnel. For simulator, probes via TCP.
   * Returns the first reachable endpoint, or null.
   */
  async probeFirst(timeoutMs: number): Promise<DeviceEndpoint | null> {
    // 1. Try USB devices via usbmuxd
    const usbEndpoints = await this.usb.discoverEndpoints(500);
    for (const ep of usbEndpoints) {
      if (await this.usbProbe(ep, timeoutMs)) {
        return ep;
      }
    }

    // 2. Try simulator ports via TCP
    for (const ep of this.simulator.getEndpoints()) {
      if (await this.tcpProbe(ep, timeoutMs)) {
        return ep;
      }
    }

    return null;
  }

  /** Probe a USB endpoint by attempting a usbmuxd tunnel + PeerTalk ping */
  private async usbProbe(ep: DeviceEndpoint, timeoutMs: number): Promise<boolean> {
    if (ep.deviceID == null) return false;
    const client = new UsbmuxdClient();
    try {
      const socket = await client.connect(ep.deviceID, ep.port, timeoutMs);
      socket.destroy();
      return true;
    } catch {
      return false;
    }
  }

  private tcpProbe(ep: DeviceEndpoint, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeoutMs);

      socket.connect(ep.port, ep.host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(false);
      });
    });
  }
}
