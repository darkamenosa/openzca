import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/lib/**/*.test.ts"],
    pool: "forks",
    singleFork: true,
  },
});
