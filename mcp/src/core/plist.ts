/**
 * Minimal XML plist serializer/parser for usbmuxd communication.
 * Supports: dict, string, integer, real, true, false, array, data.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n';
const XML_FOOTER = '</plist>';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function valueToXml(value: any): string {
  if (value === true) return '<true/>';
  if (value === false) return '<false/>';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `<integer>${value}</integer>`;
    return `<real>${value}</real>`;
  }
  if (typeof value === 'string') return `<string>${escapeXml(value)}</string>`;
  if (Buffer.isBuffer(value)) return `<data>${value.toString('base64')}</data>`;
  if (Array.isArray(value)) {
    return '<array>' + value.map(valueToXml).join('') + '</array>';
  }
  if (typeof value === 'object' && value !== null) {
    let xml = '<dict>';
    for (const [k, v] of Object.entries(value)) {
      xml += `<key>${escapeXml(k)}</key>${valueToXml(v)}`;
    }
    xml += '</dict>';
    return xml;
  }
  return '<string></string>';
}

export function toXml(obj: Record<string, any>): string {
  return XML_HEADER + valueToXml(obj) + '\n' + XML_FOOTER;
}

// --- Parser ---

export function fromXml(xml: string): any {
  // Trim to the plist body
  const plistStart = xml.indexOf('<plist');
  const plistEnd = xml.indexOf('</plist>');
  if (plistStart === -1 || plistEnd === -1) return {};

  const inner = xml.substring(xml.indexOf('>', plistStart) + 1, plistEnd).trim();
  const ctx = { src: inner, pos: 0 };
  return parseValue(ctx);
}

interface ParseCtx {
  src: string;
  pos: number;
}

function skipWs(ctx: ParseCtx) {
  while (ctx.pos < ctx.src.length && /\s/.test(ctx.src[ctx.pos])) ctx.pos++;
}

function parseValue(ctx: ParseCtx): any {
  skipWs(ctx);
  if (ctx.pos >= ctx.src.length) return undefined;

  if (ctx.src.startsWith('<dict', ctx.pos)) return parseDict(ctx);
  if (ctx.src.startsWith('<array', ctx.pos)) return parseArray(ctx);
  if (ctx.src.startsWith('<string', ctx.pos)) return parseSimpleTag(ctx, 'string');
  if (ctx.src.startsWith('<integer', ctx.pos)) return Number(parseSimpleTag(ctx, 'integer'));
  if (ctx.src.startsWith('<real', ctx.pos)) return Number(parseSimpleTag(ctx, 'real'));
  if (ctx.src.startsWith('<true/>', ctx.pos)) { ctx.pos += 7; return true; }
  if (ctx.src.startsWith('<false/>', ctx.pos)) { ctx.pos += 8; return false; }
  if (ctx.src.startsWith('<data', ctx.pos)) {
    const b64 = parseSimpleTag(ctx, 'data');
    return Buffer.from(b64.trim(), 'base64');
  }

  // Skip unknown tags
  const end = ctx.src.indexOf('>', ctx.pos);
  if (end !== -1) ctx.pos = end + 1;
  return undefined;
}

function parseSimpleTag(ctx: ParseCtx, tagName: string): string {
  // Advance past <tagName> or <tagName ...>
  const openEnd = ctx.src.indexOf('>', ctx.pos);
  if (openEnd === -1) return '';

  // Self-closing tag?
  if (ctx.src[openEnd - 1] === '/') {
    ctx.pos = openEnd + 1;
    return '';
  }

  ctx.pos = openEnd + 1;
  const closeTag = `</${tagName}>`;
  const closeIdx = ctx.src.indexOf(closeTag, ctx.pos);
  if (closeIdx === -1) return '';

  const content = ctx.src.substring(ctx.pos, closeIdx);
  ctx.pos = closeIdx + closeTag.length;

  // Unescape basic XML entities
  return content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseDict(ctx: ParseCtx): Record<string, any> {
  // Advance past <dict> or <dict ...>
  const openEnd = ctx.src.indexOf('>', ctx.pos);
  if (openEnd === -1) return {};

  // Self-closing <dict/>
  if (ctx.src[openEnd - 1] === '/') {
    ctx.pos = openEnd + 1;
    return {};
  }

  ctx.pos = openEnd + 1;
  const result: Record<string, any> = {};

  while (ctx.pos < ctx.src.length) {
    skipWs(ctx);
    if (ctx.src.startsWith('</dict>', ctx.pos)) {
      ctx.pos += 7;
      break;
    }
    if (ctx.src.startsWith('<key>', ctx.pos)) {
      const key = parseSimpleTag(ctx, 'key');
      const value = parseValue(ctx);
      result[key] = value;
    } else {
      // Unexpected — try to skip
      const end = ctx.src.indexOf('>', ctx.pos);
      if (end === -1) break;
      ctx.pos = end + 1;
    }
  }
  return result;
}

function parseArray(ctx: ParseCtx): any[] {
  const openEnd = ctx.src.indexOf('>', ctx.pos);
  if (openEnd === -1) return [];

  if (ctx.src[openEnd - 1] === '/') {
    ctx.pos = openEnd + 1;
    return [];
  }

  ctx.pos = openEnd + 1;
  const result: any[] = [];

  while (ctx.pos < ctx.src.length) {
    skipWs(ctx);
    if (ctx.src.startsWith('</array>', ctx.pos)) {
      ctx.pos += 8;
      break;
    }
    const val = parseValue(ctx);
    if (val !== undefined) result.push(val);
  }
  return result;
}
