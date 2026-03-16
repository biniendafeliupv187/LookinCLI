import { AppSession, LookinRequestType } from "../dist/app-session.js";
import { BridgeClient } from "../dist/bridge-client.js";
import { DeviceDiscovery } from "../dist/discovery.js";

const d = new DeviceDiscovery();
const ep = await d.probeFirst(3000);
if (!ep) { console.log("no device"); process.exit(1); }
const session = new AppSession(ep);
const bridge = new BridgeClient();
const buf = await session.request(LookinRequestType.Hierarchy, undefined, 15000);
const decoded = await bridge.decode(buf.toString("base64"));
const hi = decoded.data;
const items = hi.displayItems || [];
const root = items[0];
console.log("=== Root display item (first 2 levels) ===");
function show(item, depth) {
  const v = item.viewObject || {};
  const l = item.layerObject || {};
  console.log("  ".repeat(depth) + (v.classChainList?.[0] || "?") + " viewOid=" + v.oid + " layerOid=" + l.oid);
  if (depth < 1 && item.subitems) {
    item.subitems.slice(0, 5).forEach(c => show(c, depth + 1));
  }
}
if (root) show(root, 0);

// Now test Type 210 with the layer oid
const layerOid = (root?.layerObject || {}).oid;
if (layerOid) {
  console.log("\n=== Testing Type 210 with layerOid=" + layerOid + " ===");
  const payload64 = await bridge.encode({ $class: "LookinConnectionAttachment", dataType: 0, data: layerOid });
  const payloadBuf = Buffer.from(payload64, "base64");
  const resp = await session.request(LookinRequestType.AllAttrGroups, payloadBuf, 10000);
  const dec = await bridge.decode(resp.toString("base64"));
  const groups = dec.data || [];
  console.log("Groups count:", groups.length);
  groups.forEach(g => {
    console.log("  [" + g.identifier + "] sections=" + (g.attrSections || []).length);
  });
}

await session.close();
