#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerGetAppInfoTool } from '../dist/app-info-tool.js';

const server = new McpServer({ name: 'lookin-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
registerGetAppInfoTool(server);

const client = new Client({ name: 'claude-mock', version: '1.0.0' });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

console.log('[Claude] 调用 get_app_info ...\n');
const result = await client.callTool({ name: 'get_app_info' });
const data = JSON.parse(result.content[0].text);
console.log(JSON.stringify(data, null, 2));

if (data.error) {
  console.log('\n❌ 错误:', data.error);
} else {
  console.log('\n[Claude 解读]');
  console.log('  应用名称:', data.appName);
  console.log('  Bundle ID:', data.bundleIdentifier);
  console.log('  设备:', data.deviceDescription);
  console.log('  系统:', data.osDescription, '(主版本:', data.osMainVersion + ')');
  console.log('  LookinServer:', data.serverReadableVersion ?? ('v' + data.serverVersion));
  console.log('  屏幕:', data.screenWidth + 'x' + data.screenHeight, '@' + data.screenScale + 'x');
  const deviceTypes = { 0: '模拟器', 1: 'iPad', 2: '其他(iPhone等)' };
  console.log('  设备类型:', deviceTypes[data.deviceType] ?? ('类型' + data.deviceType));
}

await client.close();
process.exit(0);
