import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default path to the lookin-bridge binary (debug build) */
const DEFAULT_BRIDGE_BIN = resolve(
  __dirname,
  '../bridge/.build/x86_64-apple-macosx/debug/lookin-bridge',
);

export interface BridgeClientOptions {
  /** Override the path to the lookin-bridge binary */
  bridgeBin?: string;
  /** Timeout in ms for bridge process execution (default: 30000) */
  timeout?: number;
}

interface BridgeResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Wraps the Swift lookin-bridge CLI binary.
 * Handles NSKeyedArchiver encode/decode via stdin/stdout IPC.
 */
export class BridgeClient {
  private bin: string;
  private timeout: number;

  constructor(options?: BridgeClientOptions) {
    this.bin = options?.bridgeBin ?? DEFAULT_BRIDGE_BIN;
    this.timeout = options?.timeout ?? 30000;
  }

  /**
   * Decode NSKeyedArchiver base64 data into a JSON object.
   * Sends base64 string to `lookin-bridge decode` via stdin.
   */
  async decode(base64: string): Promise<any> {
    const result = await this.run(['decode'], base64);
    if (result.code !== 0) {
      throw new Error(`bridge decode failed (code ${result.code}): ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  }

  /**
   * Encode a JSON object into NSKeyedArchiver base64 data.
   * Sends JSON to `lookin-bridge encode` via stdin.
   * The JSON must contain a `$class` field indicating the model class.
   */
  async encode(json: object): Promise<string> {
    const result = await this.run(['encode'], JSON.stringify(json));
    if (result.code !== 0) {
      throw new Error(`bridge encode failed (code ${result.code}): ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  /** Run the bridge binary with args and optional stdin data */
  private run(args: string[], stdinData?: string): Promise<BridgeResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { timeout: this.timeout });
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
      }
      child.stdin.end();
    });
  }
}
