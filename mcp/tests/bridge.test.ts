import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeClient } from '../src/bridge-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_BIN = resolve(
  __dirname,
  '../bridge/.build/x86_64-apple-macosx/debug/lookin-bridge',
);

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/bridge-fixtures.json'), 'utf-8'),
);

const bridge = new BridgeClient({ bridgeBin: BRIDGE_BIN });

/** Helper: run bridge with stdin input and return stdout/stderr (for error-case tests) */
function runBridge(args: string[], stdinData?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(BRIDGE_BIN, args, { timeout: 30000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
    child.on('error', reject);
    if (stdinData !== undefined) {
      child.stdin.write(stdinData);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

describe('BridgeClient.decode', () => {
  it('decodes LookinConnectionResponseAttachment from base64', async () => {
    const fixture = fixtures.connectionResponse;
    const result = await bridge.decode(fixture.base64);

    expect(result['$class']).toBe('LookinConnectionResponseAttachment');
    expect(result.lookinServerVersion).toBe(7);
    expect(result.appIsInBackground).toBe(false);
    expect(result.dataTotalCount).toBe(1);
    expect(result.currentDataCount).toBe(1);
    expect(result.dataType).toBe(0);
  });

  it('decodes LookinConnectionAttachment with string data', async () => {
    const fixture = fixtures.connectionAttachment;
    const result = await bridge.decode(fixture.base64);

    expect(result['$class']).toBe('LookinConnectionAttachment');
    expect(result.dataType).toBe(0);
    expect(result.data).toBe('hello');
  });

  it('decodes LookinHierarchyInfo with appInfo', async () => {
    const fixture = fixtures.hierarchyInfo;
    const result = await bridge.decode(fixture.base64);

    expect(result['$class']).toBe('LookinHierarchyInfo');
    expect(result.serverVersion).toBe(7);
    expect(result.appInfo).toBeDefined();
    expect(result.appInfo['$class']).toBe('LookinAppInfo');
    expect(result.appInfo.appName).toBe('TestApp');
    expect(result.appInfo.appBundleIdentifier).toBe('com.test.app');
    expect(result.appInfo.deviceDescription).toBe('iPhone 15 Pro');
    expect(result.appInfo.osDescription).toBe('iOS 18.0');
    expect(result.displayItems).toEqual([]);
  });

  it('rejects on invalid base64 input', async () => {
    await expect(bridge.decode('not-valid-base64!!!')).rejects.toThrow();
  });

  it('rejects on empty input', async () => {
    await expect(bridge.decode('')).rejects.toThrow();
  });
});

describe('BridgeClient.encode', () => {
  it('encodes LookinConnectionResponseAttachment to base64', async () => {
    const json = {
      '$class': 'LookinConnectionResponseAttachment',
      lookinServerVersion: 7,
      appIsInBackground: false,
      dataTotalCount: 1,
      currentDataCount: 1,
      dataType: 0,
    };
    const base64 = await bridge.encode(json);

    // Verify it's valid base64
    expect(base64.length).toBeGreaterThan(0);
    expect(() => Buffer.from(base64, 'base64')).not.toThrow();

    // Decode it back and verify structure
    const decoded = await bridge.decode(base64);
    expect(decoded['$class']).toBe('LookinConnectionResponseAttachment');
    expect(decoded.lookinServerVersion).toBe(7);
    expect(decoded.appIsInBackground).toBe(false);
  });

  it('encodes LookinConnectionAttachment to base64', async () => {
    const json = {
      '$class': 'LookinConnectionAttachment',
      dataType: 0,
      data: 'hello',
    };
    const base64 = await bridge.encode(json);
    expect(base64.length).toBeGreaterThan(0);

    const decoded = await bridge.decode(base64);
    expect(decoded['$class']).toBe('LookinConnectionAttachment');
    expect(decoded.data).toBe('hello');
  });

  it('rejects on invalid JSON object (no $class)', async () => {
    await expect(bridge.encode({ dataType: 0 })).rejects.toThrow();
  });

  it('rejects for unsupported model class', async () => {
    await expect(
      bridge.encode({ '$class': 'UnknownClass', foo: 1 }),
    ).rejects.toThrow();
  });
});

describe('BridgeClient round-trip', () => {
  it('encode then decode LookinConnectionResponseAttachment preserves data', async () => {
    const original = {
      '$class': 'LookinConnectionResponseAttachment',
      lookinServerVersion: 7,
      appIsInBackground: false,
      dataTotalCount: 1,
      currentDataCount: 1,
      dataType: 0,
    };

    const base64 = await bridge.encode(original);
    const decoded = await bridge.decode(base64);

    expect(decoded['$class']).toBe(original['$class']);
    expect(decoded.lookinServerVersion).toBe(original.lookinServerVersion);
    expect(decoded.appIsInBackground).toBe(original.appIsInBackground);
    expect(decoded.dataTotalCount).toBe(original.dataTotalCount);
    expect(decoded.currentDataCount).toBe(original.currentDataCount);
    expect(decoded.dataType).toBe(original.dataType);
  });

  it('encode then decode LookinConnectionAttachment preserves data', async () => {
    const original = {
      '$class': 'LookinConnectionAttachment',
      dataType: 0,
      data: 'test-data',
    };

    const base64 = await bridge.encode(original);
    const decoded = await bridge.decode(base64);

    expect(decoded['$class']).toBe(original['$class']);
    expect(decoded.dataType).toBe(original.dataType);
    expect(decoded.data).toBe(original.data);
  });
});

describe('lookin-bridge CLI error handling', () => {
  it('exits non-zero with no arguments', async () => {
    const result = await runBridge([]);
    expect(result.code).not.toBe(0);
  });

  it('exits non-zero with unknown command', async () => {
    const result = await runBridge(['unknown']);
    expect(result.code).not.toBe(0);
  });

  it('exits non-zero on invalid JSON encode input', async () => {
    const result = await runBridge(['encode'], 'not json');
    expect(result.code).not.toBe(0);
  });
});
