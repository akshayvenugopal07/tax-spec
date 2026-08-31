/**
 * TypeScript "classes" form of the Tax Form Annotation Specification.
 * See /SPEC.md for the full written spec. These types are the source of
 * truth for shape; schema/form-annotation.schema.json is the JSON Schema
 * mirror used for structural validation of authored files.
 */

export type Unit = "pt" | "in" | "mm";

export interface Page {
  number: number; // 1-indexed
  width: number;
  height: number;
  unit: Unit;
}

export interface Position {
  /** Top-left corner, x increasing right. */
  x: number;
  /** Top-left corner, y increasing DOWN (see SPEC.md §4 for the PDF conversion note). */
  y: number;
  width: number;
  height: number;
  unit: Unit;
}

export type FormatType =
  | "currency"
  | "number"
  | "integer"
  | "percent"
  | "text"
  | "date"
  | "ssn"
  | "ein"
  | "phone"
  | "checkbox"
  | "signature";

export type Alignment = "left" | "center" | "right";
export type NegativeStyle = "parentheses" | "minus" | "none";
export type Overflow = "shrink-to-fit" | "wrap" | "truncate" | "error";

export interface FontHint {
  family?: string;
  size?: number;
  weight?: string;
}

export interface FormatSpec {
  type: FormatType;
  decimalPlaces?: number;
  negativeStyle?: NegativeStyle;
  alignment?: Alignment;
  thousandsSeparator?: boolean;
  font?: FontHint;
  maxLength?: number;
  textTransform?: "uppercase" | "none";
  dateFormat?: string;
  checkboxMark?: "X" | "check";
  overflow?: Overflow;
}

export type Aggregate = "sum" | "count" | "avg" | "min" | "max" | "first" | "last" | "join";
export type Transform = "abs" | "negate" | "round";

export interface DataBinding {
  /** JSONPath-lite expression. Omit only when `literal` is set. See SPEC.md §6.1. */
  path?: string;
  /** Required when `path` resolves to more than one match. */
  aggregate?: Aggregate;
  transform?: Transform;
  /** Value/behavior used when `path` resolves to nothing. */
  fallback?: unknown;
  /** Static value, bypassing `path` resolution entirely. */
  literal?: unknown;
}

export interface ConditionalSpec {
  /** Single boolean predicate, same grammar as a path filter. */
  showIf: string;
}

export interface RepeatSpec {
  /** Path resolving to an array; the annotation repeats once per element. */
  over: string;
  /** Vertical offset per repetition, in the box's unit. */
  rowHeight: number;
  maxRows: number;
  overflowFormId?: string;
}

export interface FieldAnnotation {
  id: string;
  formLine: string;
  description?: string;
  page: number;
  position: Position;
  format: FormatSpec;
  dataBinding: DataBinding;
  conditional?: ConditionalSpec;
  repeat?: RepeatSpec;
}

export interface FormTemplate {
  formId: string;
  formVersion: string;
  title?: string;
  pages: Page[];
  fields: FieldAnnotation[];
}

/** What a conforming resolver produces per box — the renderer's actual input. */
export interface DrawInstruction {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  unit: Unit;
  text: string;
  align: Alignment;
  fontSize?: number;
  fontFamily?: string;
}
