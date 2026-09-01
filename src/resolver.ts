/**
 * Reference resolver: takes a FormTemplate (an annotation file, see
 * README.md / types.ts) plus a taxpayer's data document, and produces one
 * ResolvedField per printable box — position plus a print-ready string.
 * This is the "renderer's first step"; drawing the resolved values onto an
 * actual PDF/image is deliberately out of scope (see README.md §13).
 */
import type {
  ConditionalSpec,
  DataBoundFieldAnnotation,
  FieldAnnotation,
  FormatSpec,
  FormTemplate,
  Position,
} from "./types.js";
import { isDataBound } from "./types.js";

/** One box, resolved: where it goes and what it says. */
export interface ResolvedField {
  id: string;
  page: number;
  position: Position;
  /** Print-ready string. Never present when `skipped` is true. */
  value?: string;
  /** True when a `conditional` evaluated false — the box should not be drawn at all. */
  skipped?: boolean;
  /** Present when this instance came from a `repeat` template; 0-indexed. */
  row?: number;
}

export class PathError extends Error {}

// ---------------------------------------------------------------------------
// §7 JSONPath-lite evaluator
// ---------------------------------------------------------------------------

type PathSegment =
  | { kind: "key"; name: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }
  | { kind: "filter"; field: string; op: "==" | "!="; value: unknown };

/**
 * Splits "a.b[0].c[*].d[?(@.x==1)]" into top-level dot-separated parts
 * without breaking apart the dots that appear *inside* a filter's
 * "[?(@.field==value)]" — brackets are tracked so a "." inside one is
 * never treated as a segment boundary.
 */
function splitPathParts(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "." && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") parts.push(current);
  return parts;
}

/** Splits "a.b[0].c[*].d[?(@.x==1)]" into structured segments. */
function parsePath(path: string): PathSegment[] {
  const body = path.trim().replace(/^\$\.?/, "");
  if (body === "") return [];

  const segments: PathSegment[] = [];
  // Matches: a bare key, then any number of trailing [ ... ] groups.
  const tokenRe = /([A-Za-z0-9_]+)((?:\[[^\]]*\])*)/g;
  for (const part of splitPathParts(body)) {
    tokenRe.lastIndex = 0;
    const m = tokenRe.exec(part);
    if (!m || m[0] !== part) {
      throw new PathError(`Unsupported path segment "${part}" in "${path}"`);
    }
    segments.push({ kind: "key", name: m[1]! });
    const brackets = m[2]!.match(/\[[^\]]*\]/g) ?? [];
    for (const bracket of brackets) {
      const inner = bracket.slice(1, -1);
      if (inner === "*") {
        segments.push({ kind: "wildcard" });
      } else if (/^\d+$/.test(inner)) {
        segments.push({ kind: "index", index: Number(inner) });
      } else {
        const filterMatch = inner.match(/^\?\(@\.([A-Za-z0-9_]+)\s*(==|!=)\s*(.+)\)$/);
        if (!filterMatch) throw new PathError(`Unsupported filter "${bracket}" in "${path}"`);
        const [, field, op, rawValue] = filterMatch;
        segments.push({ kind: "filter", field: field!, op: op as "==" | "!=", value: parseLiteral(rawValue!) });
      }
    }
  }
  return segments;
}

function parseLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^'.*'$/.test(trimmed) || /^".*"$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

/** Evaluates `path` against `data`, returning every matching value (0, 1, or many). */
export function evaluatePath(data: unknown, path: string): unknown[] {
  const segments = parsePath(path);
  let current: unknown[] = [data];
  for (const seg of segments) {
    const next: unknown[] = [];
    for (const node of current) {
      if (node === undefined || node === null) continue;
      switch (seg.kind) {
        case "key": {
          const v = (node as Record<string, unknown>)[seg.name];
          if (v !== undefined) next.push(v);
          break;
        }
        case "index": {
          if (Array.isArray(node)) {
            const v = node[seg.index];
            if (v !== undefined) next.push(v);
          }
          break;
        }
        case "wildcard": {
          if (Array.isArray(node)) next.push(...node);
          break;
        }
        case "filter": {
          if (Array.isArray(node)) {
            for (const item of node) {
              const fieldValue = (item as Record<string, unknown>)?.[seg.field];
              const matches = seg.op === "==" ? fieldValue === seg.value : fieldValue !== seg.value;
              if (matches) next.push(item);
            }
          }
          break;
        }
      }
    }
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------------------
// §8 conditional
// ---------------------------------------------------------------------------

export function evaluateConditional(data: unknown, cond: ConditionalSpec): boolean {
  const matches = evaluatePath(data, cond.path);
  const value = matches[0];
  if (cond.exists !== undefined) {
    const present = value !== undefined && value !== null;
    return cond.exists ? present : !present;
  }
  if ("equals" in cond && cond.equals !== undefined) return value === cond.equals;
  if ("notEquals" in cond && cond.notEquals !== undefined) return value !== cond.notEquals;
  if (cond.greaterThan !== undefined) return typeof value === "number" && value > cond.greaterThan;
  if (cond.lessThan !== undefined) return typeof value === "number" && value < cond.lessThan;
  // No operator supplied: fall back to plain existence.
  return value !== undefined && value !== null;
}

// ---------------------------------------------------------------------------
// §6 formatting
// ---------------------------------------------------------------------------

function applyMask(raw: string, mask: string): string {
  const digits = raw.replace(/\D/g, "");
  const revealCount = (mask.match(/#/g) ?? []).length;
  const revealed = digits.slice(Math.max(0, digits.length - revealCount));
  let ri = 0;
  let out = "";
  for (const ch of mask) {
    if (ch === "#") out += revealed[ri++] ?? "#";
    else if (ch === "X") out += "X";
    else out += ch;
  }
  return out;
}

function formatNumeric(value: number, format: Extract<FormatSpec, { type: "currency" | "number" | "percent" }>): string {
  const decimalPlaces = format.decimalPlaces ?? (format.type === "currency" ? 2 : 0);
  const magnitude = format.type === "percent" ? value * 100 : value;
  let body = Math.abs(magnitude).toLocaleString("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
  if (format.type === "currency") body = `$${body}`;
  if (format.type === "percent") body = `${body}%`;
  if (magnitude < 0) {
    return format.negativeStyle === "parentheses" ? `(${body})` : `-${body}`;
    // "redText" is a renderer hint (draw in red), not an ASCII change — same as "minus" here.
  }
  return body;
}

/** Turns one resolved raw value into the exact string that should be printed. */
export function formatValue(raw: unknown, format: FormatSpec): string {
  if (format.type === "literal") return format.literalValue;
  if (raw === undefined || raw === null) return "";

  switch (format.type) {
    case "currency":
    case "number":
    case "percent":
      return formatNumeric(Number(raw), format);
    case "boolean":
      return raw ? "X" : "";
    case "date": {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (Number.isNaN(d.getTime())) return String(raw);
      const pattern = format.dateFormat ?? "MM/DD/YYYY";
      const pad = (n: number) => String(n).padStart(2, "0");
      return pattern
        .replace("YYYY", String(d.getFullYear()))
        .replace("MM", pad(d.getMonth() + 1))
        .replace("DD", pad(d.getDate()));
    }
    case "ssn":
    case "ein":
      return format.mask ? applyMask(String(raw), format.mask) : String(raw);
    case "text":
    default:
      return String(raw);
  }
}

// ---------------------------------------------------------------------------
// §7 data binding + §9 repeat + top-level resolve
// ---------------------------------------------------------------------------

function aggregateMatches(matches: unknown[], aggregate: DataBoundFieldAnnotation["dataBinding"]["aggregate"]): unknown {
  switch (aggregate) {
    case "sum":
      return matches.reduce((total: number, v) => total + Number(v ?? 0), 0);
    case "count":
      return matches.length;
    case "min":
      return matches.length ? Math.min(...matches.map(Number)) : undefined;
    case "max":
      return matches.length ? Math.max(...matches.map(Number)) : undefined;
    case "join":
      return matches.map(String).join(", ");
    case "first":
    case undefined:
    default:
      return matches[0];
  }
}

function offsetPosition(position: Position, rowIndex: number, rowHeight: number, direction: "vertical" | "horizontal"): Position {
  return direction === "horizontal"
    ? { ...position, x: position.x + rowIndex * rowHeight }
    : { ...position, y: position.y + rowIndex * rowHeight };
}

/** Resolves a single (non-repeating) field against `data`. */
function resolveSingle(field: FieldAnnotation, data: unknown): ResolvedField {
  const base = { id: field.id, page: field.page, position: field.position };

  if (field.conditional && !evaluateConditional(data, field.conditional)) {
    return { ...base, skipped: true };
  }
  if (!isDataBound(field)) {
    return { ...base, value: formatValue(undefined, field.format) };
  }

  const matches = evaluatePath(data, field.dataBinding.path);
  const raw = matches.length > 0 ? aggregateMatches(matches, field.dataBinding.aggregate) : field.dataBinding.fallback;
  return { ...base, value: formatValue(raw, field.format) };
}

/** Resolves a field with a `repeat` block into one ResolvedField per source-array item. */
function resolveRepeating(field: DataBoundFieldAnnotation, data: unknown): ResolvedField[] {
  const repeat = field.repeat!;
  if (field.conditional && !evaluateConditional(data, field.conditional)) {
    return [{ id: field.id, page: field.page, position: field.position, skipped: true }];
  }

  const sourceMatches = evaluatePath(data, repeat.sourcePath);
  // sourcePath is typically a plain path to the array itself (e.g. "$.box12Entries"),
  // which evaluatePath returns as one match that *is* the array — unwrap it. A
  // sourcePath that already ends in a wildcard/filter instead yields one match
  // per item already, so only unwrap the single-array-match shape.
  const sourceItems = sourceMatches.length === 1 && Array.isArray(sourceMatches[0]) ? sourceMatches[0] : sourceMatches;
  const rows = repeat.maxRows ? sourceItems.slice(0, repeat.maxRows) : sourceItems;
  const direction = repeat.direction ?? "vertical";

  // The dataBinding path is expected to be relative-shaped against each row
  // (e.g. "$.box12Entries[*].code" against sourcePath "$.box12Entries") — so
  // we re-evaluate the same top-level path once and pair results positionally
  // with the source rows, which also handles a plain wildcard/filter path.
  const matches = evaluatePath(data, field.dataBinding.path);

  return rows.map((_, i) => ({
    id: field.id,
    page: field.page,
    position: offsetPosition(field.position, i, repeat.rowHeight, direction),
    row: i,
    value: formatValue(matches[i] ?? field.dataBinding.fallback, field.format),
  }));
}

/** Resolves every field in a FormTemplate against a taxpayer's data document. */
export function resolveForm(template: FormTemplate, data: unknown): ResolvedField[] {
  const resolved: ResolvedField[] = [];
  for (const field of template.fields) {
    if (isDataBound(field) && field.repeat) {
      resolved.push(...resolveRepeating(field, data));
    } else {
      resolved.push(resolveSingle(field, data));
    }
  }
  return resolved;
}
