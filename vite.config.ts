import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
});
