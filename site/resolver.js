// Plain-JS port of src/resolver.ts, used only to drive the live demo on this
// page. It deliberately reimplements the same rules independently (rather
// than importing the TS build) to prove the spec is followable by "someone
// else's code," per the problem statement — not just the reference resolver.

function splitPathParts(body) {
  const parts = [];
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

function parseLiteral(raw) {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^'.*'$/.test(t) || /^".*"$/.test(t)) return t.slice(1, -1);
  return t;
}

function parsePath(path) {
  const body = path.trim().replace(/^\$\.?/, "");
  if (body === "") return [];
  const segments = [];
  const tokenRe = /([A-Za-z0-9_]+)((?:\[[^\]]*\])*)/;
  for (const part of splitPathParts(body)) {
    const m = tokenRe.exec(part);
    if (!m || m[0] !== part) throw new Error(`Unsupported path segment "${part}" in "${path}"`);
    segments.push({ kind: "key", name: m[1] });
    const brackets = m[2].match(/\[[^\]]*\]/g) || [];
    for (const bracket of brackets) {
      const inner = bracket.slice(1, -1);
      if (inner === "*") segments.push({ kind: "wildcard" });
      else if (/^\d+$/.test(inner)) segments.push({ kind: "index", index: Number(inner) });
      else {
        const fm = inner.match(/^\?\(@\.([A-Za-z0-9_]+)\s*(==|!=)\s*(.+)\)$/);
        if (!fm) throw new Error(`Unsupported filter "${bracket}" in "${path}"`);
        segments.push({ kind: "filter", field: fm[1], op: fm[2], value: parseLiteral(fm[3]) });
      }
    }
  }
  return segments;
}

export function evaluatePath(data, path) {
  let current = [data];
  for (const seg of parsePath(path)) {
    const next = [];
    for (const node of current) {
      if (node === undefined || node === null) continue;
      if (seg.kind === "key") {
        const v = node[seg.name];
        if (v !== undefined) next.push(v);
      } else if (seg.kind === "index") {
        if (Array.isArray(node)) {
          const v = node[seg.index];
          if (v !== undefined) next.push(v);
        }
      } else if (seg.kind === "wildcard") {
        if (Array.isArray(node)) next.push(...node);
      } else if (seg.kind === "filter") {
        if (Array.isArray(node)) {
          for (const item of node) {
            const fv = item?.[seg.field];
            const match = seg.op === "==" ? fv === seg.value : fv !== seg.value;
            if (match) next.push(item);
          }
        }
      }
    }
    current = next;
  }
  return current;
}

export function evaluateConditional(data, cond) {
  const value = evaluatePath(data, cond.path)[0];
  if (cond.exists !== undefined) {
    const present = value !== undefined && value !== null;
    return cond.exists ? present : !present;
  }
  if (cond.equals !== undefined) return value === cond.equals;
  if (cond.notEquals !== undefined) return value !== cond.notEquals;
  if (cond.greaterThan !== undefined) return typeof value === "number" && value > cond.greaterThan;
  if (cond.lessThan !== undefined) return typeof value === "number" && value < cond.lessThan;
  return value !== undefined && value !== null;
}

function applyMask(raw, mask) {
  const digits = String(raw).replace(/\D/g, "");
  const revealCount = (mask.match(/#/g) || []).length;
  const revealed = digits.slice(Math.max(0, digits.length - revealCount));
  let ri = 0;
  let out = "";
  for (const ch of mask) {
    if (ch === "#") out += revealed[ri++] ?? "#";
    else out += ch;
  }
  return out;
}

function formatNumeric(value, format) {
  const dp = format.decimalPlaces ?? (format.type === "currency" ? 2 : 0);
  const magnitude = format.type === "percent" ? value * 100 : value;
  let body = Math.abs(magnitude).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (format.type === "currency") body = "$" + body;
  if (format.type === "percent") body = body + "%";
  if (magnitude < 0) return format.negativeStyle === "parentheses" ? `(${body})` : `-${body}`;
  return body;
}

export function formatValue(raw, format) {
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
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return String(raw);
      const pad = (n) => String(n).padStart(2, "0");
      return (format.dateFormat || "MM/DD/YYYY")
        .replace("YYYY", d.getFullYear())
        .replace("MM", pad(d.getMonth() + 1))
        .replace("DD", pad(d.getDate()));
    }
    case "ssn":
    case "ein":
      return format.mask ? applyMask(raw, format.mask) : String(raw);
    default:
      return String(raw);
  }
}

function aggregateMatches(matches, aggregate) {
  switch (aggregate) {
    case "sum": return matches.reduce((t, v) => t + Number(v ?? 0), 0);
    case "count": return matches.length;
    case "min": return matches.length ? Math.min(...matches.map(Number)) : undefined;
    case "max": return matches.length ? Math.max(...matches.map(Number)) : undefined;
    case "join": return matches.map(String).join(", ");
    default: return matches[0];
  }
}

function offsetPosition(position, rowIndex, rowHeight, direction) {
  return direction === "horizontal"
    ? { ...position, x: position.x + rowIndex * rowHeight }
    : { ...position, y: position.y + rowIndex * rowHeight };
}

function resolveSingle(field, data) {
  const base = { id: field.id, page: field.page, position: field.position };
  if (field.conditional && !evaluateConditional(data, field.conditional)) return { ...base, skipped: true };
  if (field.format.type === "literal") return { ...base, value: formatValue(undefined, field.format) };
  const matches = evaluatePath(data, field.dataBinding.path);
  const raw = matches.length > 0 ? aggregateMatches(matches, field.dataBinding.aggregate) : field.dataBinding.fallback;
  return { ...base, value: formatValue(raw, field.format) };
}

function resolveRepeating(field, data) {
  const repeat = field.repeat;
  if (field.conditional && !evaluateConditional(data, field.conditional)) {
    return [{ id: field.id, page: field.page, position: field.position, skipped: true }];
  }
  const sourceMatches = evaluatePath(data, repeat.sourcePath);
  const sourceItems = sourceMatches.length === 1 && Array.isArray(sourceMatches[0]) ? sourceMatches[0] : sourceMatches;
  const rows = repeat.maxRows ? sourceItems.slice(0, repeat.maxRows) : sourceItems;
  const direction = repeat.direction || "vertical";
  const matches = evaluatePath(data, field.dataBinding.path);
  return rows.map((_, i) => ({
    id: field.id,
    page: field.page,
    position: offsetPosition(field.position, i, repeat.rowHeight, direction),
    row: i,
    value: formatValue(matches[i] ?? field.dataBinding.fallback, field.format),
  }));
}

/** Resolves every field in a FormTemplate against a taxpayer data document. */
export function resolveForm(template, data) {
  const resolved = [];
  for (const field of template.fields) {
    if (field.format.type !== "literal" && field.repeat) resolved.push(...resolveRepeating(field, data));
    else resolved.push(resolveSingle(field, data));
  }
  return resolved;
}
