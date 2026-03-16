import { AppSession, LookinRequestType } from "../dist/app-session.js";
import { BridgeClient } from "../dist/bridge-client.js";
import { DeviceDiscovery } from "../dist/discovery.js";

const d = new DeviceDiscovery();
const ep = await d.probeFirst(3000);
if (!ep) { console.log("no device"); process.exit(1); }

const session = new AppSession(ep);
const bridge = new BridgeClient();

// Get hierarchy to find a real oid
const hBuf = await session.request(LookinRequestType.Hierarchy, undefined, 15000);
const hDec = await bridge.decode(hBuf.toString("base64"));
const root = hDec.data.displayItems[0];
const viewOid = root.viewObject?.oid ?? 0;
const layerOid = root.layerObject?.oid ?? viewOid;
console.log("Target viewOid:", viewOid, "layerOid:", layerOid, root.viewObject?.classChainList?.[0]);

// Build Type 203 request with array of packages
const reqJson = {
  $class: "LookinConnectionAttachment",
  dataType: 0,
  data: [
    {
      $class: "LookinStaticAsyncUpdateTasksPackage",
      tasks: [
        {
          $class: "LookinStaticAsyncUpdateTask",
          oid: layerOid,
          taskType: 2, // GroupScreenshot (0=No, 1=Solo, 2=Group)
        },
      ],
    },
  ],
};

console.log("\nSending Type 203 with payload:", JSON.stringify(reqJson, null, 2));

const payloadB64 = await bridge.encode(reqJson);
const payloadBuf = Buffer.from(payloadB64, "base64");
const respBuf = await session.request(LookinRequestType.HierarchyDetails, payloadBuf, 15000);
const decoded = await bridge.decode(respBuf.toString("base64"));

console.log("\n=== Raw decoded response ===");
console.log("$class:", decoded.$class);
console.log("dataTotalCount:", decoded.dataTotalCount);
console.log("currentDataCount:", decoded.currentDataCount);

const items = decoded.data;
if (Array.isArray(items)) {
  console.log("data is array, length:", items.length);
  items.forEach((item, i) => {
    console.log(`\n--- item[${i}] ---`);
    console.log("$class:", item.$class);
    console.log("displayItemOid:", item.displayItemOid);
    console.log("failureCode:", item.failureCode);
    console.log("has groupScreenshot:", !!item.groupScreenshot);
    console.log("has soloScreenshot:", !!item.soloScreenshot);
    console.log("frame:", item.frame);
    console.log("bounds:", item.bounds);
    console.log("alpha:", item.alpha);
    console.log("isHidden:", item.isHidden);
    // List all keys
    console.log("all keys:", Object.keys(item).join(", "));
  });
} else {
  console.log("data type:", typeof items);
  console.log("data:", JSON.stringify(items, null, 2)?.slice(0, 500));
}

await session.close();
