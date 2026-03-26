import { z, type ZodTypeAny } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CacheManager } from './cache.js';
import type { DeviceEndpoint } from './discovery.js';
import { errorResponse } from './errors.js';
import {
  LookinCliService,
  type HierarchyCommandResult,
  type ScreenshotCommandResult,
} from './lookin-cli-service.js';

type JsonContent = { type: 'text'; text: string };
type ImageContent = { type: 'image'; data: string; mimeType: string };
type CommandContent = JsonContent | ImageContent;
type CommandShape = Record<string, ZodTypeAny>;

export interface RegisterCommandOptions {
  fixedEndpoint?: DeviceEndpoint;
  cache?: CacheManager;
}

interface CommandContext {
  service: LookinCliService;
}

export interface LookinCommandDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  inputShape?: CommandShape;
  execute: (args: TArgs, context: CommandContext) => Promise<TResult>;
  toCliOutput?: (result: TResult) => string;
  toMcpContent: (result: TResult) => CommandContent[];
}

const hierarchyInputShape = {
  format: z
    .enum(['text', 'json'])
    .optional()
    .default('text')
    .describe('Output format: "text" (default, ~62% fewer tokens) or "json" (structured)'),
  maxDepth: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Maximum tree depth to return (root = 0). If omitted, returns the full hierarchy.'),
} satisfies CommandShape;

const screenshotInputShape = {
  oid: z
    .number()
    .int()
    .positive()
    .describe('The layerOid of the view to capture. Get layerOids from get_hierarchy.'),
} satisfies CommandShape;

const searchInputShape = {
  query: z
    .string()
    .optional()
    .describe('Search string to match against className or memory address. Case-insensitive partial match.'),
  text: z
    .string()
    .optional()
    .describe('Search string to match against text content (e.g., UILabel, GXText text). Case-insensitive partial match. Uses get_view internally, so may be slower.'),
} satisfies CommandShape;

const getViewInputShape = {
  oid: z
    .number()
    .int()
    .positive()
    .describe('The layer object identifier (layerOid) of the view to inspect. Get layerOid values from get_hierarchy output.'),
} satisfies CommandShape;

const modifyViewInputShape = {
  oid: z
    .number()
    .int()
    .positive()
    .describe('Target object identifier. Use layerOid for hidden/alpha/frame/backgroundColor; use oid (viewOid) for text.'),
  attribute: z
    .enum(['hidden', 'alpha', 'frame', 'backgroundColor', 'text'])
    .describe('The attribute to modify.'),
  value: z
    .any()
    .describe('New value. hidden: boolean; alpha: number; frame: [x,y,w,h]; backgroundColor: [r,g,b,a]; text: string.'),
} satisfies CommandShape;

function toJsonContent(result: unknown): JsonContent[] {
  return [{ type: 'text', text: JSON.stringify(result) }];
}

function toCliJson(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

export const statusCommand: LookinCommandDefinition<Record<string, never>, Record<string, unknown>> =
  {
    name: 'status',
    description:
      'Check Lookin connection health, protocol version, transport type, and background state',
    execute: async (_args, { service }) => service.status(),
    toCliOutput: toCliJson,
    toMcpContent: toJsonContent,
  };

export const hierarchyCommand: LookinCommandDefinition<
  { format?: 'text' | 'json'; maxDepth?: number },
  HierarchyCommandResult
> = {
  name: 'get_hierarchy',
  description:
    'Fetch the iOS view hierarchy from the connected app. Returns app info and a tree of view nodes with class names, frames, visibility, and view controller associations. Use format="text" (default) for a token-efficient indented tree, or format="json" for structured data. maxDepth is optional; if omitted, the full hierarchy is returned.',
  inputShape: hierarchyInputShape,
  execute: async (args, { service }) => service.getHierarchy(args),
  toCliOutput: (result) =>
    result.format === 'text'
      ? result.text ?? ''
      : JSON.stringify(result.data ?? {}, null, 2),
  toMcpContent: (result) => {
    if (result.format === 'text') {
      return [{ type: 'text', text: result.text ?? '' }];
    }
    return [{ type: 'text', text: JSON.stringify(result.data ?? {}) }];
  },
};

export const searchCommand: LookinCommandDefinition<
  { query?: string; text?: string },
  Record<string, unknown>
> = {
  name: 'search',
  description:
    'Search the iOS view hierarchy by class name, memory address, or text content. Returns matching nodes with parent context (breadcrumb). Case-insensitive partial matching. Use --text to search text content (slower, as it fetches view attributes).',
  inputShape: searchInputShape,
  execute: async ({ query, text }, { service }) => service.search(query, text),
  toCliOutput: toCliJson,
  toMcpContent: toJsonContent,
};

export const listViewControllersCommand: LookinCommandDefinition<
  Record<string, never>,
  Record<string, unknown>
> = {
  name: 'list_view_controllers',
  description:
    'List all UIViewControllers in the current view hierarchy. Returns a deduplicated list with class names, oids, and the view each controller is hosted on.',
  execute: async (_args, { service }) => service.listViewControllers(),
  toCliOutput: toCliJson,
  toMcpContent: toJsonContent,
};

export const reloadCommand: LookinCommandDefinition<
  Record<string, never>,
  Record<string, unknown>
> = {
  name: 'reload',
  description:
    'Reload the view hierarchy from the live app. Clears any cached data and fetches a fresh hierarchy. Returns a summary with node count and app info.',
  execute: async (_args, { service }) => service.reload(),
  toCliOutput: toCliJson,
  toMcpContent: toJsonContent,
};

export const getViewCommand: LookinCommandDefinition<
  { oid: number },
  Record<string, unknown>
> = {
  name: 'get_view',
  description:
    'Fetch all attribute groups for a specific view by its layerOid. Returns structured property data including class, frame, visibility, layer settings, and more. Use get_hierarchy first to obtain layerOid values.',
  inputShape: getViewInputShape,
  execute: async ({ oid }, { service }) => service.getView(oid),
  toCliOutput: toCliJson,
  toMcpContent: toJsonContent,
};

export const getScreenshotCommand: LookinCommandDefinition<
  { oid: number },
  ScreenshotCommandResult
> = {
  name: 'get_screenshot',
  description:
    'Capture a screenshot of a specific view by its layerOid. Returns a PNG image (base64) showing how the view renders on screen, including all its subviews. Use get_hierarchy first to discover layerOids.',
  inputShape: screenshotInputShape,
  execute: async ({ oid }, { service }) => service.getScreenshot(oid),
  toCliOutput: (result) =>
    JSON.stringify(
      {
        ...result.metadata,
        imageBase64: result.imageBase64,
      },
      null,
      2,
    ),
  toMcpContent: (result) => [
    { type: 'text', text: JSON.stringify(result.metadata) },
    { type: 'image', data: result.imageBase64, mimeType: 'image/png' },
  ],
};

export const modifyViewCommand: LookinCommandDefinition<
  { oid: number; attribute: 'hidden' | 'alpha' | 'frame' | 'backgroundColor' | 'text'; value: unknown },
  Record<string, unknown>
> = {
  name: 'modify_view',
  description:
    'Modify a view or layer attribute at runtime. Supported attributes: hidden, alpha, frame, backgroundColor, text. For layer properties (hidden, alpha, frame, backgroundColor) pass the layerOid from get_hierarchy. For view properties (text) pass the oid (viewOid) from get_hierarchy. Returns updated attribute groups after modification.',
  inputShape: modifyViewInputShape,
  execute: async (args, { service }) => service.modifyView(args),
  toCliOutput: toCliJson,
  toMcpContent: toJsonContent,
};

export const getAppInfoCommand: LookinCommandDefinition<
  Record<string, never>,
  Record<string, unknown>
> = {
  name: 'get_app_info',
  description:
    'Get metadata about the connected iOS app: app name, bundle identifier, device model, OS version, LookinServer version, and more. No parameters required.',
  execute: async (_args, { service }) => service.getAppInfo(),
  toCliOutput: toCliJson,
  toMcpContent: toJsonContent,
};

export const LOOKIN_COMMAND_DEFINITIONS: ReadonlyArray<
  LookinCommandDefinition<any, any>
> = [
  statusCommand,
  hierarchyCommand,
  searchCommand,
  listViewControllersCommand,
  reloadCommand,
  getViewCommand,
  getScreenshotCommand,
  modifyViewCommand,
  getAppInfoCommand,
] as const;

export function getCommandDefinition(
  name: string,
): LookinCommandDefinition<any, any> | undefined {
  return LOOKIN_COMMAND_DEFINITIONS.find((definition) => definition.name === name);
}

export async function executeCommand(
  name: string,
  args: Record<string, unknown> | undefined,
  options: RegisterCommandOptions = {},
): Promise<unknown> {
  const definition = getCommandDefinition(name);
  if (!definition) {
    throw new Error(`Unknown command: ${name}`);
  }

  return executeDefinition(definition, args, options);
}

export function registerCommandTool(
  server: McpServer,
  name: string,
  options: RegisterCommandOptions = {},
): void {
  const definition = getCommandDefinition(name);
  if (!definition) {
    throw new Error(`Unknown command: ${name}`);
  }

  const handler = async (rawArgs: Record<string, unknown> = {}) => {
    try {
      const result = await executeDefinition(definition, rawArgs, options);
      return { content: definition.toMcpContent(result) };
    } catch (error) {
      return errorResponse(error);
    }
  };

  if (definition.inputShape) {
    server.tool(definition.name, definition.description, definition.inputShape, handler);
    return;
  }

  server.tool(definition.name, definition.description, handler);
}

export function renderCliOutput(name: string, result: unknown): string {
  const definition = getCommandDefinition(name);
  if (!definition) {
    throw new Error(`Unknown command: ${name}`);
  }

  if (definition.toCliOutput) {
    return definition.toCliOutput(result);
  }

  return JSON.stringify(result, null, 2);
}

function buildArgSchema(shape?: CommandShape) {
  return z.object(shape ?? {});
}

async function executeDefinition(
  definition: LookinCommandDefinition,
  rawArgs: Record<string, unknown> | undefined,
  options: RegisterCommandOptions,
): Promise<unknown> {
  const parsedArgs = await buildArgSchema(definition.inputShape).parseAsync(
    rawArgs ?? {},
  );
  const service = new LookinCliService({
    fixedEndpoint: options.fixedEndpoint,
    cache: options.cache,
  });
  return definition.execute(parsedArgs, { service });
}
