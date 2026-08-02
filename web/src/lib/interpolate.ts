import type { Variable } from "@schema";

/** Resolved variable id → display string, used to expand `{{id}}` tokens. */
export type VarMap = Record<string, string>;

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Build the interpolation map for a record: the value entered for each variable,
 * falling back to the template default. Everything is coerced to a string, since
 * that is what ends up in the rendered text and, later, in `context_snapshot`.
 */
export function buildVarMap(
  variables: Variable[] | undefined,
  values: Record<string, string>,
): VarMap {
  const map: VarMap = {};
  for (const v of variables ?? []) {
    const entered = values[v.id];
    const raw =
      entered !== undefined && entered !== ""
        ? entered
        : v.default === undefined
          ? ""
          : String(v.default);
    map[v.id] = raw;
  }
  return map;
}

/**
 * Replace every `{{id}}` in `text` with its value from `vars`. An unknown id is
 * left as the literal token so a missing variable is visible, not silently blank.
 */
export function interpolate(text: string, vars: VarMap): string {
  return text.replace(TOKEN, (whole, id: string) =>
    id in vars ? vars[id]! : whole,
  );
}
