import { renderAppIcon } from "@/components/brand/app-icon-image";

// A PNG favicon alongside icon.svg: Google Search doesn't accept SVG favicons.
export const size = {
  height: 192,
  width: 192,
};

export const contentType = "image/png";

const Icon = () => renderAppIcon({ purpose: "any", size: size.width });

export default Icon;
