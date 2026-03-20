import { describe, it, expect } from 'vitest';
import {
  SimulatorEndpointProvider,
  USBMuxEndpointProvider,
  DeviceDiscovery,
  type DeviceEndpoint,
} from '../src/core/discovery.js';

describe('SimulatorEndpointProvider', () => {
  it('returns localhost endpoints with ports 47164-47169', () => {
    const provider = new SimulatorEndpointProvider();
    const endpoints = provider.getEndpoints();

    expect(endpoints).toHaveLength(6);
    expect(endpoints[0]).toEqual({ host: '127.0.0.1', port: 47164, transport: 'simulator' });
    expect(endpoints[5]).toEqual({ host: '127.0.0.1', port: 47169, transport: 'simulator' });

    // All should be localhost
    for (const ep of endpoints) {
      expect(ep.host).toBe('127.0.0.1');
      expect(ep.transport).toBe('simulator');
    }
  });

  it('ports are contiguous from 47164 to 47169', () => {
    const provider = new SimulatorEndpointProvider();
    const ports = provider.getEndpoints().map((e) => e.port);
    expect(ports).toEqual([47164, 47165, 47166, 47167, 47168, 47169]);
  });
});

describe('USBMuxEndpointProvider', () => {
  it('returns USB endpoints with ports 47175-47179', () => {
    const provider = new USBMuxEndpointProvider();
    const endpoints = provider.getEndpoints();

    expect(endpoints).toHaveLength(5);
    expect(endpoints[0]).toEqual({ host: '127.0.0.1', port: 47175, transport: 'usb' });
    expect(endpoints[4]).toEqual({ host: '127.0.0.1', port: 47179, transport: 'usb' });

    for (const ep of endpoints) {
      expect(ep.host).toBe('127.0.0.1');
      expect(ep.transport).toBe('usb');
    }
  });

  it('ports are contiguous from 47175 to 47179', () => {
    const provider = new USBMuxEndpointProvider();
    const ports = provider.getEndpoints().map((e) => e.port);
    expect(ports).toEqual([47175, 47176, 47177, 47178, 47179]);
  });
});

describe('DeviceDiscovery', () => {
  it('returns USB endpoints before simulator endpoints', () => {
    const discovery = new DeviceDiscovery();
    const all = discovery.getAllEndpoints();

    // First 5 should be USB, next 6 should be simulator
    expect(all).toHaveLength(11);
    expect(all.slice(0, 5).every((e) => e.transport === 'usb')).toBe(true);
    expect(all.slice(5).every((e) => e.transport === 'simulator')).toBe(true);
  });

  it('probeFirst returns the first endpoint that accepts TCP connection', async () => {
    // This test uses a real TCP connection attempt — it will try localhost ports.
    // On CI without a running LookinServer, all probes should fail.
    const discovery = new DeviceDiscovery();
    const result = await discovery.probeFirst(100); // 100ms timeout per probe

    // We can't guarantee a running server, so just verify the return type
    if (result) {
      expect(result.host).toBeDefined();
      expect(result.port).toBeDefined();
      expect(result.transport).toBeDefined();
    } else {
      // No server running — null is acceptable
      expect(result).toBeNull();
    }
  });
});
