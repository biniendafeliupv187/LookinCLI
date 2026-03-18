#!/usr/bin/env node
/**
 * 诊断 discovery 流程：listDevices → usbmuxd connect → TCP probe
 */
import { UsbmuxdClient } from '../dist/usbmuxd.js';
import { DeviceDiscovery } from '../dist/discovery.js';

console.log('=== Step 1: usbmuxd listDevices ===');
try {
  const client = new UsbmuxdClient();
  const devices = await client.listDevices(2000);
  client.close();
  if (devices.length === 0) {
    console.log('  ⚠️  没有发现 USB 设备');
  } else {
    for (const d of devices) {
      console.log(`  ✅ DeviceID=${d.deviceID}  SerialNumber=${d.serialNumber ?? 'N/A'}`);
    }
  }
} catch (e) {
  console.log('  ❌ listDevices 失败:', e.message);
}

console.log('\n=== Step 2: usbmuxd connect (per port) ===');
try {
  const client2 = new UsbmuxdClient();
  const devices2 = await client2.listDevices(2000);
  client2.close();
  for (const d of devices2) {
    for (let port = 47175; port <= 47179; port++) {
      try {
        const c = new UsbmuxdClient();
        const sock = await c.connect(d.deviceID, port, 3000);
        sock.destroy();
        console.log(`  ✅ DeviceID=${d.deviceID} port=${port} 连接成功`);
      } catch (e) {
        console.log(`  ❌ DeviceID=${d.deviceID} port=${port}: ${e.message}`);
      }
    }
  }
} catch (e) {
  console.log('  ❌ 无法枚举设备:', e.message);
}

console.log('\n=== Step 3: DeviceDiscovery.probeFirst() ===');
const discovery = new DeviceDiscovery();
const ep = await discovery.probeFirst(3000);
if (ep) {
  console.log(`  ✅ 找到: ${ep.host}:${ep.port} (${ep.transport}) deviceID=${ep.deviceID ?? 'N/A'}`);
} else {
  console.log('  ❌ probeFirst 没有找到任何可用端点');
}

process.exit(0);
