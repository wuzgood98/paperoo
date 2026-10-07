import type { ReactElement } from "react";

export const logoMarkPath =
  "M8.5 3.5H16L26.5 14V23A4.5 4.5 0 0 1 22 27.5H8.5A4.5 4.5 0 0 1 4 23V8A4.5 4.5 0 0 1 8.5 3.5ZM18.2 3H28.5V13.3ZM9.7 14.1a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0-4.6 0Z";

export const LogoGlyph = ({
  fill,
  size,
}: {
  fill: string;
  size: number;
}): ReactElement => (
  <svg
    fill={fill}
    height={size}
    viewBox="0 0 32 32"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d={logoMarkPath} fillRule="evenodd" />
  </svg>
);

export const LogoMark = ({
  className,
}: {
  className?: string;
}): ReactElement => (
  <svg
    aria-hidden
    className={className}
    fill="currentColor"
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d={logoMarkPath} fillRule="evenodd" />
  </svg>
);
