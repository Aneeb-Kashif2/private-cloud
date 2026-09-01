import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", sequence: { concurrent: false }, testTimeout: 20_000 } });
