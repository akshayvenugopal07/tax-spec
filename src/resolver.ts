/**
 * Reference resolver for the Tax Form Annotation Specification (SPEC.md).
 *
 * Pure functions, zero dependencies. Takes a FormTemplate + a taxpayer data
 * document and produces a flat list of DrawInstruction — exactly what a
 * rendering layer (PDF lib, <canvas>, SVG, print CSS) needs.
 *
 * This same logic is ported to plain JS in demo/app.js for the zero-build
 * browser demo; keep the two in sync if you change behavior here.
 */

import {
  Aggregate,
  ConditionalSpec,
  DataBinding,
  DrawInstruction,
  FieldAnnotation,
  FormTemplate,
  Transform,
} from "./types";

// ---------------------------------------------------------------------------
// Path grammar: $ | @ , .field , ["field"] , [n] , [*] , [?(@.field OP value)]
// ---------------------------------------------------------------------------

type Segment =
  | { kind: "prop"; name: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }
  | { kind: "filter"; field: string; op: string; value: unknown };

function tokenize(path: string): Segment[] {
  // Strip leading root marker; @ (repeat-relative) and $ (document root)
  // are both handled by the caller choosing what to evaluate against.
  let rest = path.trim();
  if (rest.startsWith("$") || rest.startsWith("@")) rest = rest.slice(1);

  const segments: Segment[] = [];
  const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\["([^"]+)"\]|\[(\d+)\]|\[\*\]|\[\?\(@\.([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*('([^']*)'|-?\d+(\.\d+)?|true|false)\)\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = re.exec(rest)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`Unparseable path segment near "${rest.slice(lastIndex)}" in "${path}"`);
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "prop", name: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "prop", name: match[2] });
    } else if (match[3] !== undefined) {
      segments.push({ kind: "index", index: Number(match[3]) });
    } else if (match[0] === "[*]") {
      segments.push({ kind: "wildcard" });
    } else if (match[4] !== undefined) {
      const rawValue = match[6];
      let value: unknown;
      if (match[7] !== undefined) value = match[7]; // quoted string content
      else if (rawValue === "true") value = true;
      else if (rawValue === "false") value = false;
      else value = Number(rawValue);
      segments.push({ kind: "filter", field: match[4], op: match[5], value });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== rest.length) {
    throw new Error(`Unparseable trailing path segment "${rest.slice(lastIndex)}" in "${path}"`);
  }
  return segments;
}

function compareOp(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case ">": return (a as number) > (b as number);
    case ">=": return (a as number) >= (b as number);
    case "<": return (a as number) < (b as number);
    case "<=": return (a as number) <= (b as number);
    default: throw new Error(`Unknown filter operator "${op}"`);
  }
}

/**
 * Evaluates a path against a value. Returns either a single match `{ scalar }`
 * or `{ list }` once the path has passed through a wildcard/filter.
 */
export function evaluatePath(path: string, data: unknown): { list: true; values: unknown[] } | { list: false; value: unknown } {
  const segments = tokenize(path);
  let current: unknown[] = [data];
  let sawList = false;

  for (const seg of segments) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item === undefined || item === null) continue;
      if (seg.kind === "prop") {
        next.push((item as Record<string, unknown>)[seg.name]);
      } else if (seg.kind === "index") {
        next.push((item as unknown[])[seg.index]);
      } else if (seg.kind === "wildcard") {
        sawList = true;
        if (Array.isArray(item)) next.push(...item);
      } else if (seg.kind === "filter") {
        sawList = true;
        if (Array.isArray(item)) {
          for (const el of item) {
            const fieldVal = (el as Record<string, unknown>)[seg.field];
            if (compareOp(fieldVal, seg.op, seg.value)) next.push(el);
          }
        }
      }
    }
    current = next;
  }

  if (sawList) return { list: true, values: current };
  return { list: false, value: current[0] };
}

function applyAggregate(values: unknown[], aggregate: Aggregate | undefined): unknown {
  const nums = () => values.map((v) => Number(v ?? 0));
  switch (aggregate) {
    case "sum": return nums().reduce((a, b) => a + b, 0);
    case "count": return values.length;
    case "avg": return values.length ? nums().reduce((a, b) => a + b, 0) / values.length : 0;
    case "min": return values.length ? Math.min(...nums()) : 0;
    case "max": return values.length ? Math.max(...nums()) : 0;
    case "first": return values[0];
    case "last": return values[values.length - 1];
    case "join": return values.map((v) => String(v ?? "")).join(", ");
    default:
      throw new Error(
        `Path resolved to a list of ${values.length} values but no "aggregate" was specified.`
      );
  }
}

function applyTransform(value: unknown, transform: Transform | undefined): unknown {
  if (transform === undefined) return value;
  const n = Number(value);
  switch (transform) {
    case "abs": return Math.abs(n);
    case "negate": return -n;
    case "round": return Math.round(n);
  }
}

/** Resolves a DataBinding against a data root (and, inside a repeat, the current element). */
export function resolveBinding(binding: DataBinding, root: unknown, current: unknown = root): unknown {
  if (binding.literal !== undefined) return binding.literal;
  if (!binding.path) throw new Error("dataBinding must have either `path` or `literal`.");

  const target = binding.path.trim().startsWith("@") ? current : root;
  const result = evaluatePath(binding.path, target);
  let value: unknown = result.list ? applyAggregate(result.values, binding.aggregate) : result.value;

  if (value === undefined || value === null) {
    value = binding.fallback !== undefined ? binding.fallback : undefined;
  }
  return applyTransform(value, binding.transform);
}

function evaluateShowIf(showIf: string, root: unknown): boolean {
  const m = /^\s*@\.([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*('([^']*)'|-?\d+(\.\d+)?|true|false)\s*$/.exec(showIf);
  if (!m) throw new Error(`Unparseable showIf expression: "${showIf}"`);
  const field = m[1];
  const op = m[2];
  let value: unknown;
  if (m[4] !== undefined) value = m[4];
  else if (m[3] === "true") value = true;
  else if (m[3] === "false") value = false;
  else value = Number(m[3]);
  const actual = (root as Record<string, unknown>)[field];
  return compareOp(actual, op, value);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatValue(rawValue: unknown, format: FieldAnnotation["format"]): string {
  const { type } = format;

  if (rawValue === undefined || rawValue === null) return "";

  if (type === "checkbox") {
    return rawValue ? (format.checkboxMark ?? "X") : "";
  }

  if (type === "currency" || type === "number" || type === "integer" || type === "percent") {
    let n = Number(rawValue);
    const decimals = format.decimalPlaces ?? (type === "integer" ? 0 : 2);
    const negative = n < 0;
    if (negative) n = Math.abs(n);
    if (type === "percent") n = n * 100;

    let str = n.toFixed(decimals);
    if (format.thousandsSeparator !== false) {
      const [intPart, fracPart] = str.split(".");
      str = Number(intPart).toLocaleString("en-US") + (fracPart ? "." + fracPart : "");
    }
    if (type === "currency") str = "$" + str;
    if (type === "percent") str = str + "%";

    if (negative) {
      const style = format.negativeStyle ?? "minus";
      if (style === "parentheses") str = `(${str})`;
      else if (style === "minus") str = `-${str}`;
      // "none" — render as if positive
    }
    return str;
  }

  if (type === "date") {
    const d = rawValue instanceof Date ? rawValue : new Date(String(rawValue));
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = format.dateFormat ?? "MM/DD/YYYY";
    return fmt
      .replace("MM", pad(d.getMonth() + 1))
      .replace("DD", pad(d.getDate()))
      .replace("YYYY", String(d.getFullYear()));
  }

  if (type === "ssn" || type === "ein" || type === "phone") {
    const digits = String(rawValue).replace(/\D/g, "");
    if (type === "ssn") return digits.replace(/(\d{3})(\d{2})(\d{4})/, "$1-$2-$3");
    if (type === "ein") return digits.replace(/(\d{2})(\d{7})/, "$1-$2");
    return digits.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3");
  }

  let str = String(rawValue);
  if (format.textTransform === "uppercase") str = str.toUpperCase();
  if (format.maxLength && format.overflow === "truncate") str = str.slice(0, format.maxLength);
  return str;
}

function defaultAlignment(format: FieldAnnotation["format"]): "left" | "center" | "right" {
  if (format.alignment) return format.alignment;
  if (format.type === "checkbox") return "center";
  if (["currency", "number", "integer", "percent"].includes(format.type)) return "right";
  return "left";
}

// ---------------------------------------------------------------------------
// Top-level resolve
// ---------------------------------------------------------------------------

export function resolveForm(template: FormTemplate, data: unknown): DrawInstruction[] {
  const out: DrawInstruction[] = [];

  for (const field of template.fields) {
    if (field.conditional && !evaluateShowIf(field.conditional.showIf, data)) continue;

    if (field.repeat) {
      const items = evaluatePath(field.repeat.over, data);
      const values = items.list ? items.values : [items.value];
      const rows = values.slice(0, field.repeat.maxRows);
      rows.forEach((element, i) => {
        const raw = resolveBinding(field.dataBinding, data, element);
        out.push(buildInstruction(field, raw, i * field.repeat!.rowHeight));
      });
      continue;
    }

    const raw = resolveBinding(field.dataBinding, data);
    out.push(buildInstruction(field, raw, 0));
  }

  return out;
}

function buildInstruction(field: FieldAnnotation, raw: unknown, yOffset: number): DrawInstruction {
  return {
    id: field.id,
    page: field.page,
    x: field.position.x,
    y: field.position.y + yOffset,
    width: field.position.width,
    height: field.position.height,
    unit: field.position.unit,
    text: formatValue(raw, field.format),
    align: defaultAlignment(field.format),
    fontSize: field.format.font?.size,
    fontFamily: field.format.font?.family,
  };
}
