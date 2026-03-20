/** Peertalk frame protocol version */
const PT_PROTOCOL_VERSION = 1;

/** Frame header size in bytes */
const HEADER_SIZE = 16;

/** A parsed Peertalk frame */
export interface ParsedFrame {
  type: number;
  tag: number;
  payload: Buffer;
}

/**
 * Encodes Peertalk frames: 16-byte Big-Endian header + payload.
 *
 * Header layout (all uint32 BE):
 *   [0..3]   version (always 1)
 *   [4..7]   type (request type)
 *   [8..11]  tag (request correlation tag)
 *   [12..15] payloadSize
 */
export class FrameEncoder {
  static encode(type: number, tag: number, payload?: Buffer): Buffer {
    const payloadBuf = payload ?? Buffer.alloc(0);
    const frame = Buffer.alloc(HEADER_SIZE + payloadBuf.byteLength);
    frame.writeUInt32BE(PT_PROTOCOL_VERSION, 0);
    frame.writeUInt32BE(type, 4);
    frame.writeUInt32BE(tag, 8);
    frame.writeUInt32BE(payloadBuf.byteLength, 12);
    if (payloadBuf.byteLength > 0) {
      payloadBuf.copy(frame, HEADER_SIZE);
    }
    return frame;
  }
}

/**
 * Streaming decoder for Peertalk frames.
 * Handles partial header/payload delivery across TCP chunks.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /** Called when a complete frame is parsed */
  onFrame: ((frame: ParsedFrame) => void) | null = null;

  /** Called on protocol errors */
  onError: ((error: Error) => void) | null = null;

  /** Push raw TCP data into the decoder */
  push(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.drain();
  }

  private drain(): void {
    while (this.buffer.byteLength >= HEADER_SIZE) {
      const version = this.buffer.readUInt32BE(0);
      if (version !== PT_PROTOCOL_VERSION) {
        this.onError?.(new Error(`Unexpected frame version: ${version}, expected ${PT_PROTOCOL_VERSION}`));
        // Discard this header to avoid infinite loop
        this.buffer = this.buffer.subarray(HEADER_SIZE);
        continue;
      }
      const type = this.buffer.readUInt32BE(4);
      const tag = this.buffer.readUInt32BE(8);
      const payloadSize = this.buffer.readUInt32BE(12);

      const totalFrameSize = HEADER_SIZE + payloadSize;
      if (this.buffer.byteLength < totalFrameSize) {
        // Wait for more data
        break;
      }

      const payload = Buffer.from(this.buffer.subarray(HEADER_SIZE, totalFrameSize));
      this.buffer = this.buffer.subarray(totalFrameSize);
      this.onFrame?.({ type, tag, payload });
    }
  }
}
