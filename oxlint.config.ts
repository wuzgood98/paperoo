import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import next from "ultracite/oxlint/next";
import nextJsPlugins from "ultracite/oxlint/next/js-plugins";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";

const jsPlugins = selectJsPlugins(["react-doctor"]);

export default defineConfig({
  extends: [core, react, next, nextJsPlugins, shadcn, antiSlop, jsPlugins],
  ignorePatterns: [...(core.ignorePatterns ?? []), "public/pdfjs/**"],
  jsPlugins: [...(jsPlugins.jsPlugins ?? []), ...(shadcn.jsPlugins ?? [])],
  overrides: [
    {
      files: ["components/editor/**/*.{ts,tsx}"],
      rules: {
        "react/forbid-component-props": "off",
        "react/no-unknown-property": "off",
        // Page objects use runtime geometry and paint, not design-system tokens.
        "shadcn/no-arbitrary-values": "off",
        "shadcn/no-inline-styles": "off",
      },
    },
  ],
  rules: {
    // Geometric shapes (rect, ellipse, line) are the editor domain, not structural types.
    "anti-slop/no-shape-in-symbol-names": "off",
  },
  settings: jsPluginSettings,
});
