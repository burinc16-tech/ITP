import type { ReactNode } from "react";
import type { Emphasis } from "@schema";
import { parseDescription } from "../lib/description";
import { DescriptionTokens } from "./description-tokens";
import { useForm } from "./form-context";

/** Renders an interpolated step description with bold and emphasis runs. */
export function Description(props: {
  text: string;
  emphasis?: Emphasis[];
}): ReactNode {
  const { vars } = useForm();
  return (
    <DescriptionTokens tokens={parseDescription(props.text, vars, props.emphasis)} />
  );
}
