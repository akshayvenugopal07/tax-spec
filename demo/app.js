/**
 * Vanilla-JS port of src/resolver.ts — same algorithm, no build step, so it
 * runs directly in a browser (demo/index.html) and in plain Node (used by
 * scripts/generate-example.js to produce examples/resolved-output.json).
 * Keep in sync with src/resolver.ts if you change behavior.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TaxSpec = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // -- path tokenizer -------------------------------------------------------
  const SEGMENT_RE =
    /\.([A-Za-z_][A-Za-z0-9_]*)|\["([^"]+)"\]|\[(\d+)\]|\[\*\]|\[\?\(@\.([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*('([^']*)'|-?\d+(\.\d+)?|true|false)\)\]/g;

  function tokenize(path) {
    let rest = path.trim();
    if (rest.startsWith("$") || rest.startsWith("@")) rest = rest.slice(1);

    const segments = [];
    let match;
    let lastIndex = 0;
    SEGMENT_RE.lastIndex = 0;
    while ((match = SEGMENT_RE.exec(rest)) !== null) {
      if (match.index !== lastIndex) {
        throw new Error('Unparseable path segment near "' + rest.slice(lastIndex) + '" in "' + path + '"');
      }
      if (match[1] !== undefined) segments.push({ kind: "prop", name: match[1] });
      else if (match[2] !== undefined) segments.push({ kind: "prop", name: match[2] });
      else if (match[3] !== undefined) segments.push({ kind: "index", index: Number(match[3]) });
      else if (match[0] === "[*]") segments.push({ kind: "wildcard" });
      else if (match[4] !== undefined) {
        let value;
        if (match[7] !== undefined) value = match[7];
        else if (match[6] === "true") value = true;
        else if (match[6] === "false") value = false;
        else value = Number(match[6]);
        segments.push({ kind: "filter", field: match[4], op: match[5], value: value });
      }
      lastIndex = SEGMENT_RE.lastIndex;
    }
    if (lastIndex !== rest.length) {
      throw new Error('Unparseable trailing path segment "' + rest.slice(lastIndex) + '" in "' + path + '"');
    }
    return segments;
  }

  function compareOp(a, op, b) {
    switch (op) {
      case "==": return a === b;
      case "!=": return a !== b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      default: throw new Error('Unknown filter operator "' + op + '"');
    }
  }

  function evaluatePath(path, data) {
    const segments = tokenize(path);
    let current = [data];
    let sawList = false;

    for (const seg of segments) {
      const next = [];
      for (const item of current) {
        if (item === undefined || item === null) continue;
        if (seg.kind === "prop") {
          next.push(item[seg.name]);
        } else if (seg.kind === "index") {
          next.push(item[seg.index]);
        } else if (seg.kind === "wildcard") {
          sawList = true;
          if (Array.isArray(item)) next.push.apply(next, item);
        } else if (seg.kind === "filter") {
          sawList = true;
          if (Array.isArray(item)) {
            for (const el of item) {
              if (compareOp(el[seg.field], seg.op, seg.value)) next.push(el);
            }
          }
        }
      }
      current = next;
    }

    if (sawList) return { list: true, values: current };
    return { list: false, value: current[0] };
  }

  function applyAggregate(values, aggregate) {
    const nums = () => values.map((v) => Number(v || 0));
    switch (aggregate) {
      case "sum": return nums().reduce((a, b) => a + b, 0);
      case "count": return values.length;
      case "avg": return values.length ? nums().reduce((a, b) => a + b, 0) / values.length : 0;
      case "min": return values.length ? Math.min.apply(null, nums()) : 0;
      case "max": return values.length ? Math.max.apply(null, nums()) : 0;
      case "first": return values[0];
      case "last": return values[values.length - 1];
      case "join": return values.map((v) => String(v == null ? "" : v)).join(", ");
      default:
        throw new Error("Path resolved to a list of " + values.length + " values but no \"aggregate\" was specified.");
    }
  }

  function applyTransform(value, transform) {
    if (transform === undefined) return value;
    const n = Number(value);
    switch (transform) {
      case "abs": return Math.abs(n);
      case "negate": return -n;
      case "round": return Math.round(n);
    }
    return value;
  }

  function resolveBinding(binding, root, current) {
    if (current === undefined) current = root;
    if (binding.literal !== undefined) return binding.literal;
    if (!binding.path) throw new Error("dataBinding must have either `path` or `literal`.");

    const target = binding.path.trim().charAt(0) === "@" ? current : root;
    const result = evaluatePath(binding.path, target);
    let value = result.list ? applyAggregate(result.values, binding.aggregate) : result.value;

    if (value === undefined || value === null) {
      value = binding.fallback !== undefined ? binding.fallback : undefined;
    }
    return applyTransform(value, binding.transform);
  }

  const SHOWIF_RE = /^\s*@\.([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*('([^']*)'|-?\d+(\.\d+)?|true|false)\s*$/;

  function evaluateShowIf(showIf, root) {
    const m = SHOWIF_RE.exec(showIf);
    if (!m) throw new Error('Unparseable showIf expression: "' + showIf + '"');
    let value;
    if (m[4] !== undefined) value = m[4];
    else if (m[3] === "true") value = true;
    else if (m[3] === "false") value = false;
    else value = Number(m[3]);
    return compareOp(root[m[1]], m[2], value);
  }

  // -- formatting -------------------------------------------------------------

  function formatValue(rawValue, format) {
    const type = format.type;
    if (rawValue === undefined || rawValue === null) return "";

    if (type === "checkbox") return rawValue ? (format.checkboxMark || "X") : "";

    if (type === "currency" || type === "number" || type === "integer" || type === "percent") {
      let n = Number(rawValue);
      const decimals = format.decimalPlaces !== undefined ? format.decimalPlaces : (type === "integer" ? 0 : 2);
      const negative = n < 0;
      if (negative) n = Math.abs(n);
      if (type === "percent") n = n * 100;

      let str = n.toFixed(decimals);
      if (format.thousandsSeparator !== false) {
        const parts = str.split(".");
        str = Number(parts[0]).toLocaleString("en-US") + (parts[1] ? "." + parts[1] : "");
      }
      if (type === "currency") str = "$" + str;
      if (type === "percent") str = str + "%";

      if (negative) {
        const style = format.negativeStyle || "minus";
        if (style === "parentheses") str = "(" + str + ")";
        else if (style === "minus") str = "-" + str;
      }
      return str;
    }

    if (type === "date") {
      const d = rawValue instanceof Date ? rawValue : new Date(String(rawValue));
      const pad = (n) => String(n).padStart(2, "0");
      const fmt = format.dateFormat || "MM/DD/YYYY";
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

  function defaultAlignment(format) {
    if (format.alignment) return format.alignment;
    if (format.type === "checkbox") return "center";
    if (["currency", "number", "integer", "percent"].indexOf(format.type) !== -1) return "right";
    return "left";
  }

  function buildInstruction(field, raw, yOffset) {
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
      fontSize: field.format.font && field.format.font.size,
      fontFamily: field.format.font && field.format.font.family,
    };
  }

  function resolveForm(template, data) {
    const out = [];
    for (const field of template.fields) {
      if (field.conditional && !evaluateShowIf(field.conditional.showIf, data)) continue;

      if (field.repeat) {
        const items = evaluatePath(field.repeat.over, data);
        const values = items.list ? items.values : [items.value];
        const rows = values.slice(0, field.repeat.maxRows);
        rows.forEach((element, i) => {
          const raw = resolveBinding(field.dataBinding, data, element);
          out.push(buildInstruction(field, raw, i * field.repeat.rowHeight));
        });
        continue;
      }

      const raw = resolveBinding(field.dataBinding, data);
      out.push(buildInstruction(field, raw, 0));
    }
    return out;
  }

  return { evaluatePath, resolveBinding, formatValue, resolveForm };
});
