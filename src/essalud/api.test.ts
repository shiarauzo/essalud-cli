import { afterEach, describe, expect, it, vi } from "vitest";

// readToken() lee el token de disco; lo mockeamos para no depender del filesystem.
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => "eyJhbGci.eyJzdWIi.firma\n"),
}));

import { EsSaludApiError, request } from "./api.js";

function mockFetch(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("desenvuelve vDataItem cuando codError es '0'", async () => {
    mockFetch({ codError: "0", desError: "", vDataItem: { foo: "bar" } });
    await expect(request("GET", "perfil")).resolves.toEqual({ foo: "bar" });
  });

  it("lanza EsSaludApiError cuando codError no es '0'", async () => {
    mockFetch({ codError: "1", desError: "no se encontró", vDataItem: null });
    await expect(request("POST", "citasEmitidas", {})).rejects.toBeInstanceOf(EsSaludApiError);
  });

  it("devuelve el JSON directo cuando no hay envoltorio", async () => {
    mockFetch({ nombreAsegurado: "Juan" });
    await expect(request("GET", "perfil")).resolves.toEqual({ nombreAsegurado: "Juan" });
  });

  it("lanza un error de HTTP cuando la respuesta no es ok", async () => {
    mockFetch({}, false, 500);
    await expect(request("GET", "perfil")).rejects.toThrow(/HTTP 500/);
  });
});
