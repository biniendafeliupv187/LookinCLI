import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import { CacheManager } from './cache.js';
import { DeviceDiscovery, type DeviceEndpoint } from './discovery.js';
import { LookinError, classifyError } from './errors.js';

export interface HierarchyViewNode {
  oid: number;
  layerOid: number;
  className: string;
  frame: { x: number; y: number; width: number; height: number };
  isHidden: boolean;
  alpha: number;
  isKeyWindow?: boolean;
  viewController?: string;
  subitems?: HierarchyViewNode[];
}

export interface HierarchyCommandResult {
  format: 'text' | 'json';
  text?: string;
  data?: Record<string, unknown>;
}

export interface ScreenshotCommandResult {
  metadata: Record<string, unknown>;
  imageBase64: string;
}

export const ATTR_WHITELIST: Record<
  string,
  { setter: string; attrType: number; target: 'layer' | 'view' }
> = {
  hidden: { setter: 'setIsHidden:', attrType: 14, target: 'layer' },
  alpha: { setter: 'setOpacity:', attrType: 12, target: 'layer' },
  frame: { setter: 'setFrame:', attrType: 20, target: 'layer' },
  backgroundColor: {
    setter: 'setLks_backgroundColor:',
    attrType: 27,
    target: 'layer',
  },
  text: { setter: 'setText:', attrType: 24, target: 'view' },
};

export interface LookinCliServiceOptions {
  fixedEndpoint?: DeviceEndpoint;
  cache?: CacheManager;
  bridgeClient?: BridgeClient;
  discovery?: DeviceDiscovery;
}

interface HierarchyFetchResult {
  hierarchyInfo: any;
  cacheHit: boolean;
  source: 'cache' | 'live';
  stalePossible: boolean;
}

interface EndpointSessionContext {
  endpoint: DeviceEndpoint;
  session: AppSession;
}

interface SearchResult {
  oid: number;
  className: string;
  frame: { x: number; y: number; width: number; height: number };
  isHidden: boolean;
  alpha: number;
  parentChain: string;
  text?: string;
}

interface VCInfo {
  className: string;
  oid: number;
  hostViewOid: number;
}

const MAX_TEXT_CANDIDATES = 200;
const TEXT_HINT_THRESHOLD = 50;

export class LookinCliService {
  private readonly fixedEndpoint?: DeviceEndpoint;
  private readonly cache?: CacheManager;
  private readonly discovery: DeviceDiscovery;
  private readonly bridge: BridgeClient;

  constructor(options: LookinCliServiceOptions = {}) {
    this.fixedEndpoint = options.fixedEndpoint;
    this.cache = options.cache;
    this.discovery = options.discovery ?? new DeviceDiscovery();
    this.bridge = options.bridgeClient ?? new BridgeClient();
  }

  async status(): Promise<Record<string, unknown>> {
    let endpoint: DeviceEndpoint;

    try {
      endpoint = await this.resolveEndpoint();
    } catch (error) {
      return {
        connected: false,
        ...classifyError(error).toJSON(),
      };
    }

    const session = new AppSession(endpoint, this.bridge);
    try {
      const response = await session.ping(5000);
      return {
        connected: true,
        transport: endpoint.transport,
        serverVersion: response.lookinServerVersion ?? null,
        appIsInBackground: response.appIsInBackground ?? false,
        host: endpoint.host,
        port: endpoint.port,
      };
    } catch (error) {
      return {
        connected: false,
        transport: endpoint.transport,
        host: endpoint.host,
        port: endpoint.port,
        ...classifyError(error).toJSON(),
      };
    } finally {
      await session.close();
    }
  }

  async getHierarchy(options: {
    format?: 'text' | 'json';
    maxDepth?: number;
  }): Promise<HierarchyCommandResult> {
    const startMs = Date.now();
    const format = options.format ?? 'text';
    const fetched = await this.fetchHierarchyInfo();
    const hierarchyInfo = fetched.hierarchyInfo;
    const appInfo = hierarchyInfo.appInfo;
    const displayItems: any[] = hierarchyInfo.displayItems ?? [];
    const viewHierarchy = displayItems.map((item) =>
      toViewNode(item, 0, options.maxDepth),
    );

    const elapsedMs = Date.now() - startMs;
    const meta = CacheManager.buildMeta({
      cacheHit: fetched.cacheHit,
      source: fetched.source,
      stalePossible: fetched.stalePossible,
      elapsedMs,
    });

    if (format === 'json') {
      return {
        format,
        data: {
          appInfo: appInfo
            ? {
                appName: appInfo.appName ?? null,
                bundleId: appInfo.appBundleIdentifier ?? null,
                deviceDescription: appInfo.deviceDescription ?? null,
                osDescription: appInfo.osDescription ?? null,
              }
            : null,
          serverVersion: hierarchyInfo.serverVersion ?? null,
          viewHierarchy,
          _meta: meta,
        },
      };
    }

    const appLine = appInfo
      ? `App: ${appInfo.appName ?? '?'} (${appInfo.appBundleIdentifier ?? '?'}) | Device: ${appInfo.deviceDescription ?? '?'} ${appInfo.osDescription ?? '?'}`
      : 'App: unknown';
    const depthLine =
      options.maxDepth !== undefined ? ` | maxDepth=${options.maxDepth}` : '';
    const metaLine = ` | cache=${fetched.cacheHit ? 'hit' : 'miss'}${meta.hint ? ` | ${meta.hint}` : ''}`;

    return {
      format,
      text: [appLine + depthLine + metaLine, '', ...toTextLines(viewHierarchy)].join(
        '\n',
      ),
    };
  }

  async search(query?: string, text?: string): Promise<Record<string, unknown>> {
    const startMs = Date.now();

    // If text search is requested, we need to fetch view details to get text content
    if (text) {
      return this.searchByText(query, text, startMs);
    }

    // Standard search by className or address
    const cachedIndex = this.cache?.getSearchIndex();

    if (cachedIndex) {
      const results = filterSearchResults(cachedIndex, query ?? '');
      const elapsedMs = Date.now() - startMs;
      const stalePossible = this.cache?.peekHierarchy()?.stale ?? false;
      return {
        query: query ?? null,
        text: null,
        resultCount: results.length,
        results,
        _meta: CacheManager.buildMeta({
          cacheHit: true,
          source: 'cache',
          stalePossible,
          elapsedMs,
        }),
      };
    }

    const fetched = await this.fetchHierarchyInfo();
    const flattened = flattenItems(fetched.hierarchyInfo.displayItems ?? []);
    const queryLower = (query ?? '').toLowerCase();
    const results: SearchResult[] = [];

    for (const { item, parentChain } of flattened) {
      const viewObj = item.viewObject ?? item.layerObject;
      const className = viewObj?.classChainList?.[0] ?? 'Unknown';
      const address = viewObj?.memoryAddress ?? '';
      const matchesClass = query ? className.toLowerCase().includes(queryLower) : true;
      const matchesAddress = query ? address.toLowerCase().includes(queryLower) : true;

      if (matchesClass || matchesAddress) {
        results.push({
          oid: viewObj?.oid ?? 0,
          className,
          frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
          isHidden: item.isHidden ?? false,
          alpha: item.alpha ?? 0,
          parentChain: parentChain.join(' > '),
        });
      }
    }

    const elapsedMs = Date.now() - startMs;
    return {
      query: query ?? null,
      text: null,
      resultCount: results.length,
      results,
      _meta: CacheManager.buildMeta({
        cacheHit: false,
        source: 'live',
        stalePossible: false,
        elapsedMs,
      }),
    };
  }

  private async searchByText(
    query: string | undefined,
    textQuery: string,
    startMs: number,
  ): Promise<Record<string, unknown>> {
    // Get all nodes first (or use cache)
    const cachedIndex = this.cache?.getSearchIndex();

    if (cachedIndex) {
      // For text search, we need to fetch view details for each candidate
      const textLower = textQuery.toLowerCase();
      const results: SearchResult[] = [];

      // Limit concurrent fetches to avoid overwhelming the server
      const allCandidates = filterSearchResults(cachedIndex, query ?? '');
      let searchHint: string | undefined;
      if (!query && allCandidates.length > TEXT_HINT_THRESHOLD) {
        searchHint = `text-only search has ${allCandidates.length} candidates; consider adding --query to filter first`;
      }
      const candidates = allCandidates.slice(0, MAX_TEXT_CANDIDATES);
      const BATCH_SIZE = 5;

      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (candidate) => {
            if (candidate.oid === 0) return null;
            try {
              const viewData = await this.getView(candidate.oid);
              const text = extractTextFromAttrGroups(viewData);
              if (text && text.toLowerCase().includes(textLower)) {
                return { ...candidate, text };
              }
            } catch {
              // Ignore errors for individual view fetches
            }
            return null;
          }),
        );
        results.push(...batchResults.filter((r) => r !== null) as SearchResult[]);
      }

      const elapsedMs = Date.now() - startMs;
      const stalePossible = this.cache?.peekHierarchy()?.stale ?? false;
      const meta = CacheManager.buildMeta({ cacheHit: true, source: 'cache', stalePossible, elapsedMs });
      if (searchHint) meta.hint = searchHint;
      return {
        query: query ?? null,
        text: textQuery,
        resultCount: results.length,
        results,
        _meta: meta,
      };
    }

    // No cache, need to fetch hierarchy first
    const fetched = await this.fetchHierarchyInfo();
    const flattened = flattenItems(fetched.hierarchyInfo.displayItems ?? []);
    const textLower = textQuery.toLowerCase();
    const queryLower = (query ?? '').toLowerCase();
    const results: SearchResult[] = [];

    // Pre-filter candidates by className/address, then apply hint + cap
    const matchingItems = flattened.filter(({ item }) => {
      const viewObj = item.viewObject ?? item.layerObject;
      const className = viewObj?.classChainList?.[0] ?? 'Unknown';
      const address = viewObj?.memoryAddress ?? '';
      const matchesClass = query ? className.toLowerCase().includes(queryLower) : true;
      const matchesAddress = query ? address.toLowerCase().includes(queryLower) : true;
      return matchesClass || matchesAddress;
    });

    let searchHint: string | undefined;
    if (!query && matchingItems.length > TEXT_HINT_THRESHOLD) {
      searchHint = `text-only search has ${matchingItems.length} candidates; consider adding --query to filter first`;
    }
    const cappedItems = matchingItems.slice(0, MAX_TEXT_CANDIDATES);

    // Process in batches
    const BATCH_SIZE = 5;
    for (let i = 0; i < cappedItems.length; i += BATCH_SIZE) {
      const batch = cappedItems.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async ({ item, parentChain }) => {
          const viewObj = item.viewObject ?? item.layerObject;
          const className = viewObj?.classChainList?.[0] ?? 'Unknown';

          const oid = viewObj?.oid ?? 0;
          if (oid === 0) return null;
          try {
            const viewData = await this.getView(oid);
            const text = extractTextFromAttrGroups(viewData);
            if (text && text.toLowerCase().includes(textLower)) {
              return {
                oid,
                className,
                frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
                isHidden: item.isHidden ?? false,
                alpha: item.alpha ?? 0,
                parentChain: parentChain.join(' > '),
                text,
              };
            }
          } catch {
            // Ignore errors
          }
          return null;
        }),
      );
      results.push(...batchResults.filter((r) => r !== null) as SearchResult[]);
    }

    const elapsedMs = Date.now() - startMs;
    return {
      query: query ?? null,
      text: textQuery,
      resultCount: results.length,
      results,
      _meta: (() => {
        const meta = CacheManager.buildMeta({ cacheHit: fetched.cacheHit, source: fetched.source, stalePossible: fetched.stalePossible, elapsedMs });
        if (searchHint) meta.hint = searchHint;
        return meta;
      })(),
    };
  }

  async listViewControllers(): Promise<Record<string, unknown>> {
    const startMs = Date.now();
    const fetched = await this.fetchHierarchyInfo();
    const viewControllers = collectViewControllers(
      fetched.hierarchyInfo.displayItems ?? [],
    );
    const elapsedMs = Date.now() - startMs;

    return {
      viewControllers,
      _meta: CacheManager.buildMeta({
        cacheHit: fetched.cacheHit,
        source: fetched.source,
        stalePossible: fetched.stalePossible,
        elapsedMs,
      }),
    };
  }

  async reload(): Promise<Record<string, unknown>> {
    this.cache?.clear();
    const hierarchyInfo = await this.fetchLiveHierarchy();
    const displayItems: any[] = hierarchyInfo.displayItems ?? [];
    const appInfo = hierarchyInfo.appInfo;

    return {
      status: 'reloaded',
      summary: {
        nodeCount: countNodes(displayItems),
        appName: appInfo?.appName ?? null,
        bundleId: appInfo?.appBundleIdentifier ?? null,
        serverVersion: hierarchyInfo.serverVersion ?? null,
      },
    };
  }

  async getView(oid: number): Promise<Record<string, unknown>> {
    const startMs = Date.now();
    const cachedView = this.cache?.getViewDetail(oid);

    if (cachedView) {
      const elapsedMs = Date.now() - startMs;
      return {
        ...cachedView.data,
        _meta: CacheManager.buildMeta({
          cacheHit: true,
          source: 'cache',
          stalePossible: false,
          elapsedMs,
        }),
      };
    }

    const response = await this.withSession(async ({ session }) => {
      const payload = await this.encodePayload({
        $class: 'LookinConnectionAttachment',
        dataType: 0,
        data: oid,
      });
      const responseBuf = await session.request(
        LookinRequestType.AllAttrGroups,
        payload,
        10000,
      );
      return this.decodeBuffer(responseBuf);
    });

    if (response.$class !== 'LookinConnectionResponseAttachment') {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        `Unexpected response class: ${response.$class}`,
      );
    }

    const result = {
      oid,
      attrGroups: (response.data ?? []).map(toAttrGroup),
    };

    this.cache?.setViewDetail(oid, result);
    const elapsedMs = Date.now() - startMs;
    return {
      ...result,
      _meta: CacheManager.buildMeta({
        cacheHit: false,
        source: 'live',
        stalePossible: false,
        elapsedMs,
      }),
    };
  }

  async modifyView(args: {
    oid: number;
    attribute: keyof typeof ATTR_WHITELIST;
    value: unknown;
  }): Promise<Record<string, unknown>> {
    const supportedAttrs = Object.keys(ATTR_WHITELIST).join(', ');
    const spec = ATTR_WHITELIST[args.attribute];

    if (!spec) {
      throw new LookinError(
        'VALIDATION_INVALID_ATTRIBUTE',
        `Unsupported attribute: ${args.attribute}. Supported: ${supportedAttrs}`,
      );
    }

    const validation = validateValue(args.attribute, args.value);
    if (!validation.ok) {
      throw new LookinError('VALIDATION_INVALID_VALUE', validation.reason);
    }

    try {
      const response = await this.withSession(async ({ session }) => {
        const payload = await this.encodePayload({
          $class: 'LookinConnectionAttachment',
          dataType: 0,
          data: {
            $class: 'LookinAttributeModification',
            targetOid: args.oid,
            setterSelector: spec.setter,
            attrType: spec.attrType,
            value: args.value,
            clientReadableVersion: buildReadableVersion(
              args.attribute,
              args.value,
            ),
          },
        });
        const responseBuf = await session.request(
          LookinRequestType.InbuiltAttrModification,
          payload,
          10000,
        );
        return this.decodeBuffer(responseBuf);
      });

      if (response.$class !== 'LookinConnectionResponseAttachment') {
        throw new LookinError(
          'PROTOCOL_UNEXPECTED_RESPONSE',
          `Unexpected response class: ${response.$class}`,
        );
      }

      const detail = response.data ?? {};
      return {
        oid: args.oid,
        attribute: args.attribute,
        value: args.value,
        updatedDetail: {
          frameValue: detail.frameValue ?? null,
          boundsValue: detail.boundsValue ?? null,
          hiddenValue: detail.hiddenValue ?? null,
          alphaValue: detail.alphaValue ?? null,
          attributesGroupList: (detail.attributesGroupList ?? []).map(
            (group: any) => ({
              identifier: group.identifier ?? null,
              sections: (group.attrSections ?? []).map((section: any) => ({
                identifier: section.identifier ?? null,
                attributes: (section.attributes ?? []).map((attr: any) => ({
                  identifier: attr.identifier ?? null,
                  value: attr.value ?? null,
                  attrType: attr.attrType ?? 0,
                })),
              })),
            }),
          ),
        },
      };
    } finally {
      this.cache?.invalidateViewDetail(args.oid);
      this.cache?.markHierarchyStale();
    }
  }

  async getAppInfo(): Promise<Record<string, unknown>> {
    const startMs = Date.now();
    const fetched = await this.fetchHierarchyInfo();
    const appInfo = fetched.hierarchyInfo.appInfo;

    if (!appInfo) {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        'No app info available in hierarchy response',
      );
    }

    const elapsedMs = Date.now() - startMs;
    return {
      appName: appInfo.appName ?? null,
      bundleIdentifier: appInfo.appBundleIdentifier ?? null,
      deviceDescription: appInfo.deviceDescription ?? null,
      osDescription: appInfo.osDescription ?? null,
      osMainVersion: appInfo.osMainVersion ?? null,
      deviceType: appInfo.deviceType ?? null,
      serverVersion: appInfo.serverVersion ?? null,
      serverReadableVersion: appInfo.serverReadableVersion ?? null,
      screenWidth: appInfo.screenWidth ?? null,
      screenHeight: appInfo.screenHeight ?? null,
      screenScale: appInfo.screenScale ?? null,
      _meta: CacheManager.buildMeta({
        cacheHit: fetched.cacheHit,
        source: fetched.source,
        stalePossible: fetched.stalePossible,
        elapsedMs,
      }),
    };
  }

  async getScreenshot(oid: number): Promise<ScreenshotCommandResult> {
    const response = await this.withSession(async ({ session }) => {
      const payload = await this.encodePayload({
        $class: 'LookinConnectionAttachment',
        dataType: 0,
        data: [
          {
            $class: 'LookinStaticAsyncUpdateTasksPackage',
            tasks: [
              {
                $class: 'LookinStaticAsyncUpdateTask',
                oid,
                taskType: 2,
              },
            ],
          },
        ],
      });
      const responseBuf = await session.request(
        LookinRequestType.HierarchyDetails,
        payload,
        15000,
      );
      return this.decodeBuffer(responseBuf);
    });

    if (response.$class !== 'LookinConnectionResponseAttachment') {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        `Unexpected response class: ${response.$class}`,
      );
    }

    const items: any[] = response.data ?? [];
    const detail = items.find((item: any) => item.displayItemOid === oid) ?? items[0];

    if (!detail) {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        `No screenshot data returned for oid ${oid}`,
      );
    }

    const imageBase64 = detail.groupScreenshot ?? detail.soloScreenshot;
    if (!imageBase64) {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        `View oid=${oid} returned no screenshot image`,
      );
    }

    const metadata: Record<string, unknown> = { oid };
    if (detail.frame) metadata.frame = detail.frame;
    if (detail.bounds) metadata.bounds = detail.bounds;
    if (detail.alpha !== undefined) metadata.alpha = detail.alpha;
    if (detail.isHidden !== undefined) metadata.isHidden = detail.isHidden;

    return { metadata, imageBase64 };
  }

  private async fetchHierarchyInfo(): Promise<HierarchyFetchResult> {
    const cached = this.cache?.getHierarchy();
    if (cached) {
      return {
        hierarchyInfo: cached.data,
        cacheHit: true,
        source: 'cache',
        stalePossible: cached.stale,
      };
    }

    return {
      hierarchyInfo: await this.fetchLiveHierarchy(),
      cacheHit: false,
      source: 'live',
      stalePossible: false,
    };
  }

  private async fetchLiveHierarchy(): Promise<any> {
    const response = await this.withSession(async ({ session }) => {
      const responseBuf = await session.request(
        LookinRequestType.Hierarchy,
        undefined,
        15000,
      );
      return this.decodeBuffer(responseBuf);
    });

    const hierarchyInfo = response.data;
    if (!hierarchyInfo || hierarchyInfo.$class !== 'LookinHierarchyInfo') {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        'Unexpected response: missing LookinHierarchyInfo',
      );
    }

    this.cache?.setHierarchy(hierarchyInfo);
    return hierarchyInfo;
  }

  private async withSession<T>(
    handler: (context: EndpointSessionContext) => Promise<T>,
  ): Promise<T> {
    const endpoint = await this.resolveEndpoint();
    const session = new AppSession(endpoint, this.bridge);

    try {
      return await handler({ endpoint, session });
    } finally {
      await session.close();
    }
  }

  private async resolveEndpoint(): Promise<DeviceEndpoint> {
    if (this.fixedEndpoint) {
      return this.fixedEndpoint;
    }

    const found = await this.discovery.probeFirst(2000);
    if (!found) {
      throw new LookinError(
        'DISCOVERY_NO_DEVICE',
        'No reachable LookinServer found on any port',
      );
    }

    return found;
  }

  private async decodeBuffer(buffer: Buffer): Promise<any> {
    return this.bridge.decode(buffer.toString('base64'));
  }

  private async encodePayload(payload: Record<string, unknown>): Promise<Buffer> {
    const base64 = await this.bridge.encode(payload);
    return Buffer.from(base64, 'base64');
  }
}

function toViewNode(
  item: any,
  currentDepth = 0,
  maxDepth?: number,
): HierarchyViewNode {
  const viewObj = item.viewObject ?? item.layerObject;
  const className = viewObj?.classChainList?.[0] ?? 'Unknown';
  const oid = viewObj?.oid ?? 0;
  const layerOid = item.layerObject?.oid ?? oid;
  const node: HierarchyViewNode = {
    oid,
    layerOid,
    className,
    frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
    isHidden: item.isHidden ?? false,
    alpha: item.alpha ?? 0,
  };

  if (item.representedAsKeyWindow) {
    node.isKeyWindow = true;
  }
  if (item.hostViewControllerObject?.classChainList?.[0]) {
    node.viewController = item.hostViewControllerObject.classChainList[0];
  }

  const depthLimitReached =
    maxDepth !== undefined && currentDepth >= maxDepth;
  if (!depthLimitReached && item.subitems?.length) {
    node.subitems = item.subitems.map((child: any) =>
      toViewNode(child, currentDepth + 1, maxDepth),
    );
  }

  return node;
}

function toTextLines(nodes: HierarchyViewNode[], depth = 0): string[] {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);

  for (const node of nodes) {
    const frame = node.frame;
    const parts = [
      `${indent}${node.className} (${frame.x},${frame.y},${frame.width},${frame.height}) oid=${node.oid} layerOid=${node.layerOid}`,
    ];
    if (node.isKeyWindow) parts.push('[KeyWindow]');
    if (node.isHidden) parts.push('(hidden)');
    if (node.alpha !== 1) parts.push(`alpha=${node.alpha}`);
    if (node.viewController) parts.push(`<${node.viewController}>`);
    lines.push(parts.join(' '));

    if (node.subitems?.length) {
      lines.push(...toTextLines(node.subitems, depth + 1));
    }
  }

  return lines;
}

/**
 * Extract text content from attrGroups in get_view response.
 * Text can be in different attribute identifiers depending on the view type:
 * - lb_t_t: UILabel text
 * - tx_t_c: UITextField/UITextView text
 * - bt_t_t: UIButton title
 * - etc.
 */
function extractTextFromAttrGroups(viewData: Record<string, unknown>): string | null {
  const attrGroups = viewData.attrGroups as Array<{
    identifier: string;
    sections?: Array<{
      attributes?: Array<{
        identifier: string;
        value?: unknown;
      }>;
    }>;
  }> | undefined;

  if (!attrGroups) return null;

  for (const group of attrGroups) {
    const sections = group.sections ?? [];
    for (const section of sections) {
      const attributes = section.attributes ?? [];
      for (const attr of attributes) {
        if (attr.identifier.endsWith('_t_t') && typeof attr.value === 'string') {
          return attr.value;
        }
      }
    }
  }

  return null;
}

function flattenItems(
  items: any[],
  parentChain: string[] = [],
): Array<{ item: any; parentChain: string[] }> {
  const result: Array<{ item: any; parentChain: string[] }> = [];

  for (const item of items) {
    const className =
      item.viewObject?.classChainList?.[0] ??
      item.layerObject?.classChainList?.[0] ??
      'Unknown';
    result.push({ item, parentChain: [...parentChain] });

    if (item.subitems?.length) {
      result.push(...flattenItems(item.subitems, [...parentChain, className]));
    }
  }

  return result;
}

function filterSearchResults(
  items: Array<{
    oid: number;
    className: string;
    address: string;
    frame: { x: number; y: number; width: number; height: number };
    isHidden: boolean;
    alpha: number;
    parentChain: string;
  }>,
  query: string,
): SearchResult[] {
  const queryLower = query.toLowerCase();

  return items
    .filter((item) => {
      const matchesClass = item.className.toLowerCase().includes(queryLower);
      const matchesAddress = item.address.toLowerCase().includes(queryLower);
      return matchesClass || matchesAddress;
    })
    .map((item) => ({
      oid: item.oid,
      className: item.className,
      frame: item.frame,
      isHidden: item.isHidden,
      alpha: item.alpha,
      parentChain: item.parentChain,
    }));
}

function collectViewControllers(items: any[]): VCInfo[] {
  const seen = new Set<number>();
  const result: VCInfo[] = [];

  function walk(item: any): void {
    const hostVC = item.hostViewControllerObject;
    if (hostVC) {
      const oid = hostVC.oid ?? 0;
      if (!seen.has(oid)) {
        seen.add(oid);
        result.push({
          className: hostVC.classChainList?.[0] ?? 'Unknown',
          oid,
          hostViewOid: item.viewObject?.oid ?? item.layerObject?.oid ?? 0,
        });
      }
    }

    for (const child of item.subitems ?? []) {
      walk(child);
    }
  }

  for (const item of items) {
    walk(item);
  }

  return result;
}

function countNodes(items: any[]): number {
  let count = 0;
  for (const item of items) {
    count += 1;
    if (item.subitems?.length) {
      count += countNodes(item.subitems);
    }
  }
  return count;
}

function toAttrGroup(group: any) {
  return {
    identifier: group.identifier ?? null,
    userCustomTitle: group.userCustomTitle ?? null,
    sections: (group.attrSections ?? []).map((section: any) => ({
      identifier: section.identifier ?? null,
      attributes: (section.attributes ?? []).map((attr: any) => ({
        identifier: attr.identifier ?? null,
        value: attr.value ?? null,
        attrType: attr.attrType ?? 0,
      })),
    })),
  };
}

function validateValue(
  attribute: string,
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  const spec = ATTR_WHITELIST[attribute];
  if (!spec) {
    return { ok: false, reason: `Unknown attribute: ${attribute}` };
  }

  switch (attribute) {
    case 'hidden':
      if (typeof value !== 'boolean') {
        return { ok: false, reason: 'hidden expects a boolean value' };
      }
      break;
    case 'alpha':
      if (typeof value !== 'number') {
        return { ok: false, reason: 'alpha expects a number (0.0 ~ 1.0)' };
      }
      break;
    case 'frame':
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        !value.every((entry) => typeof entry === 'number')
      ) {
        return {
          ok: false,
          reason: 'frame expects [x, y, width, height] number array',
        };
      }
      break;
    case 'backgroundColor':
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        !value.every((entry) => typeof entry === 'number')
      ) {
        return {
          ok: false,
          reason:
            'backgroundColor expects [r, g, b, a] number array (0.0 ~ 1.0)',
        };
      }
      break;
    case 'text':
      if (typeof value !== 'string') {
        return { ok: false, reason: 'text expects a string value' };
      }
      break;
  }

  return { ok: true };
}

function buildReadableVersion(attribute: string, value: unknown): string {
  switch (attribute) {
    case 'hidden':
      return `hidden = ${value}`;
    case 'alpha':
      return `opacity = ${value}`;
    case 'frame': {
      const [x, y, width, height] = value as number[];
      return `frame = (${x}, ${y}, ${width}, ${height})`;
    }
    case 'backgroundColor': {
      const [r, g, b, a] = value as number[];
      return `backgroundColor = rgba(${r}, ${g}, ${b}, ${a})`;
    }
    case 'text':
      return `text = "${value}"`;
    default:
      return `${attribute} = ${JSON.stringify(value)}`;
  }
}
