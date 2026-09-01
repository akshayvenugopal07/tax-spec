/**
 * TypeScript mirror of the Tax Form Annotation Spec (SPEC.md) and
 * schema/form-annotation.schema.json. This is the shape of an *annotation
 * file* — the contract between the annotator (who marks up a blank form)
 * and the renderer (who prints values into it). See SPEC.md for the
 * full write-up of each concept below.
 */

/** Measurement unit for positions and page geometry. `pt` is the normalized internal unit. */
export type Unit = "pt" | "in" | "mm";

/** Physical geometry of one page of the form. */
export interface Page {
  /** 1-indexed page number. */
  number: number;
  width: number;
  height: number;
  unit: Unit;
  /** Path/URL to a rasterized image of this page, for overlaying `position` boxes during review. Not used by the resolver. */
  referenceImageUrl?: string;
}

/**
 * Where a box sits on the page. Top-left origin, x increasing right,
 * y increasing down. Measured directly off the form's official published
 * layout — see SPEC.md §5.
 */
export interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: Unit;
}

/** How a resolved value should be printed. */
export type FormatType =
  | "currency"
  | "number"
  | "percent"
  | "date"
  | "ssn"
  | "ein"
  | "text"
  | "boolean"
  | "literal";

/** How a negative currency/number value is printed. See SPEC.md §6. */
export type NegativeStyle = "minus" | "parentheses" | "redText";

export type Alignment = "left" | "right" | "center";

interface FormatSpecBase {
  type: FormatType;
  alignment?: Alignment;
}

interface NumericFormatSpec extends FormatSpecBase {
  type: "currency" | "number" | "percent";
  decimalPlaces?: number;
  negativeStyle?: NegativeStyle;
}

interface DateFormatSpec extends FormatSpecBase {
  type: "date";
  dateFormat?: string;
}

interface MaskedFormatSpec extends FormatSpecBase {
  type: "ssn" | "ein";
  /** Redaction pattern, e.g. "XXX-XX-####": X redacts, # reveals the real digit, others print as-is. */
  mask?: string;
}

interface PlainFormatSpec extends FormatSpecBase {
  type: "text" | "boolean";
}

/** A box with no `dataBinding` — static form text, not taxpayer data. */
export interface LiteralFormatSpec extends FormatSpecBase {
  type: "literal";
  literalValue: string;
}

/** How a resolved value should be printed. Discriminated on `type`. */
export type FormatSpec =
  | NumericFormatSpec
  | DateFormatSpec
  | MaskedFormatSpec
  | PlainFormatSpec
  | LiteralFormatSpec;

/** Collapses a wildcard/filter path match down to one printable value. */
export type Aggregate = "sum" | "first" | "count" | "min" | "max" | "join";

/**
 * Points a box at a value inside the taxpayer's (deeply nested) data
 * document. See SPEC.md §7 for the supported JSONPath-lite grammar.
 */
export interface DataBinding {
  /** JSONPath-lite expression, e.g. "$.income.w2Forms[*].box1Wages". */
  path: string;
  /** Required when `path` can match more than one value. */
  aggregate?: Aggregate;
  /** Used when `path` resolves to nothing, e.g. 0, "", or null. */
  fallback?: unknown;
}

/**
 * Whether a box renders at all. Exactly one comparison operator is
 * expected alongside `path`. See SPEC.md §8.
 */
export interface ConditionalSpec {
  path: string;
  equals?: unknown;
  notEquals?: unknown;
  exists?: boolean;
  greaterThan?: number;
  lessThan?: number;
}

/**
 * Turns one annotation into a template for N repeated rows (e.g. multiple
 * employers on a summary page). See SPEC.md §9.
 */
export interface RepeatSpec {
  /** Path to the array being iterated, e.g. "$.income.w2Forms". */
  sourcePath: string;
  /** Offset applied per row, in the position's unit. */
  rowHeight: number;
  direction?: "vertical" | "horizontal";
  /** How many rows the physical form has room for. */
  maxRows?: number;
}

interface FieldAnnotationBase {
  /**
   * Unique within the form, stable across `formVersion` revisions.
   * Convention: `<formId>.<box>.<shortName>`, dot-separated segments
   * (camelCase within a segment). See SPEC.md §7.
   */
  id: string;
  /** The form's own label for the box, copied verbatim from the official form, e.g. "Box 1". */
  formLine: string;
  description?: string;
  /** 1-indexed page this box appears on. */
  page: number;
  position: Position;
  conditional?: ConditionalSpec;
  repeat?: RepeatSpec;
}

/** A box whose value comes from the taxpayer's data. */
export interface DataBoundFieldAnnotation extends FieldAnnotationBase {
  format: Exclude<FormatSpec, LiteralFormatSpec>;
  dataBinding: DataBinding;
}

/** A box with static form text — no taxpayer data involved. */
export interface LiteralFieldAnnotation extends FieldAnnotationBase {
  format: LiteralFormatSpec;
  dataBinding?: undefined;
}

/** One entry per printable box, or per repeating box template. See SPEC.md §4. */
export type FieldAnnotation = DataBoundFieldAnnotation | LiteralFieldAnnotation;

/** One `FormTemplate` document describes one form, for one tax year. See SPEC.md §3. */
export interface FormTemplate {
  /** Stable identifier for the form, e.g. "W-2", "1099-INT", "F1040". */
  formId: string;
  /** Tax year the layout matches, e.g. "2024". */
  formVersion: string;
  /** Official form title, for display. */
  title: string;
  /** Which agency publishes this form's official layout. */
  issuingAgency?: "IRS" | "SSA";
  /** URL or citation for the official IRS/SSA PDF this annotation was measured from. See SPEC.md §5. */
  sourceDocument?: string;
  pages: Page[];
  fields: FieldAnnotation[];
}

/** True when a field annotation carries taxpayer data (as opposed to static literal text). */
export function isDataBound(field: FieldAnnotation): field is DataBoundFieldAnnotation {
  return field.format.type !== "literal";
}
