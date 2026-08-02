import type { ReactNode } from "react";
import type { Emphasis } from "@schema";
import { parseDescription } from "../lib/description";
import type { VarMap } from "../lib/interpolate";
import { DescriptionTokens } from "./description-tokens";

/** Interpolated step description for print — takes vars directly (no form context). */
export function PrintDescription(props: {
  text: string;
  vars: VarMap;
  emphasis?: Emphasis[];
}): ReactNode {
  return (
    <DescriptionTokens
      tokens={parseDescription(props.text, props.vars, props.emphasis)}
    />
  );
}
