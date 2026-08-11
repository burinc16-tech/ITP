/**
 * A deliberately small arithmetic evaluator for `calculated` columns and grouped
 * table totals (SPEC §12).
 *
 * This is not a general expression language and must not become one. It supports
 * numeric literals, identifiers resolved from a caller-supplied scope, the four
 * arithmetic operators, parentheses and unary minus — nothing else. No `eval`, no
 * property access, no function calls: a template is data loaded from the server,
 * so its formulas must never be able to reach anything but the numbers handed to
 * them.
 *
 * Blank propagates rather than defaulting to zero. A diffuser row with a design
 * flow but no balanced reading yet prints an empty percentage cell, not a
 * misleading `0%`, which matches how the source form behaves.
 */

/** Values a formula may reference, keyed by column id. */
export type FormulaScope = Record<string, string | number | null | undefined>;

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" };

const OPERATORS = new Set(["+", "-", "*", "/", "(", ")"]);

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ kind: "op", value: ch as "+" | "-" | "*" | "/" | "(" | ")" });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^[0-9]*\.?[0-9]+/.exec(input.slice(i));
      if (!match) return null;
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i));
      if (!match) return null;
      tokens.push({ kind: "ident", value: match[0] });
      i += match[0].length;
      continue;
    }
    return null; // an unexpected character is a template authoring error
  }
  return tokens;
}

/**
 * Coerce one scope entry to a number. Empty, missing and non-numeric all become
 * `null` — "not filled in", which propagates through the whole expression.
 */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: FormulaScope,
  ) {}

  /** True once every token has been consumed — a trailing token means a bad formula. */
  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(value: string): boolean {
    const t = this.peek();
    if (t && t.kind === "op" && t.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  expr(): number | null {
    let left = this.term();
    for (;;) {
      if (this.eat("+")) {
        const right = this.term();
        left = left === null || right === null ? null : left + right;
      } else if (this.eat("-")) {
        const right = this.term();
        left = left === null || right === null ? null : left - right;
      } else {
        return left;
      }
    }
  }

  private term(): number | null {
    let left = this.factor();
    for (;;) {
      if (this.eat("*")) {
        const right = this.factor();
        left = left === null || right === null ? null : left * right;
      } else if (this.eat("/")) {
        const right = this.factor();
        // Division by zero is "no answer", not Infinity — an unfilled or zero
        // design flow must print blank rather than a nonsense percentage.
        left =
          left === null || right === null || right === 0 ? null : left / right;
      } else {
        return left;
      }
    }
  }

  private factor(): number | null {
    if (this.eat("-")) {
      const value = this.factor();
      return value === null ? null : -value;
    }
    if (this.eat("(")) {
      const value = this.expr();
      if (!this.eat(")")) {
        this.pos = this.tokens.length; // unbalanced — stop and report failure
        return null;
      }
      return value;
    }
    const t = this.peek();
    if (!t) return null;
    if (t.kind === "num") {
      this.pos += 1;
      return t.value;
    }
    if (t.kind === "ident") {
      this.pos += 1;
      // Own properties only: a bare `scope[name]` lookup would resolve
      // `constructor`, `toString` and friends off Object.prototype, letting a
      // template formula name something that is not a column value at all.
      if (!Object.prototype.hasOwnProperty.call(this.scope, t.value)) return null;
      return toNumber(this.scope[t.value]);
    }
    return null;
  }
}

/**
 * Evaluate `expression` against `scope`. Returns `null` when the formula cannot
 * be resolved — a referenced value is blank or non-numeric, a divisor is zero, or
 * the expression itself is malformed. Callers render `null` as an empty cell.
 */
export function evaluateFormula(
  expression: string,
  scope: FormulaScope,
): number | null {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return null;
  const parser = new Parser(tokens, scope);
  const value = parser.expr();
  if (!parser.atEnd()) return null; // trailing junk, e.g. "1 2"
  return value === null || !Number.isFinite(value) ? null : value;
}

/**
 * Format a computed number for display: rounded to `decimals` places (default 0,
 * matching the source form's whole-number percentages) with an optional unit
 * suffix. `null` renders as an empty string so the cell simply stays blank.
 */
export function formatComputed(
  value: number | null,
  options: { decimals?: number; unit?: string } = {},
): string {
  if (value === null) return "";
  const text = value.toFixed(options.decimals ?? 0);
  return options.unit ? `${text}${options.unit}` : text;
}

/** The aggregate functions a totals cell may apply to a column. */
export type Aggregate = "sum" | "mean" | "min" | "max" | "count";

/**
 * Apply `aggregate` across one column of a group's rows. Blank cells are skipped
 * rather than counted as zero; a column with nothing filled in yields `null` so
 * the total prints blank. `sum` of an all-blank column is therefore `null`, not
 * `0` — an empty VAV unit shows an empty total, like the paper form.
 */
export function aggregateColumn(
  aggregate: Aggregate,
  values: Array<string | number | null | undefined>,
): number | null {
  const numbers = values
    .map(toNumber)
    .filter((n): n is number => n !== null);
  if (aggregate === "count") return numbers.length;
  if (numbers.length === 0) return null;
  switch (aggregate) {
    case "sum":
      return numbers.reduce((a, b) => a + b, 0);
    case "mean":
      return numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
  }
}
