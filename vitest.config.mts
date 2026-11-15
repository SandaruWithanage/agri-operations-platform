import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}", "apps/api/test/**/*.test.ts"],
    environment: "jsdom",
  },
  oxc: {
    jsx: { runtime: "automatic" },
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
