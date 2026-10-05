#!/usr/bin/env node
/**
 * Token build — one source, two runtimes.
 *
 *   tokens/tokens.json  ->  assets/tokens.css          (web: CSS custom properties)
 *                       ->  mobile/src/theme.ts        (native: typed theme object)
 *   tokens/game.json    ->  assets/game-config.js      (web: window.DESIGNER_ESSENTIALS)
 *                       ->  mobile/src/gameConfig.ts   (native: typed config + asset map)
 *
 * Web gets shadows as `box-shadow`; native gets the iOS shadow* quartet plus an
 * Android `elevation` from the same token, because shadows are not portable.
 *
 * Usage: node tokens/build.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const tokens = read('tokens/tokens.json');
const game = read('tokens/game.json');

/* ── helpers ──────────────────────────────────────────────────────── */

const isToken = (node) =>
  node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, '$value');

/** Walk every token, yielding [pathSegments, token]. */
function* walk(node, path = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (isToken(value)) yield [[...path, key], value];
    else if (value && typeof value === 'object') yield* walk(value, [...path, key]);
  }
}

/** Resolve a "{a.b.c}" alias against the token tree. */
function resolve(value, seen = new Set()) {
  if (typeof value !== 'string') return value;
  const match = /^\{([^}]+)\}$/.exec(value);
  if (!match) return value;
  const path = match[1];
  if (seen.has(path)) throw new Error(`Circular token reference: ${path}`);
  seen.add(path);
  const target = path.split('.').reduce((acc, key) => acc?.[key], tokens);
  if (!isToken(target)) throw new Error(`Unknown token reference: {${path}}`);
  return resolve(target.$value, seen);
}

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const rgba = (hex, alpha) => `rgba(${hexToRgb(hex).join(', ')}, ${alpha})`;

const kebab = (path) => path.join('-');
const camel = (path) =>
  path
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replace(/-(\w)/g, (_, c) => c.toUpperCase());

const BANNER = (source) =>
  `/* GENERATED FILE — do not edit.\n   Source: ${source}\n   Rebuild: node tokens/build.mjs */\n`;

/* ── web: assets/tokens.css ───────────────────────────────────────── */

function buildCss() {
  const lines = [];

  for (const [path, token] of walk(tokens)) {
    const name = `--${kebab(path)}`;
    const value = resolve(token.$value);

    switch (token.$type) {
      case 'color':
        lines.push(`    ${name}: ${value};`);
        break;
      case 'dimension':
        lines.push(`    ${name}: ${value}px;`);
        break;
      case 'duration':
        lines.push(`    ${name}: ${value}ms;`);
        break;
      case 'number':
        lines.push(`    ${name}: ${value};`);
        break;
      case 'shadow':
        lines.push(
          `    ${name}: 0 ${value.y}px ${value.blur}px ${rgba(value.color, value.opacity)};`
        );
        lines.push(
          `    ${name}-drop: drop-shadow(0 ${Math.round(value.y * 0.6)}px ` +
            `${Math.round(value.blur * 0.42)}px ${rgba(value.color, value.opacity)});`
        );
        break;
      case 'cubicBezier':
        lines.push(`    ${name}: cubic-bezier(${value.join(', ')});`);
        break;
      case 'fontFamily':
        lines.push(`    ${name}: "${value.family}", ${value.webStack};`);
        lines.push(`    ${name}-weight: ${value.weight};`);
        break;
      default:
        throw new Error(`Unhandled $type "${token.$type}" at ${path.join('.')}`);
    }
  }

  return `${BANNER('tokens/tokens.json')}\n:root {\n${lines.join('\n')}\n}\n`;
}

/* ── native: mobile/src/theme.ts ──────────────────────────────────── */

function buildTheme() {
  const groups = new Map();

  for (const [path, token] of walk(tokens)) {
    const [group, ...rest] = path;
    const key = camel(rest.length ? rest : [group]);
    const value = resolve(token.$value);
    if (!groups.has(group)) groups.set(group, []);

    switch (token.$type) {
      case 'color':
        groups.get(group).push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
        break;
      case 'dimension':
      case 'duration':
      case 'number':
        groups.get(group).push(`    ${JSON.stringify(key)}: ${value},`);
        break;
      case 'shadow':
        groups.get(group).push(
          `    ${JSON.stringify(key)}: {\n` +
            `      shadowColor: ${JSON.stringify(value.color)},\n` +
            `      shadowOffset: { width: 0, height: ${Math.round(value.y * 0.6)} },\n` +
            `      shadowOpacity: ${value.opacity},\n` +
            `      shadowRadius: ${Math.round(value.blur / 2)},\n` +
            `      elevation: ${value.android},\n` +
            `    },`
        );
        break;
      case 'cubicBezier':
        groups.get(group).push(`    ${JSON.stringify(key)}: [${value.join(', ')}] as const,`);
        break;
      case 'fontFamily':
        groups.get(group).push(`    ${JSON.stringify(key)}: ${JSON.stringify(value.nativeFace)},`);
        break;
      default:
        throw new Error(`Unhandled $type "${token.$type}" at ${path.join('.')}`);
    }
  }

  const body = [...groups]
    .map(([group, entries]) => `  ${camel([group])}: {\n${entries.join('\n')}\n  },`)
    .join('\n');

  return `${BANNER('tokens/tokens.json')}
export const theme = {
${body}
} as const;

export type Theme = typeof theme;
`;
}

/* ── web: assets/game-config.js ───────────────────────────────────── */

function buildGameJs() {
  const config = { ...game };
  delete config.$description;
  return `${BANNER('tokens/game.json')}
window.DESIGNER_ESSENTIALS = ${JSON.stringify(config, null, 2)};
`;
}

/* ── native: mobile/src/gameConfig.ts ─────────────────────────────── */

function buildGameTs() {
  const config = { ...game };
  delete config.$description;

  const sources = [...config.items, ...config.chrome]
    .map((entry) => `  ${JSON.stringify(entry.id)}: require('../assets/img/${entry.file}'),`)
    .join('\n');

  return `${BANNER('tokens/game.json')}
export const game = ${JSON.stringify(config, null, 2)} as const;

export type ItemDef = (typeof game.items)[number];
export type ItemId = ItemDef['id'];

/** Static requires so Metro can bundle every sprite. */
export const sources: Record<string, number> = {
${sources}
};
`;
}

/* ── emit ─────────────────────────────────────────────────────────── */

const outputs = [
  ['assets/tokens.css', buildCss()],
  ['assets/game-config.js', buildGameJs()],
  ['mobile/src/theme.ts', buildTheme()],
  ['mobile/src/gameConfig.ts', buildGameTs()],
];

for (const [path, contents] of outputs) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), contents);
  console.log(`wrote ${path}  (${contents.length} bytes)`);
}
