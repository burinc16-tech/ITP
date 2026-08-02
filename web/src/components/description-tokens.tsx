import { Fragment, type ReactNode } from "react";
import type { DescToken } from "../lib/description";

/** Renders parsed description tokens as bold / coloured runs. Shared by the
 * on-screen and print description components so both style text identically. */
export function DescriptionTokens(props: { tokens: DescToken[] }): ReactNode {
  return (
    <>
      {props.tokens.map((token, i) => {
        const content = token.colour ? (
          <span style={{ color: token.colour }}>{token.text}</span>
        ) : (
          token.text
        );
        return token.bold ? (
          <strong key={i}>{content}</strong>
        ) : (
          <Fragment key={i}>{content}</Fragment>
        );
      })}
    </>
  );
}
