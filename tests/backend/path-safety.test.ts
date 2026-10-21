import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInside } from "../../src/backend/infrastructure/database/path-safety";

describe("validación de rutas locales", () => {
  const root = resolve("empresa-panel-test-root");

  it("distingue las rutas contenidas del directorio padre por segmento", () => {
    expect(isPathInside(root, join(root, "data", "panel.sqlite3"))).toBe(true);
    expect(isPathInside(root, join(root, "..panel.sqlite3"))).toBe(true);
    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(root, resolve(root, "..", "other.sqlite3"))).toBe(false);
  });
});
