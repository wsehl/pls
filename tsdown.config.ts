import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    pls: "src/main.ts",
  },
  format: "esm",
  platform: "node",
});
