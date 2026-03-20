import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBridgeBinaryCandidates,
  resolveBridgeBinaryPath,
} from '../core/bridge-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface InitOptions {
  force?: boolean;
}

export interface InitResult {
  initialized: boolean;
  rebuilt: boolean;
  bridgePath: string;
  message: string;
}

export async function runLookinInit(
  options: InitOptions = {},
): Promise<InitResult> {
  const packageRoot = resolve(__dirname, '../..');
  const currentBridgePath = resolveBridgeBinaryPath();

  if (!options.force && existsSync(currentBridgePath)) {
    return {
      initialized: true,
      rebuilt: false,
      bridgePath: currentBridgePath,
      message:
        `lookin-bridge 已存在：${currentBridgePath}\n` +
        '如需强制重建，请执行：lookin init --force',
    };
  }

  await buildBridge(packageRoot);

  const resolvedAfterBuild = getBridgeBinaryCandidates().find((candidate) =>
    existsSync(candidate),
  );

  if (!resolvedAfterBuild) {
    throw new Error(
      'Bridge 构建已完成，但未找到 lookin-bridge 产物，请检查 Swift 构建输出。',
    );
  }

  return {
    initialized: true,
    rebuilt: true,
    bridgePath: resolvedAfterBuild,
    message:
      `初始化完成，lookin-bridge 已构建：${resolvedAfterBuild}\n` +
      '现在可以直接执行：lookin status',
  };
}

function buildBridge(packageRoot: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('swift', ['build', '--package-path', 'bridge'], {
      cwd: packageRoot,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`swift build --package-path bridge 失败，退出码：${code}`),
      );
    });
  });
}
