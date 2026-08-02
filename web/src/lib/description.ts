import type { Emphasis } from "@schema";
import { interpolate, type VarMap } from "./interpolate";

/** A styled run of a step description, ready to render. */
export interface DescToken {
  text: string;
  bold: boolean;
  colour?: string;
}

/**
 * Turn a step description into styled tokens:
 *  - `{{variables}}` are interpolated,
 *  - `**bold**` spans (as authored in the source form) become bold runs,
 *  - any `emphasis` entry colours its matching (interpolated) substring.
 *
 * The on-screen form does not replicate the paper layout, but bold and colour
 * carry meaning — which unit is being manipulated — so they are preserved.
 */
export function parseDescription(
  text: string,
  vars: VarMap,
  emphasis?: Emphasis[],
): DescToken[] {
  const interpolated = interpolate(text, vars);
  const colours = (emphasis ?? [])
    .map((e) => ({ text: interpolate(e.text, vars), colour: e.colour }))
    .filter((e) => e.text.length > 0);

  const tokens: DescToken[] = [];
  // Splitting on "**" alternates normal / bold segments (source markers are balanced).
  interpolated.split("**").forEach((segment, i) => {
    if (segment === "") return;
    tokens.push(...applyColours(segment, i % 2 === 1, colours));
  });
  return tokens;
}

type ColourTarget = { text: string; colour: string };

function applyColours(
  segment: string,
  bold: boolean,
  colours: ColourTarget[],
): DescToken[] {
  let earliest: { index: number; target: ColourTarget } | null = null;
  for (const target of colours) {
    const index = segment.indexOf(target.text);
    if (index >= 0 && (earliest === null || index < earliest.index)) {
      earliest = { index, target };
    }
  }
  if (earliest === null) return [{ text: segment, bold }];

  const { index, target } = earliest;
  const before = segment.slice(0, index);
  const after = segment.slice(index + target.text.length);
  return [
    ...(before ? applyColours(before, bold, colours) : []),
    { text: target.text, bold, colour: target.colour },
    ...(after ? applyColours(after, bold, colours) : []),
  ];
}
