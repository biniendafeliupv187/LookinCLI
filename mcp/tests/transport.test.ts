import { describe, it, expect } from 'vitest';
import { FrameEncoder, FrameDecoder, type ParsedFrame } from '../src/core/transport.js';

describe('FrameEncoder', () => {
  it('produces a 16-byte header + payload buffer', () => {
    const payload = Buffer.from('hello');
    const frame = FrameEncoder.encode(200, 1, payload);

    // 16 bytes header + 5 bytes payload
    expect(frame.byteLength).toBe(16 + 5);
  });

  it('encodes header fields in Big-Endian (network byte order)', () => {
    const payload = Buffer.from('test');
    const frame = FrameEncoder.encode(202, 42, payload);

    // Read Big-Endian uint32 values
    const version = frame.readUInt32BE(0);
    const type = frame.readUInt32BE(4);
    const tag = frame.readUInt32BE(8);
    const payloadSize = frame.readUInt32BE(12);

    expect(version).toBe(1); // PTProtocolVersion1
    expect(type).toBe(202);
    expect(tag).toBe(42);
    expect(payloadSize).toBe(4); // 'test'.length
  });

  it('appends payload bytes after header', () => {
    const payload = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
    const frame = FrameEncoder.encode(200, 0, payload);

    const extracted = frame.subarray(16);
    expect(extracted).toEqual(payload);
  });

  it('handles empty payload (header only)', () => {
    const frame = FrameEncoder.encode(200, 1, Buffer.alloc(0));

    expect(frame.byteLength).toBe(16);
    expect(frame.readUInt32BE(12)).toBe(0); // payloadSize = 0
  });

  it('handles undefined payload (header only)', () => {
    const frame = FrameEncoder.encode(200, 1);

    expect(frame.byteLength).toBe(16);
    expect(frame.readUInt32BE(12)).toBe(0);
  });
});

describe('FrameDecoder', () => {
  it('parses a complete frame from buffer', () => {
    const payload = Buffer.from('hello world');
    const raw = FrameEncoder.encode(201, 5, payload);

    const decoder = new FrameDecoder();
    const frames: ParsedFrame[] = [];
    decoder.onFrame = (f) => frames.push(f);
    decoder.push(raw);

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(201);
    expect(frames[0].tag).toBe(5);
    expect(frames[0].payload.toString()).toBe('hello world');
  });

  it('handles partial header delivery', () => {
    const payload = Buffer.from('data');
    const raw = FrameEncoder.encode(202, 10, payload);

    const decoder = new FrameDecoder();
    const frames: ParsedFrame[] = [];
    decoder.onFrame = (f) => frames.push(f);

    // Feed header in two parts
    decoder.push(raw.subarray(0, 8));
    expect(frames).toHaveLength(0);

    decoder.push(raw.subarray(8));
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(202);
    expect(frames[0].payload.toString()).toBe('data');
  });

  it('handles partial payload delivery', () => {
    const payload = Buffer.from('abcdef');
    const raw = FrameEncoder.encode(200, 1, payload);

    const decoder = new FrameDecoder();
    const frames: ParsedFrame[] = [];
    decoder.onFrame = (f) => frames.push(f);

    // Feed header + partial payload
    decoder.push(raw.subarray(0, 18)); // 16 header + 2 payload
    expect(frames).toHaveLength(0);

    // Feed remaining payload
    decoder.push(raw.subarray(18));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString()).toBe('abcdef');
  });

  it('parses multiple frames from a single buffer', () => {
    const frame1 = FrameEncoder.encode(200, 1, Buffer.from('a'));
    const frame2 = FrameEncoder.encode(201, 2, Buffer.from('bb'));
    const combined = Buffer.concat([frame1, frame2]);

    const decoder = new FrameDecoder();
    const frames: ParsedFrame[] = [];
    decoder.onFrame = (f) => frames.push(f);
    decoder.push(combined);

    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe(200);
    expect(frames[0].payload.toString()).toBe('a');
    expect(frames[1].type).toBe(201);
    expect(frames[1].payload.toString()).toBe('bb');
  });

  it('handles byte-by-byte delivery', () => {
    const payload = Buffer.from('XY');
    const raw = FrameEncoder.encode(200, 0, payload);

    const decoder = new FrameDecoder();
    const frames: ParsedFrame[] = [];
    decoder.onFrame = (f) => frames.push(f);

    for (let i = 0; i < raw.byteLength; i++) {
      decoder.push(raw.subarray(i, i + 1));
    }

    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString()).toBe('XY');
  });

  it('handles frame with zero-length payload', () => {
    const raw = FrameEncoder.encode(200, 1, Buffer.alloc(0));

    const decoder = new FrameDecoder();
    const frames: ParsedFrame[] = [];
    decoder.onFrame = (f) => frames.push(f);
    decoder.push(raw);

    expect(frames).toHaveLength(1);
    expect(frames[0].payload.byteLength).toBe(0);
  });

  it('rejects frame with wrong protocol version', () => {
    // Build a raw frame manually with bad version
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(99, 0);  // bad version
    buf.writeUInt32BE(200, 4);
    buf.writeUInt32BE(1, 8);
    buf.writeUInt32BE(0, 12);

    const decoder = new FrameDecoder();
    const errors: Error[] = [];
    decoder.onError = (e) => errors.push(e);
    decoder.push(buf);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('version');
  });
});
