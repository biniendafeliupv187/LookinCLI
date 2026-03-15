/**
 * Probe: send Type 202 hierarchy request to real device, decode and print result.
 * Usage: node scripts/probe-hierarchy.mjs
 */
import { DeviceDiscovery } from "../dist/discovery.js";
import { AppSession, LookinRequestType } from "../dist/app-session.js";
import { BridgeClient } from "../dist/bridge-client.js";

const discovery = new DeviceDiscovery();
const endpoint = await discovery.probeFirst(3000);
if (!endpoint) {
  console.error("No device found");
  process.exit(1);
}
console.log("Found endpoint:", endpoint);

const session = new AppSession(endpoint);
const bridge = new BridgeClient();

try {
  // Send Type 202 (Hierarchy) with no payload — same as Lookin client does for first request
  console.log("\nSending Type 202 Hierarchy request...");
  const responseBuf = await session.request(LookinRequestType.Hierarchy, undefined, 15000);
  console.log("Raw response size:", responseBuf.byteLength, "bytes");

  // Inspect first bytes to verify format
  const header = responseBuf.subarray(0, 20);
  console.log("First 20 bytes (hex):", Buffer.from(header).toString("hex"));
  // bplist00 = 62706c69 73743030 for binary plist (NSKeyedArchiver)
  const magic = responseBuf.subarray(0, 8).toString("ascii");
  console.log("Magic:", JSON.stringify(magic));

  // Save raw bytes for offline inspection
  const fs = await import("fs");
  fs.writeFileSync("/tmp/lookin-hierarchy-response.bin", responseBuf);
  console.log("Saved raw response to /tmp/lookin-hierarchy-response.bin");

  // Decode via bridge
  const base64 = responseBuf.toString("base64");
  const decoded = await bridge.decode(base64);

  // Print top-level structure
  console.log("\n--- Top-level keys ---");
  console.log(Object.keys(decoded));

  console.log("\n--- $class ---");
  console.log(decoded.$class);

  if (decoded.data) {
    console.log("\n--- data.$class ---");
    console.log(decoded.data.$class);
    console.log("\n--- data keys ---");
    console.log(Object.keys(decoded.data));

    if (decoded.data.appInfo) {
      console.log("\n--- appInfo ---");
      console.log(JSON.stringify(decoded.data.appInfo, null, 2));
    }

    if (decoded.data.displayItems) {
      console.log("\n--- displayItems count ---");
      console.log(decoded.data.displayItems.length);

      if (decoded.data.displayItems.length > 0) {
        const firstItem = decoded.data.displayItems[0];
        console.log("\n--- First displayItem keys ---");
        console.log(Object.keys(firstItem));
        console.log("\n--- First displayItem (truncated) ---");
        // Print without subitems to keep output manageable
        const { subitems, ...rest } = firstItem;
        console.log(JSON.stringify(rest, null, 2).substring(0, 3000));
        console.log("\n--- First displayItem subitems count ---");
        console.log(subitems?.length ?? 0);

        // Also print the first subitem if exists
        if (subitems && subitems.length > 0) {
          const firstSub = subitems[0];
          const { subitems: subSubs, ...subRest } = firstSub;
          console.log("\n--- First subitem ---");
          console.log(JSON.stringify(subRest, null, 2).substring(0, 2000));
          console.log("subitems count:", subSubs?.length ?? 0);
        }
      }
    }
  }
} catch (err) {
  console.error("Error:", err);
} finally {
  await session.close();
}
