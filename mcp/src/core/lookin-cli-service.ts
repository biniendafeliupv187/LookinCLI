import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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
  viewMemoryAddress: string | null;
  isKeyWindow?: boolean;
  viewController?: string;
  ivarAnnotation?: string;
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
  savedPath?: string;
}

export const ATTR_WHITELIST: Record<
  string,
  { setter: string; attrType: number; target: 'layer' | 'view' }
> = {
  hidden: { setter: 'setHidden:', attrType: 14, target: 'layer' },
  alpha: { setter: 'setOpacity:', attrType: 12, target: 'layer' },
  frame: { setter: 'setFrame:', attrType: 20, target: 'layer' },
  backgroundColor: {
    setter: 'setLks_backgroundColor:',
    attrType: 27,
    target: 'layer',
  },
  text: { setter: 'setText:', attrType: 24, target: 'view' },
  // Layer visual attributes
  cornerRadius: { setter: 'setCornerRadius:', attrType: 13, target: 'layer' },
  borderWidth: { setter: 'setBorderWidth:', attrType: 13, target: 'layer' },
  borderColor: { setter: 'setLks_borderColor:', attrType: 27, target: 'layer' },
  shadowColor: { setter: 'setLks_shadowColor:', attrType: 27, target: 'layer' },
  shadowOpacity: { setter: 'setShadowOpacity:', attrType: 12, target: 'layer' },
  shadowRadius: { setter: 'setShadowRadius:', attrType: 13, target: 'layer' },
  shadowOffsetX: { setter: 'setLks_shadowOffsetWidth:', attrType: 13, target: 'layer' },
  shadowOffsetY: { setter: 'setLks_shadowOffsetHeight:', attrType: 13, target: 'layer' },
  masksToBounds: { setter: 'setMasksToBounds:', attrType: 14, target: 'layer' },
};

export interface LookinCliServiceOptions {
  fixedEndpoint?: DeviceEndpoint;
  cache?: CacheManager;
  bridgeClient?: BridgeClient;
  discovery?: DeviceDiscovery;
  screenshotsDir?: string;
}

interface HierarchyFetchResult {
  hierarchyInfo: any;
  cacheHit: boolean;
  source: 'cache' | 'live';
  stalePossible: boolean;
  scopeKey: string;
}

interface EndpointSessionContext {
  endpoint: DeviceEndpoint;
  session: AppSession;
}

interface SearchResult {
  oid: number;
  layerOid: number;
  className: string;
  frame: { x: number; y: number; width: number; height: number };
  isHidden: boolean;
  alpha: number;
  parentChain: string;
  viewMemoryAddress: string | null;
  text?: string;
}

interface VCInfo {
  className: string;
  oid: number;
  hostViewOid: number;
}

const MAX_TEXT_CANDIDATES = 200;
const TEXT_HINT_THRESHOLD = 50;
const TEXT_SEARCH_BATCH_SIZE = 5;

export class LookinCliService {
  private readonly fixedEndpoint?: DeviceEndpoint;
  private readonly cache?: CacheManager;
  private readonly discovery: DeviceDiscovery;
  private readonly bridge: BridgeClient;
  private readonly screenshotsDir: string;

  constructor(options: LookinCliServiceOptions = {}) {
    this.fixedEndpoint = options.fixedEndpoint;
    this.cache = options.cache;
    this.discovery = options.discovery ?? new DeviceDiscovery();
    this.bridge = options.bridgeClient ?? new BridgeClient();
    this.screenshotsDir = options.screenshotsDir ?? path.join(os.homedir(), 'LookinCLI', 'screenshots');
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

    if (text) {
      return this.searchByText(query, text, startMs);
    }

    const fetched = await this.fetchHierarchyInfo();
    const cachedIndex = this.cache?.getSearchIndex(fetched.scopeKey);

    if (cachedIndex) {
      const results = filterSearchResults(cachedIndex, query ?? '');
      const elapsedMs = Date.now() - startMs;
      const stalePossible = fetched.stalePossible;
      return {
        query: query ?? null,
        text: null,
        resultCount: results.length,
        results,
        _meta: CacheManager.buildMeta({
          cacheHit: fetched.cacheHit,
          source: fetched.source,
          stalePossible,
          elapsedMs,
        }),
      };
    }
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
          layerOid: item.layerObject?.oid ?? 0,
          className,
          frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
          isHidden: item.isHidden ?? false,
          alpha: item.alpha ?? 0,
          parentChain: parentChain.join(' > '),
          viewMemoryAddress: item.viewObject?.memoryAddress ?? null,
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
    let cacheHit = true;
    let source: 'cache' | 'live' = 'cache';
    const fetched = await this.fetchHierarchyInfo();
    let stalePossible = this.cache?.peekHierarchy(fetched.scopeKey)?.stale ?? false;
    cacheHit = fetched.cacheHit;
    source = fetched.source;
    stalePossible = fetched.stalePossible;

    let allCandidates: SearchResult[];
    const cachedIndex = this.cache?.getSearchIndex(fetched.scopeKey);
    if (cachedIndex) {
      allCandidates = filterSearchResults(cachedIndex, query ?? '');
    } else {
      allCandidates = buildCandidatesFromHierarchy(
        fetched.hierarchyInfo.displayItems ?? [],
        query,
      );
    }

    let searchHint: string | undefined;
    if (allCandidates.length > MAX_TEXT_CANDIDATES) {
      searchHint = `text search capped at ${MAX_TEXT_CANDIDATES} of ${allCandidates.length} candidates; consider adding --query to filter first`;
    } else if (!query && allCandidates.length > TEXT_HINT_THRESHOLD) {
      searchHint = `text-only search has ${allCandidates.length} candidates; consider adding --query to filter first`;
    }

    const candidates = allCandidates.slice(0, MAX_TEXT_CANDIDATES);
    const results = await this.fetchTextMatches(candidates, textQuery, fetched.scopeKey);

    const elapsedMs = Date.now() - startMs;
    const meta = CacheManager.buildMeta({ cacheHit, source, stalePossible, elapsedMs });
    if (searchHint) meta.hint = searchHint;
    return {
      query: query ?? null,
      text: textQuery,
      resultCount: results.length,
      results,
      _meta: meta,
    };
  }

  private async fetchTextMatches(
    candidates: SearchResult[],
    textQuery: string,
    scopeKey: string,
  ): Promise<SearchResult[]> {
    const textLower = textQuery.toLowerCase();

    return this.withSession(async ({ session }) => {
      const results: SearchResult[] = [];

      for (let i = 0; i < candidates.length; i += TEXT_SEARCH_BATCH_SIZE) {
        const batch = candidates.slice(i, i + TEXT_SEARCH_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (candidate) => {
            if (candidate.oid === 0) return null;
            try {
              const viewData = await this.fetchViewAttrs(candidate.oid, session, scopeKey);
              const text = extractTextFromAttrGroups(viewData);
              if (text && text.toLowerCase().includes(textLower)) {
                return { ...candidate, text };
              }
            } catch {
              // Individual view fetch failures are non-fatal
            }
            return null;
          }),
        );
        for (const r of batchResults) {
          if (r) results.push(r);
        }
      }

      return results;
    });
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
    const endpoint = await this.resolveEndpoint();
    const currentScopeKey = this.getActiveScopeKey(endpoint);
    if (currentScopeKey) {
      this.cache?.clear(currentScopeKey);
    }
    const hierarchyInfo = await this.fetchLiveHierarchy(endpoint);
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

  async getView(oid: number, options?: { includeConstraints?: boolean }): Promise<Record<string, unknown>> {
    const startMs = Date.now();
    const endpoint = await this.resolveEndpoint();
    let activeScopeKey = this.getActiveScopeKey(endpoint);
    const cachedView = activeScopeKey
      ? this.cache?.getViewDetail(activeScopeKey, oid)
      : this.cache?.getViewDetail(oid);

    if (cachedView) {
      const cachedHierarchy = this.cache?.peekHierarchy(activeScopeKey ?? 'global');
      const viewObjectData = findViewObjectByLayerOid(
        cachedHierarchy?.data?.displayItems ?? [],
        oid,
      );
      const elapsedMs = Date.now() - startMs;
      return {
        ...cachedView.data,
        ...buildViewObjectFields(viewObjectData),
        ...(options?.includeConstraints ? { constraints: extractConstraints(cachedView.data.attrGroups) } : {}),
        _meta: CacheManager.buildMeta({
          cacheHit: true,
          source: 'cache',
          stalePossible: false,
          elapsedMs,
        }),
      };
    }

    // Fetch hierarchy to enrich response with ivarTrace/memoryAddress.
    // Non-fatal: if hierarchy fetch fails for any reason, getView still returns attr groups.
    let viewObjectData: any = null;
    try {
      const hierarchyFetched = await this.fetchHierarchyInfo(endpoint);
      viewObjectData = findViewObjectByLayerOid(
        hierarchyFetched.hierarchyInfo.displayItems ?? [],
        oid,
      );
      // Refresh scope key — it may have just been registered by the hierarchy fetch.
      activeScopeKey = this.getActiveScopeKey(endpoint) ?? hierarchyFetched.scopeKey;
    } catch {
      // Hierarchy unavailable — proceed without ivarTrace/viewMemoryAddress enrichment.
    }
    const scopeKey = activeScopeKey ?? 'global';

    const result = await this.withSession(
      async ({ session }) => this.fetchViewAttrs(oid, session, scopeKey),
      endpoint,
    );

    const elapsedMs = Date.now() - startMs;
    return {
      ...result,
      ...buildViewObjectFields(viewObjectData),
      ...(options?.includeConstraints ? { constraints: extractConstraints(result.attrGroups) } : {}),
      _meta: CacheManager.buildMeta({
        cacheHit: false,
        source: 'live',
        stalePossible: false,
        elapsedMs,
      }),
    };
  }

  /**
   * Fetch view attributes using an existing session. Caches the result.
   * Shared by getView (single call) and fetchTextMatches (batch reuse).
   */
  private async fetchViewAttrs(
    oid: number,
    session: AppSession,
    scopeKey: string,
  ): Promise<{ oid: number; attrGroups: any[] }> {
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
    const response = await this.decodeBuffer(responseBuf);

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

    this.cache?.setViewDetail(scopeKey, oid, result);
    return result;
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

    const endpoint = await this.resolveEndpoint();
    const scopeKey = await this.validateModifyTarget(
      args.oid,
      spec.target,
      args.attribute,
      endpoint,
    );

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

      if (response.error) {
        throw new LookinError(
          'PROTOCOL_REMOTE_ERROR',
          response.error.description ??
            response.error.localizedDescription ??
            'Remote modification failed',
          {
            domain: response.error.domain ?? null,
            remoteCode: response.error.code ?? null,
          },
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
          attributesGroupList: (detail.attributesGroupList ?? []).map(toAttrGroup),
        },
      };
    } finally {
      if (scopeKey) {
        this.cache?.invalidateViewDetail(scopeKey, args.oid);
        this.cache?.markHierarchyStale(scopeKey);
      }
    }
  }

  async getAppInfo(): Promise<Record<string, unknown>> {
    const startMs = Date.now();
    const endpoint = await this.resolveEndpoint();
    let pingResponse: any;
    try {
      pingResponse = await this.withSession(
        async ({ session }) => session.ping(5000),
        endpoint,
      );
    } catch (error) {
      const activeScopeKey = this.getActiveScopeKey(endpoint);
      const cachedHierarchy = activeScopeKey
        ? this.cache?.getHierarchy(activeScopeKey)
        : null;
      const cachedAppInfo = cachedHierarchy?.data?.appInfo;

      if (!cachedAppInfo) {
        throw error;
      }

      const elapsedMs = Date.now() - startMs;
      return {
        appName: cachedAppInfo.appName ?? null,
        bundleIdentifier: cachedAppInfo.appBundleIdentifier ?? null,
        deviceDescription: cachedAppInfo.deviceDescription ?? null,
        osDescription: cachedAppInfo.osDescription ?? null,
        osMainVersion: cachedAppInfo.osMainVersion ?? null,
        deviceType: cachedAppInfo.deviceType ?? null,
        serverVersion: cachedAppInfo.serverVersion ?? null,
        serverReadableVersion: cachedAppInfo.serverReadableVersion ?? null,
        screenWidth: cachedAppInfo.screenWidth ?? null,
        screenHeight: cachedAppInfo.screenHeight ?? null,
        screenScale: cachedAppInfo.screenScale ?? null,
        _meta: CacheManager.buildMeta({
          cacheHit: true,
          source: 'cache',
          stalePossible: cachedHierarchy.stale,
          elapsedMs,
        }),
      };
    }
    const pingAppInfo = pingResponse?.data;
    const hasPingAppInfo =
      pingAppInfo &&
      typeof pingAppInfo === 'object' &&
      (
        pingAppInfo.appName !== undefined ||
        pingAppInfo.appBundleIdentifier !== undefined ||
        pingAppInfo.deviceDescription !== undefined
      );

    if (hasPingAppInfo) {
      const elapsedMs = Date.now() - startMs;
      return {
        appName: pingAppInfo.appName ?? null,
        bundleIdentifier: pingAppInfo.appBundleIdentifier ?? null,
        deviceDescription: pingAppInfo.deviceDescription ?? null,
        osDescription: pingAppInfo.osDescription ?? null,
        osMainVersion: pingAppInfo.osMainVersion ?? null,
        deviceType: pingAppInfo.deviceType ?? null,
        serverVersion: pingAppInfo.serverVersion ?? pingResponse?.lookinServerVersion ?? null,
        serverReadableVersion: pingAppInfo.serverReadableVersion ?? null,
        screenWidth: pingAppInfo.screenWidth ?? null,
        screenHeight: pingAppInfo.screenHeight ?? null,
        screenScale: pingAppInfo.screenScale ?? null,
        _meta: CacheManager.buildMeta({
          cacheHit: false,
          source: 'live',
          stalePossible: false,
          elapsedMs,
        }),
      };
    }

    const fetched = await this.fetchHierarchyInfo();
    const appInfo = fetched.hierarchyInfo.appInfo;

    if (!appInfo) {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        'No app info available in ping attachment or hierarchy response',
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
      serverVersion: appInfo.serverVersion ?? pingResponse?.lookinServerVersion ?? null,
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
    const fetchedHierarchy = await this.fetchHierarchyInfo().catch(() => null);
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

    const className = fetchedHierarchy
      ? (
          findDisplayItemByLayerOid(fetchedHierarchy.hierarchyInfo.displayItems ?? [], oid)
            ?.viewObject?.classChainList?.[0] ??
          findDisplayItemByLayerOid(fetchedHierarchy.hierarchyInfo.displayItems ?? [], oid)
            ?.layerObject?.classChainList?.[0] ??
          String(oid)
        )
      : String(oid);
    const savedPath = await this.saveScreenshotToDisk(imageBase64, className);
    return { metadata, imageBase64, savedPath };
  }

  private async saveScreenshotToDisk(base64: string, className: string): Promise<string> {
    const dir = this.screenshotsDir;
    await fs.promises.mkdir(dir, { recursive: true });
    const timestamp = Date.now();
    const safeName = className.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filename = `${timestamp}_${safeName}.png`;
    const filePath = path.join(dir, filename);
    const imageData = Buffer.from(base64, 'base64');
    await fs.promises.writeFile(filePath, imageData);
    return filePath;
  }

  // ─── Task 5: get_memory_address ─────────────────────────────────────────────

  async getMemoryAddress(input: { query?: string; text?: string; viewOid?: number }): Promise<Record<string, unknown>> {
    if (input.query === undefined && input.text === undefined && input.viewOid === undefined) {
      throw new LookinError('VALIDATION_MISSING_INPUT', 'At least one of query, text, or viewOid must be provided');
    }

    if (input.text) {
      const searchResult = await this.search(input.query, input.text);
      const results = Array.isArray(searchResult.results)
        ? searchResult.results.map((entry: any) => ({
            oid: entry.oid ?? 0,
            className: entry.className ?? 'Unknown',
            viewMemoryAddress: entry.viewMemoryAddress ?? null,
            layerOid: entry.layerOid ?? null,
            text: entry.text ?? null,
          }))
        : [];
      return { results };
    }

    const fetched = await this.fetchHierarchyInfo();
    const flattened = flattenItems(fetched.hierarchyInfo.displayItems ?? []);
    const results: Array<Record<string, unknown>> = [];

    for (const { item } of flattened) {
      const viewObj = item.viewObject ?? item.layerObject;
      const className = viewObj?.classChainList?.[0] ?? 'Unknown';
      let matches = false;
      if (input.viewOid !== undefined) {
        matches = item.viewObject?.oid === input.viewOid;
      } else if (input.query) {
        matches = className.toLowerCase().includes(input.query.toLowerCase());
      }
      if (matches) {
        results.push({
          oid: viewObj?.oid ?? 0,
          className,
          viewMemoryAddress: item.viewObject?.memoryAddress ?? null,
          layerOid: item.layerObject?.oid ?? 0,
        });
      }
    }

    return { results };
  }

  // ─── Task 6: measure_distance ────────────────────────────────────────────────

  async measureDistance(layerOidA: number, layerOidB: number): Promise<Record<string, unknown>> {
    const fetched = await this.fetchHierarchyInfo();
    const hierarchyItems = fetched.hierarchyInfo.displayItems ?? [];
    const geometryA = calculateFrameToRoot(hierarchyItems, layerOidA);
    const geometryB = calculateFrameToRoot(hierarchyItems, layerOidB);

    if (!geometryA || !geometryB) {
      const missingOid = geometryA ? layerOidB : layerOidA;
      throw new LookinError('NOT_FOUND', `No display item found for layerOid ${missingOid}`);
    }

    if (geometryA.rootLayerOid !== geometryB.rootLayerOid) {
      throw new LookinError(
        'VALIDATION_INVALID_TARGET',
        `layerOid ${layerOidA} and ${layerOidB} are not in a common root coordinate system`,
      );
    }

    const frameA = geometryA.frame;
    const frameB = geometryB.frame;
    const aLeft = frameA.x, aRight = frameA.x + frameA.width;
    const aTop = frameA.y, aBottom = frameA.y + frameA.height;
    const bLeft = frameB.x, bRight = frameB.x + frameB.width;
    const bTop = frameB.y, bBottom = frameB.y + frameB.height;

    const containsAContainsB =
      aLeft <= bLeft && aRight >= bRight && aTop <= bTop && aBottom >= bBottom;
    const containsBContainsA =
      bLeft <= aLeft && bRight >= aRight && bTop <= aTop && bBottom >= aBottom;

    if (containsAContainsB || containsBContainsA) {
      const container = containsAContainsB ? frameA : frameB;
      const containee = containsAContainsB ? frameB : frameA;
      return {
        relationship: 'containing',
        classA: geometryA.className,
        classB: geometryB.className,
        top: containee.y - container.y,
        bottom: (container.y + container.height) - (containee.y + containee.height),
        left: containee.x - container.x,
        right: (container.x + container.width) - (containee.x + containee.width),
      };
    }

    const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
    const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
    const horizontalDistance =
      overlapX > 0 ? -overlapX : Math.max(bLeft - aRight, aLeft - bRight);
    const verticalDistance =
      overlapY > 0 ? -overlapY : Math.max(bTop - aBottom, aTop - bBottom);
    const relationship = overlapX > 0 && overlapY > 0 ? 'overlapping' : 'separated';

    return {
      relationship,
      classA: geometryA.className,
      classB: geometryB.className,
      top: verticalDistance,
      bottom: verticalDistance,
      left: horizontalDistance,
      right: horizontalDistance,
    };
  }

  // ─── Task 7: get_event_handlers ──────────────────────────────────────────────

  async getEventHandlers(layerOid: number): Promise<Record<string, unknown>> {
    const fetched = await this.fetchHierarchyInfo();
    const items = flattenItems(fetched.hierarchyInfo.displayItems ?? []);
    const entry = items.find(({ item }) => item.layerObject?.oid === layerOid);
    if (!entry) {
      throw new LookinError('NOT_FOUND', `No display item found for layerOid ${layerOid}`);
    }
    const rawHandlers: any[] = entry.item.eventHandlers ?? [];
    const eventHandlers = rawHandlers.map((h: any) => {
      const targetActions = (h.targetActions ?? []).map((t: any) => ({
        target: t.first ?? null,
        action: t.second ?? null,
      }));
      const base: Record<string, unknown> = {
        type: h.handlerType === 1 ? 'gesture' : 'targetAction',
        eventName: h.eventName ?? null,
        targetActions,
      };
      if (h.handlerType === 0) {
      } else {
        base.recognizerOid = h.recognizerOid ?? 0;
        base.enabled = h.gestureRecognizerIsEnabled ?? true;
        base.delegator = h.gestureRecognizerDelegator ?? null;
        base.gestureRecognizerIsEnabled = base.enabled;
        base.gestureRecognizerDelegator = base.delegator;
      }
      return base;
    });
    return { layerOid, eventHandlers };
  }

  // ─── Task 8: get_methods ──────────────────────────────────────────────────────

  async getMethods(input: { oid?: number; className?: string; includeArgs?: boolean }): Promise<Record<string, unknown>> {
    if (input.oid === undefined && input.className === undefined) {
      throw new LookinError('VALIDATION_MISSING_INPUT', 'At least one of oid or className must be provided');
    }

    let resolvedClassName = input.className;
    let classHierarchy: string[] | undefined;
    if (!resolvedClassName && input.oid !== undefined) {
      // Resolve className from hierarchy
      const fetched = await this.fetchHierarchyInfo();
      const items = flattenItems(fetched.hierarchyInfo.displayItems ?? []);
      const entry = items.find(({ item }) => item.layerObject?.oid === input.oid);
      if (!entry) {
        throw new LookinError('NOT_FOUND', `No display item found for layerOid ${input.oid}`);
      }
      const viewObj = entry.item.viewObject ?? entry.item.layerObject;
      resolvedClassName = viewObj?.classChainList?.[0] ?? null;
      classHierarchy = Array.isArray(viewObj?.classChainList)
        ? viewObj.classChainList.filter((value: unknown): value is string => typeof value === 'string')
        : undefined;
      if (!resolvedClassName) {
        throw new LookinError('NOT_FOUND', `Could not determine className for layerOid ${input.oid}`);
      }
    }

    const includeArgs = input.includeArgs ?? false;
    const endpoint = await this.resolveEndpoint();
    const rawMethods = await this.withSession(async ({ session }) => {
      const payload = await this.encodePayload({
        $class: 'LookinConnectionAttachment',
        dataType: 0,
        data: { className: resolvedClassName, hasArg: includeArgs },
      });
      const responseBuf = await session.request(LookinRequestType.AllSelectorNames, payload, 10000);
      const response = await this.decodeBuffer(responseBuf);
      return response.data ?? [];
    }, endpoint);

    const methodsByClass = normalizeMethodsByClass(rawMethods, resolvedClassName!);
    const filteredMethodsByClass = Object.fromEntries(
      Object.entries(methodsByClass).map(([className, methods]) => [
        className,
        methods.filter((method) => includeArgs || !method.includes(':')),
      ]),
    );
    const methods = Object.values(filteredMethodsByClass).flat();

    return {
      className: resolvedClassName,
      classHierarchy: classHierarchy ?? [resolvedClassName!],
      includeArgs,
      methods,
      methodsByClass: filteredMethodsByClass,
    };
  }

  // ─── Task 9: get_image ────────────────────────────────────────────────────────

  async getImage(layerOid: number): Promise<Record<string, unknown>> {
    const fetched = await this.fetchHierarchyInfo();
    const targetItem = findDisplayItemByLayerOid(fetched.hierarchyInfo.displayItems ?? [], layerOid);
    if (!targetItem) {
      throw new LookinError('NOT_FOUND', `No display item found for layerOid ${layerOid}`);
    }

    const classChain =
      targetItem.viewObject?.classChainList ??
      targetItem.layerObject?.classChainList ??
      [];
    const className =
      classChain[0] ??
      targetItem.layerObject?.classChainList?.[0] ??
      'Unknown';
    if (!classChain.includes('UIImageView')) {
      throw new LookinError(
        'VALIDATION_INVALID_TARGET',
        `oid ${layerOid} is ${className}, not UIImageView`,
      );
    }

    const endpoint = await this.resolveEndpoint();
    const response = await this.withSession(async ({ session }) => {
      const payload = await this.encodePayload({
        $class: 'LookinConnectionAttachment',
        dataType: 0,
        data: layerOid,
      });
      const responseBuf = await session.request(LookinRequestType.FetchImageViewImage, payload, 10000);
      return this.decodeBuffer(responseBuf);
    }, endpoint);

    if (response.$class !== 'LookinConnectionResponseAttachment') {
      throw new LookinError('PROTOCOL_UNEXPECTED_RESPONSE', `Unexpected response class: ${response.$class}`);
    }

    const data = response.data;
    const imageBase64: string = data?.imageBase64 ?? data;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new LookinError('PROTOCOL_UNEXPECTED_RESPONSE', `No image data returned for layerOid ${layerOid}`);
    }

    const savedPath = await this.saveScreenshotToDisk(imageBase64, `${className}_image`);
    return {
      imageBase64,
      imageSize: data?.imageSize ?? null,
      savedPath,
    };
  }

  // ─── Task 10: toggle_gesture ─────────────────────────────────────────────────

  async toggleGesture(input: { recognizerOid: number; enabled: boolean }): Promise<Record<string, unknown>> {
    const endpoint = await this.resolveEndpoint();
    const response = await this.withSession(async ({ session }) => {
      const payload = await this.encodePayload({
        $class: 'LookinConnectionAttachment',
        dataType: 0,
        data: { recognizerOid: input.recognizerOid, enabled: input.enabled },
      });
      const responseBuf = await session.request(LookinRequestType.ModifyRecognizerEnable, payload, 10000);
      return this.decodeBuffer(responseBuf);
    }, endpoint);

    if (response?.error) {
      throw new LookinError(
        'PROTOCOL_REMOTE_ERROR',
        response.error.description ??
          response.error.localizedDescription ??
          'Remote gesture toggle failed',
      );
    }

    return {
      success: true,
      recognizerOid: input.recognizerOid,
      enabled: input.enabled,
      gestureType: response?.data?.gestureType ?? null,
    };
  }

  private async fetchHierarchyInfo(endpoint?: DeviceEndpoint): Promise<HierarchyFetchResult> {
    const resolvedEndpoint = endpoint ?? await this.resolveEndpoint();
    const activeScopeKey = this.getActiveScopeKey(resolvedEndpoint);

    if (activeScopeKey) {
      const cached = this.cache?.getHierarchy(activeScopeKey);
      if (cached) {
        return {
          hierarchyInfo: cached.data,
          cacheHit: true,
          source: 'cache',
          stalePossible: cached.stale,
          scopeKey: activeScopeKey,
        };
      }
    }

    const hierarchyInfo = await this.fetchLiveHierarchy(resolvedEndpoint);
    return {
      hierarchyInfo,
      cacheHit: false,
      source: 'live',
      stalePossible: false,
      scopeKey: buildScopeKey(hierarchyInfo),
    };
  }

  private async fetchLiveHierarchy(endpoint?: DeviceEndpoint): Promise<any> {
    const response = await this.withSession(async ({ session }) => {
      const responseBuf = await session.request(
        LookinRequestType.Hierarchy,
        undefined,
        15000,
      );
      return this.decodeBuffer(responseBuf);
    }, endpoint);

    const hierarchyInfo = response.data;
    if (!hierarchyInfo || hierarchyInfo.$class !== 'LookinHierarchyInfo') {
      throw new LookinError(
        'PROTOCOL_UNEXPECTED_RESPONSE',
        'Unexpected response: missing LookinHierarchyInfo',
      );
    }

    const scopeKey = buildScopeKey(hierarchyInfo);
    this.cache?.setHierarchy(scopeKey, hierarchyInfo);
    const resolvedEndpoint = endpoint ?? await this.resolveEndpoint();
    this.cache?.setActiveScopeKey(buildEndpointCacheKey(resolvedEndpoint), scopeKey);
    return hierarchyInfo;
  }

  private async validateModifyTarget(
    oid: number,
    target: 'layer' | 'view',
    attribute: keyof typeof ATTR_WHITELIST,
    endpoint?: DeviceEndpoint,
  ): Promise<string> {
    const fetched = await this.fetchHierarchyInfo(endpoint);
    const targetInfo = findTargetOidKind(fetched.hierarchyInfo.displayItems ?? [], oid);

    if (!targetInfo) {
      throw new LookinError(
        'VALIDATION_INVALID_TARGET',
        `oid ${oid} was not found in the current hierarchy. Refresh hierarchy and retry.`,
      );
    }

    const expectedField = target === 'view' ? 'oid' : 'layerOid';
    const actualField = targetInfo.kind === 'view' ? 'oid' : 'layerOid';
    if (targetInfo.kind !== target) {
      throw new LookinError(
        'VALIDATION_INVALID_TARGET',
        `Attribute "${attribute}" expects ${expectedField}, but ${oid} matches ${actualField}.`,
      );
    }

    return fetched.scopeKey;
  }

  private getActiveScopeKey(endpoint: DeviceEndpoint): string | null {
    return getEndpointScopeKey(this.cache, endpoint);
  }

  private async withSession<T>(
    handler: (context: EndpointSessionContext) => Promise<T>,
    endpoint?: DeviceEndpoint,
  ): Promise<T> {
    const resolvedEndpoint = endpoint ?? await this.resolveEndpoint();
    const session = new AppSession(resolvedEndpoint, this.bridge);

    try {
      return await handler({ endpoint: resolvedEndpoint, session });
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

function buildEndpointCacheKey(endpoint: DeviceEndpoint): string {
  return `${endpoint.transport}:${endpoint.host}:${endpoint.port}`;
}

function getEndpointScopeKey(cache: CacheManager | undefined, endpoint: DeviceEndpoint): string | null {
  if (!cache) return null;
  return cache.getActiveScopeKey(buildEndpointCacheKey(endpoint));
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
  const viewMemoryAddress: string | null = item.viewObject?.memoryAddress ?? null;

  // Build ivar annotation from first ivarTrace entry if available
  const ivarTraces: any[] = item.viewObject?.ivarTraces ?? [];
  const firstIvar = ivarTraces[0];
  const ivarAnnotation = firstIvar
    ? `[${firstIvar.hostClassName}._${firstIvar.ivarName.replace(/^_/, '')}]`
    : undefined;

  const node: HierarchyViewNode = {
    oid,
    layerOid,
    className,
    frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
    isHidden: item.isHidden ?? false,
    alpha: item.alpha ?? 0,
    viewMemoryAddress,
  };

  if (ivarAnnotation) {
    node.ivarAnnotation = ivarAnnotation;
  }

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
    if (node.ivarAnnotation) parts.push(node.ivarAnnotation);
    lines.push(parts.join(' '));

    if (node.subitems?.length) {
      lines.push(...toTextLines(node.subitems, depth + 1));
    }
  }

  return lines;
}

/**
 * Extract text content from attrGroups in get_view response.
 * Collects all attributes whose identifier ends with `_t_t` (the Lookin
 * convention for text-type attrs: lb_t_t, bt_t_t, tx_t_c, etc.).
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

  const texts: string[] = [];
  for (const group of attrGroups) {
    for (const section of group.sections ?? []) {
      for (const attr of section.attributes ?? []) {
        if (attr.identifier.endsWith('_t_t') && typeof attr.value === 'string') {
          texts.push(attr.value);
        }
      }
    }
  }

  return texts.length > 0 ? texts.join(' ') : null;
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

function findDisplayItemByLayerOid(items: any[], layerOid: number): any | null {
  for (const item of items) {
    if (item.layerObject?.oid === layerOid) {
      return item;
    }
    const nested = findDisplayItemByLayerOid(item.subitems ?? [], layerOid);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function calculateFrameToRoot(
  items: any[],
  layerOid: number,
  offsetX = 0,
  offsetY = 0,
  rootLayerOid?: number,
): { frame: { x: number; y: number; width: number; height: number }; className: string; rootLayerOid: number } | null {
  for (const item of items) {
    const frame = item.frame ?? { x: 0, y: 0, width: 0, height: 0 };
    const absoluteFrame = {
      x: offsetX + (frame.x ?? 0),
      y: offsetY + (frame.y ?? 0),
      width: frame.width ?? 0,
      height: frame.height ?? 0,
    };
    const currentRootLayerOid = rootLayerOid ?? item.layerObject?.oid ?? 0;
    if (item.layerObject?.oid === layerOid) {
      return {
        frame: absoluteFrame,
        className:
          item.viewObject?.classChainList?.[0] ??
          item.layerObject?.classChainList?.[0] ??
          'Unknown',
        rootLayerOid: currentRootLayerOid,
      };
    }
    const nested = calculateFrameToRoot(
      item.subitems ?? [],
      layerOid,
      absoluteFrame.x,
      absoluteFrame.y,
      currentRootLayerOid,
    );
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findTargetOidKind(
  items: any[],
  oid: number,
): { kind: 'view' | 'layer' } | null {
  for (const item of items) {
    if ((item.viewObject?.oid ?? 0) === oid) {
      return { kind: 'view' };
    }
    if ((item.layerObject?.oid ?? 0) === oid) {
      return { kind: 'layer' };
    }
    const nested = findTargetOidKind(item.subitems ?? [], oid);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function filterSearchResults(
  items: Array<{
    oid: number;
    layerOid: number;
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
      layerOid: item.layerOid,
      className: item.className,
      frame: item.frame,
      isHidden: item.isHidden,
      alpha: item.alpha,
      parentChain: item.parentChain,
      viewMemoryAddress: item.address ?? null,
    }));
}

function buildCandidatesFromHierarchy(
  displayItems: any[],
  query: string | undefined,
): SearchResult[] {
  const flattened = flattenItems(displayItems);
  const queryLower = (query ?? '').toLowerCase();

  return flattened
    .filter(({ item }) => {
      if (!query) return true;
      const viewObj = item.viewObject ?? item.layerObject;
      const className = viewObj?.classChainList?.[0] ?? 'Unknown';
      const address = viewObj?.memoryAddress ?? '';
      return className.toLowerCase().includes(queryLower) || address.toLowerCase().includes(queryLower);
    })
    .map(({ item, parentChain }) => {
      const viewObj = item.viewObject ?? item.layerObject;
      return {
        oid: viewObj?.oid ?? 0,
        layerOid: item.layerObject?.oid ?? 0,
        className: viewObj?.classChainList?.[0] ?? 'Unknown',
        frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
        isHidden: item.isHidden ?? false,
        alpha: item.alpha ?? 0,
        parentChain: parentChain.join(' > '),
        viewMemoryAddress: item.viewObject?.memoryAddress ?? null,
      };
    });
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

function buildScopeKey(hierarchyInfo: any): string {
  const appInfo = hierarchyInfo?.appInfo ?? {};
  const bundleId = appInfo.appBundleIdentifier ?? 'unknown-bundle';
  const deviceDescription = appInfo.deviceDescription ?? 'unknown-device';
  const rootItems: any[] = hierarchyInfo?.displayItems ?? [];
  const fingerprint = rootItems
    .map((item) => {
      const viewObj = item.viewObject ?? item.layerObject ?? {};
      const className = viewObj.classChainList?.[0] ?? 'Unknown';
      const oid = viewObj.oid ?? 0;
      const frame = item.frame ?? {};
      return `${className}:${oid}:${frame.x ?? 0},${frame.y ?? 0},${frame.width ?? 0},${frame.height ?? 0}`;
    })
    .join('|');

  return `${bundleId}::${deviceDescription}::${fingerprint}`;
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
    case 'cornerRadius':
    case 'borderWidth':
    case 'shadowOpacity':
    case 'shadowRadius':
    case 'shadowOffsetX':
    case 'shadowOffsetY':
      if (typeof value !== 'number') {
        return { ok: false, reason: `${attribute} expects a number value` };
      }
      break;
    case 'borderColor':
    case 'shadowColor':
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        !value.every((entry) => typeof entry === 'number')
      ) {
        return {
          ok: false,
          reason: `${attribute} expects [r, g, b, a] number array (0.0 ~ 1.0)`,
        };
      }
      break;
    case 'masksToBounds':
      if (typeof value !== 'boolean') {
        return { ok: false, reason: 'masksToBounds expects a boolean value' };
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

// ─── ivarTrace / constraint helpers ─────────────────────────────────────────

/** Find the display item in a hierarchy whose layerObject.oid matches the given oid. */
function findViewObjectByLayerOid(items: any[], layerOid: number): any | null {
  for (const item of items) {
    if (item.layerObject?.oid === layerOid) {
      return item.viewObject ?? null;
    }
    if (item.subitems?.length) {
      const found = findViewObjectByLayerOid(item.subitems, layerOid);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Extract ivarTrace and memoryAddress fields from a viewObject (or null). */
function buildViewObjectFields(viewObj: any) {
  if (!viewObj) {
    return {
      specialTrace: null,
      ivarTraces: [],
      viewMemoryAddress: null,
    };
  }
  return {
    specialTrace: viewObj.specialTrace ?? null,
    ivarTraces: viewObj.ivarTraces ?? [],
    viewMemoryAddress: viewObj.memoryAddress ?? null,
  };
}

function normalizeMethodsByClass(rawMethods: unknown, fallbackClassName: string): Record<string, string[]> {
  if (Array.isArray(rawMethods)) {
    return {
      [fallbackClassName]: rawMethods.filter((value): value is string => typeof value === 'string'),
    };
  }

  if (rawMethods && typeof rawMethods === 'object') {
    return Object.fromEntries(
      Object.entries(rawMethods as Record<string, unknown>).map(([className, methods]) => [
        className,
        Array.isArray(methods)
          ? methods.filter((value): value is string => typeof value === 'string')
          : [],
      ]),
    );
  }

  return { [fallbackClassName]: [] };
}

const NS_LAYOUT_ATTRIBUTE_MAP: Record<number, string> = {
  0: 'notAnAttribute',
  1: 'left', 2: 'right', 3: 'top', 4: 'bottom',
  5: 'leading', 6: 'trailing', 7: 'width', 8: 'height',
  9: 'centerX', 10: 'centerY', 11: 'lastBaseline',
  12: 'firstBaseline', 13: 'leftMargin', 14: 'rightMargin',
  15: 'topMargin', 16: 'bottomMargin', 17: 'leadingMargin',
  18: 'trailingMargin', 19: 'centerXWithinMargins', 20: 'centerYWithinMargins',
};

const NS_LAYOUT_RELATION_MAP: Record<number, string> = {
  [-1]: '<=', 0: '==', 1: '>=',
};

/** Walk attrGroups to find LookinAutoLayoutConstraint entries. */
function extractConstraints(attrGroups: any[]): any[] {
  const constraints: any[] = [];
  for (const group of attrGroups ?? []) {
    for (const section of group.sections ?? []) {
      for (const attr of section.attributes ?? []) {
        if (attr.identifier === 'al_c_c' && Array.isArray(attr.value)) {
          for (const c of attr.value) {
            constraints.push({
              identifier: c.identifier ?? null,
              effective: c.effective ?? false,
              active: c.active ?? false,
              firstItem: c.firstItem
                ? { class: c.firstItem.classChainList?.[0] ?? null, oid: c.firstItem.oid ?? null }
                : null,
              firstAttribute: NS_LAYOUT_ATTRIBUTE_MAP[c.firstAttribute] ?? String(c.firstAttribute),
              relation: NS_LAYOUT_RELATION_MAP[c.relation] ?? '==',
              secondItem: c.secondItem
                ? { class: c.secondItem.classChainList?.[0] ?? null, oid: c.secondItem.oid ?? null }
                : null,
              secondAttribute: NS_LAYOUT_ATTRIBUTE_MAP[c.secondAttribute] ?? String(c.secondAttribute),
              multiplier: c.multiplier ?? 1,
              constant: c.constant ?? 0,
              priority: c.priority ?? 1000,
            });
          }
        }
      }
    }
  }
  return constraints;
}
