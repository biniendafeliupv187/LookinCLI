#!/usr/bin/env node
import { createRequire } from 'node:module';
import { CacheManager } from '../core/cache.js';
import {
  LOOKIN_COMMAND_DEFINITIONS,
  executeCommand,
  getCommandDefinition,
  renderCliOutput,
} from '../core/command-definitions.js';
import { classifyError } from '../core/errors.js';
import { runLookinInit } from './init.js';

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require('../../package.json') as { version: string };

const BUILTIN_COMMANDS = {
  init: {
    description: '初始化本地运行环境，构建 lookin-bridge 等依赖。',
    options: ['--force'],
  },
} as const;

interface ParsedCliArgs {
  command?: string;
  args: Record<string, unknown>;
  help: boolean;
  version: boolean;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 0) {
    return { args: {}, help: true, version: false };
  }

  const [command, ...rest] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    return { args: {}, help: true, version: false };
  }

  if (command === '--version' || command === '-v') {
    return { args: {}, help: false, version: true };
  }

  const args: Record<string, unknown> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = toCamelCase(token.slice(2));
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = parseValue(next);
    index += 1;
  }

  return { command, args, help: false, version: false };
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);

  const looksLikeJson =
    (raw.startsWith('{') && raw.endsWith('}')) ||
    (raw.startsWith('[') && raw.endsWith(']')) ||
    (raw.startsWith('"') && raw.endsWith('"'));
  if (looksLikeJson) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return raw;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function printHelp(): void {
  const lines = [
    'Usage:',
    '  lookin <command> [--key value]',
    '  lookin --version',
    '',
    'Examples:',
    '  lookin init',
    '  lookin status',
    '  lookin get_hierarchy --format json --max-depth 10',
    '  lookin search --query UIButton',
    '  lookin modify_view --oid 42 --attribute hidden --value true',
    '  lookin modify_view --oid 42 --attribute frame --value "[0,0,120,44]"',
    '',
    'Commands:',
  ];

  for (const [name, command] of Object.entries(BUILTIN_COMMANDS)) {
    lines.push(`  ${name}`);
    lines.push(`    ${command.description}`);
    if (command.options.length > 0) {
      lines.push(`    options: ${command.options.join(', ')}`);
    }
  }

  for (const definition of LOOKIN_COMMAND_DEFINITIONS) {
    lines.push(`  ${definition.name}`);
    lines.push(`    ${definition.description}`);
    const optionNames = Object.keys(definition.inputShape ?? {});
    if (optionNames.length > 0) {
      lines.push(
        `    options: ${optionNames.map((name) => `--${toKebabCase(name)}`).join(', ')}`,
      );
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}

const parsed = parseCliArgs(process.argv.slice(2));

if (parsed.version) {
  process.stdout.write(`${CLI_VERSION}\n`);
  process.exit(0);
}

if (parsed.help || !parsed.command) {
  printHelp();
  process.exit(parsed.help ? 0 : 1);
}

if (parsed.command === 'init') {
  try {
    const result = await runLookinInit({
      force: parsed.args.force === true,
    });
    process.stdout.write(
      `${result.message}${result.message.endsWith('\n') ? '' : '\n'}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (!getCommandDefinition(parsed.command)) {
  process.stderr.write(`Unknown command: ${parsed.command}\n\n`);
  printHelp();
  process.exit(1);
}

try {
  const result = await executeCommand(parsed.command, parsed.args, {
    cache: new CacheManager(),
  });
  const output = renderCliOutput(parsed.command, result);
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
} catch (error) {
  const classified = classifyError(error);
  process.stderr.write(`${JSON.stringify(classified.toJSON(), null, 2)}\n`);
  process.exit(1);
}
