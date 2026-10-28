import presets from "@cybozu/eslint-config/flat/presets/typescript-prettier.js";

/** @type {import("eslint").Linter.Config[]} */
export default [...presets, { ignores: ["lib/", "dist/", "node_modules/"] }];
