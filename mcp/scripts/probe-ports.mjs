#!/usr/bin/env node
import * as net from 'node:net';

// Lookin 默认端口范围
const ports = [47175, 47176, 47177, 47178, 47179, 47180];
const host = '127.0.0.1';

console.log('探测 Lookin 端口...');
for (const port of ports) {
  try {
    await new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port, timeout: 1000 });
      sock.on('connect', () => { console.log(`  ✅ ${host}:${port} - 已连接`); sock.destroy(); resolve(); });
      sock.on('error', (e) => { console.log(`  ❌ ${host}:${port} - ${e.code}`); resolve(); });
      sock.on('timeout', () => { console.log(`  ⏱  ${host}:${port} - 超时`); sock.destroy(); resolve(); });
    });
  } catch {}
}

// 也检查 usbmuxd
console.log('\n检查 usbmuxd...');
try {
  await new Promise((resolve, reject) => {
    const sock = net.createConnection({ path: '/var/run/usbmuxd', timeout: 2000 });
    sock.on('connect', () => { console.log('  ✅ usbmuxd 可达'); sock.destroy(); resolve(); });
    sock.on('error', (e) => { console.log('  ❌ usbmuxd:', e.code); resolve(); });
    sock.on('timeout', () => { console.log('  ⏱  usbmuxd 超时'); sock.destroy(); resolve(); });
  });
} catch {}

process.exit(0);
