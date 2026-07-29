/// <reference types="vite/client" />

export const modules = import.meta.glob([
  "./**/*.{js,ts}",
  "!./**/*.d.ts",
  "!./**/*.test.ts",
]);
