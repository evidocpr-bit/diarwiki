import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const siteRequire = createRequire(new URL('../../site/package.json', import.meta.url));
const { micromark } = await import(pathToFileURL(siteRequire.resolve('micromark')).href);

const COMPONENT_NAMES = [
  'ArticleFigure', 'ArticleSources', 'ArticleStep', 'FlowDiagram', 'LearnList',
  'MedicalNotice', 'NextArticle', 'QuickAnswer', 'SourceStory',
];
const COMPONENT_PATTERN = new RegExp(`<(${COMPONENT_NAMES.join('|')})(?=[\\s/>])`, 'gu');

export function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(`diarwiki:${value}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function splitArray(value) {
  const values = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === ',') {
      values.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(value.slice(start).trim());
  return values.filter(Boolean);
}

function yamlValue(value) {
  const trimmed = value.trim();
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitArray(trimmed.slice(1, -1)).map(yamlValue);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/gu, "'");
  return trimmed;
}

export function parseFrontmatter(source) {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (!match) throw new Error('MDX_FRONTMATTER_MISSING');
  const data = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || /^\s*#/u.test(line)) continue;
    const field = line.match(/^([A-Za-z][A-Za-z\d]*):\s*(.*)$/u);
    if (!field) throw new Error(`MDX_FRONTMATTER_UNSUPPORTED: ${line}`);
    data[field[1]] = yamlValue(field[2]);
  }
  return { data, body: normalized.slice(match[0].length) };
}

class LiteralParser {
  constructor(source) { this.source = source; this.index = 0; }
  whitespace() { while (/\s/u.test(this.source[this.index] ?? '')) this.index += 1; }
  expect(character) {
    this.whitespace();
    if (this.source[this.index] !== character) throw new Error(`MDX_LITERAL_EXPECTED_${character}`);
    this.index += 1;
  }
  string() {
    this.whitespace();
    const quote = this.source[this.index++];
    let result = '';
    while (this.index < this.source.length) {
      const character = this.source[this.index++];
      if (character === quote) return result;
      if (character === '\\') {
        const escaped = this.source[this.index++];
        const replacements = { n: '\n', r: '\r', t: '\t' };
        result += replacements[escaped] ?? escaped;
      } else result += character;
    }
    throw new Error('MDX_LITERAL_STRING_UNCLOSED');
  }
  identifier() {
    this.whitespace();
    const match = this.source.slice(this.index).match(/^[A-Za-z_$][A-Za-z\d_$-]*/u);
    if (!match) throw new Error('MDX_LITERAL_IDENTIFIER_EXPECTED');
    this.index += match[0].length;
    return match[0];
  }
  value() {
    this.whitespace();
    const character = this.source[this.index];
    if (character === '"' || character === "'") return this.string();
    if (character === '[') {
      this.index += 1;
      const result = [];
      this.whitespace();
      while (this.source[this.index] !== ']') {
        result.push(this.value());
        this.whitespace();
        if (this.source[this.index] === ',') { this.index += 1; this.whitespace(); }
        else break;
      }
      this.expect(']');
      return result;
    }
    if (character === '{') {
      this.index += 1;
      const result = {};
      this.whitespace();
      while (this.source[this.index] !== '}') {
        const key = this.source[this.index] === '"' || this.source[this.index] === "'" ? this.string() : this.identifier();
        this.expect(':');
        result[key] = this.value();
        this.whitespace();
        if (this.source[this.index] === ',') { this.index += 1; this.whitespace(); }
        else break;
      }
      this.expect('}');
      return result;
    }
    const rest = this.source.slice(this.index);
    const number = rest.match(/^-?\d+(?:\.\d+)?/u);
    if (number) { this.index += number[0].length; return Number(number[0]); }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (rest.startsWith(literal)) { this.index += literal.length; return value; }
    }
    throw new Error(`MDX_LITERAL_UNSUPPORTED: ${rest.slice(0, 30)}`);
  }
  parse() {
    const value = this.value();
    this.whitespace();
    if (this.index !== this.source.length) throw new Error(`MDX_LITERAL_TRAILING: ${this.source.slice(this.index)}`);
    return value;
  }
}

export function parseLiteral(source) {
  return new LiteralParser(source.trim()).parse();
}

function findOpeningEnd(source, start) {
  let quote = '';
  let escaped = false;
  let braces = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '{') braces += 1;
    else if (character === '}') braces -= 1;
    else if (character === '>' && braces === 0) return index;
  }
  throw new Error('MDX_COMPONENT_OPENING_UNCLOSED');
}

export function parseAttributes(source) {
  const attributes = {};
  let index = 0;
  while (index < source.length) {
    while (/\s/u.test(source[index] ?? '')) index += 1;
    if (index >= source.length || source[index] === '/') break;
    const name = source.slice(index).match(/^[A-Za-z][A-Za-z\d_-]*/u)?.[0];
    if (!name) throw new Error(`MDX_ATTRIBUTE_NAME_EXPECTED: ${source.slice(index, index + 30)}`);
    index += name.length;
    while (/\s/u.test(source[index] ?? '')) index += 1;
    if (source[index] !== '=') { attributes[name] = true; continue; }
    index += 1;
    while (/\s/u.test(source[index] ?? '')) index += 1;
    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index++];
      let value = '';
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\' && index + 1 < source.length) index += 1;
        value += source[index++];
      }
      if (source[index] !== quote) throw new Error(`MDX_ATTRIBUTE_UNCLOSED: ${name}`);
      index += 1;
      attributes[name] = value;
      continue;
    }
    if (source[index] === '{') {
      const start = ++index;
      let depth = 1;
      let quote = '';
      let escaped = false;
      while (index < source.length && depth > 0) {
        const character = source[index];
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (quote) { if (character === quote) quote = ''; }
        else if (character === '"' || character === "'") quote = character;
        else if (character === '{' || character === '[') depth += 1;
        else if (character === '}' || character === ']') depth -= 1;
        index += 1;
      }
      if (depth !== 0) throw new Error(`MDX_ATTRIBUTE_EXPRESSION_UNCLOSED: ${name}`);
      attributes[name] = parseLiteral(source.slice(start, index - 1));
      continue;
    }
    throw new Error(`MDX_ATTRIBUTE_VALUE_UNSUPPORTED: ${name}`);
  }
  return attributes;
}

export function markdownToHtml(markdown) {
  const normalized = String(markdown ?? '').trim();
  if (!normalized) return '';
  return micromark(normalized, { allowDangerousHtml: true }).trim();
}

export function parseMdxDocument(source) {
  const { data, body } = parseFrontmatter(source);
  const cleanBody = body.replace(/^import\s+[^\n]+\n?/gmu, '').trim();
  const tokens = [];
  let cursor = 0;
  while (cursor < cleanBody.length) {
    COMPONENT_PATTERN.lastIndex = cursor;
    const match = COMPONENT_PATTERN.exec(cleanBody);
    if (!match) {
      const markdown = cleanBody.slice(cursor).trim();
      if (markdown) tokens.push({ kind: 'markdown', markdown, html: markdownToHtml(markdown) });
      break;
    }
    const markdown = cleanBody.slice(cursor, match.index).trim();
    if (markdown) tokens.push({ kind: 'markdown', markdown, html: markdownToHtml(markdown) });
    const openingEnd = findOpeningEnd(cleanBody, match.index);
    const opening = cleanBody.slice(match.index, openingEnd + 1);
    const selfClosing = /\/\s*>$/u.test(opening);
    const attributeSource = opening.slice(match[0].length, selfClosing ? opening.lastIndexOf('/') : -1);
    const attributes = parseAttributes(attributeSource);
    let inner = '';
    let end = openingEnd + 1;
    if (!selfClosing) {
      const closing = `</${match[1]}>`;
      const closingIndex = cleanBody.indexOf(closing, end);
      if (closingIndex < 0) throw new Error(`MDX_COMPONENT_CLOSING_MISSING: ${match[1]}`);
      inner = cleanBody.slice(end, closingIndex).trim();
      end = closingIndex + closing.length;
    }
    tokens.push({
      kind: 'component',
      name: match[1],
      attributes,
      markdown: inner,
      html: markdownToHtml(inner),
    });
    cursor = end;
  }
  return { frontmatter: data, tokens };
}
