/**
 * Unified error model for Lookin MCP Server.
 *
 * Error codes follow a structured scheme:
 *   DISCOVERY_*   — No device/app found
 *   TRANSPORT_*   — Network / socket level
 *   BRIDGE_*      — Swift bridge encode/decode
 *   PROTOCOL_*    — Unexpected response / version mismatch
 *   VALIDATION_*  — Invalid tool arguments
 */

export type LookinErrorCode =
  | 'DISCOVERY_NO_DEVICE'
  | 'TRANSPORT_TIMEOUT'
  | 'TRANSPORT_REFUSED'
  | 'TRANSPORT_CLOSED'
  | 'BRIDGE_DECODE_FAILED'
  | 'BRIDGE_ENCODE_FAILED'
  | 'PROTOCOL_UNEXPECTED_RESPONSE'
  | 'PROTOCOL_VERSION_INCOMPATIBLE'
  | 'VALIDATION_INVALID_ATTRIBUTE'
  | 'VALIDATION_INVALID_TARGET'
  | 'VALIDATION_INVALID_VALUE';

/**
 * Structured error for all Lookin MCP operations.
 */
export class LookinError extends Error {
  readonly code: LookinErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: LookinErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'LookinError';
    this.code = code;
    this.details = details;
  }

  /** Serialize to MCP tool response JSON */
  toJSON(): { error: string; code: LookinErrorCode; details?: Record<string, unknown> } {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/**
 * Classify a raw Error into a LookinError.
 * Maps transport/bridge/protocol errors to structured codes.
 */
export function classifyError(err: unknown): LookinError {
  if (err instanceof LookinError) return err;

  const msg = err instanceof Error ? err.message : String(err);

  // Transport timeout: correlator timeout pattern
  if (/timeout after \d+ms/.test(msg)) {
    const match = msg.match(/type=(\d+).*tag=(\d+).*timeout after (\d+)ms/);
    return new LookinError('TRANSPORT_TIMEOUT', msg, match ? {
      requestType: Number(match[1]),
      tag: Number(match[2]),
      timeoutMs: Number(match[3]),
    } : undefined);
  }

  // Connection refused
  if (/ECONNREFUSED/.test(msg)) {
    const match = msg.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/);
    return new LookinError('TRANSPORT_REFUSED', msg, match ? {
      host: match[1],
      port: Number(match[2]),
    } : undefined);
  }

  // Connection reset / closed
  if (/ECONNRESET|Connection closed|Session is closed|EPIPE/.test(msg)) {
    return new LookinError('TRANSPORT_CLOSED', msg);
  }

  // Bridge decode failure
  if (/bridge decode failed/.test(msg)) {
    return new LookinError('BRIDGE_DECODE_FAILED', msg);
  }

  // Bridge encode failure
  if (/bridge encode failed/.test(msg)) {
    return new LookinError('BRIDGE_ENCODE_FAILED', msg);
  }

  // Unexpected response class
  if (/Unexpected response/.test(msg)) {
    return new LookinError('PROTOCOL_UNEXPECTED_RESPONSE', msg);
  }

  // Fallback: wrap as transport closed (most generic network error)
  return new LookinError('TRANSPORT_CLOSED', msg);
}

/**
 * Format a LookinError into an MCP tool response content block.
 */
export function errorResponse(err: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  const classified = classifyError(err);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(classified.toJSON()) }],
  };
}
