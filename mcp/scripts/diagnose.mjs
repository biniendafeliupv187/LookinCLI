import { UsbmuxdClient } from "../dist/usbmuxd.js";
import * as net from "node:net";
import * as fs from "node:fs";

async function diagnose() {
  console.log("=== USB 连接诊断 ===\n");

  // 1. 检查 usbmuxd socket
  const socketPath = "/var/run/usbmuxd";
  console.log("[1] usbmuxd socket 路径:", socketPath);
  console.log("    存在:", fs.existsSync(socketPath));

  // 2. 查询已连接的 USB 设备
  console.log("\n[2] 正在查询已连接的 USB 设备...");
  const client = new UsbmuxdClient();
  let devices = [];
  try {
    devices = await client.listDevices(3000);
    console.log("    发现", devices.length, "个设备:");
    for (const d of devices) {
      console.log("    - DeviceID=" + d.deviceID + " UDID=" + (d.serialNumber || "unknown"));
      if (d.Properties) {
        console.log("      Properties:", JSON.stringify(d.Properties, null, 2).split("\n").join("\n      "));
      }
    }
    client.close();
  } catch (err) {
    console.log("    listDevices 失败:", err.message);
    client.close();
  }

  if (devices.length === 0) {
    console.log("\n    没有发现任何 USB 设备，跳过端口探测");
  } else {
    // 3. 对每个设备尝试 usbmuxd tunnel 连接 47175-47179
    const devID = devices[0].deviceID;
    console.log("\n[3] 对 DeviceID=" + devID + " 探测 LookinServer USB 端口 47175-47179...");
    for (let port = 47175; port <= 47179; port++) {
      const c2 = new UsbmuxdClient();
      try {
        const sock = await c2.connect(devID, port, 3000);
        console.log("    port", port, "=> 连接成功");
        sock.destroy();
      } catch (err) {
        console.log("    port", port, "=> 失败:", err.message);
      }
    }
  }

  // 4. 检查模拟器端口 (TCP直连)
  console.log("\n[4] 检查模拟器端口 47164-47169 (TCP 直连)...");
  for (let port = 47164; port <= 47169; port++) {
    const ok = await tcpProbe("127.0.0.1", port, 2000);
    console.log("    port", port, "=>", ok ? "连接成功" : "无响应");
  }

  // 5. 额外检查常用调试端口
  console.log("\n[5] 额外检查端口 47170-47179 (TCP 直连，排查端口漂移)...");
  for (let port = 47170; port <= 47179; port++) {
    const ok = await tcpProbe("127.0.0.1", port, 1000);
    if (ok) console.log("    port", port, "=> 连接成功 !!!");
  }

  console.log("\n=== 诊断完毕 ===");
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.connect(port, host, () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on("error", () => { clearTimeout(timer); sock.destroy(); resolve(false); });
  });
}

diagnose().catch(e => console.error("诊断失败:", e));
