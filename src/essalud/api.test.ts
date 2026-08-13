import { afterEach, describe, expect, it, vi } from "vitest";

// La sesión vive en disco; mockeamos fs para no tocar el filesystem real.
// readFile devuelve el token para cualquier ruta (token o refresh_token).
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => "eyJhbGci.eyJzdWIi.firma\n"),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  chmod: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
}));

import { EsSaludApiError, HttpError, parseCredenciales, renovarSesion, request } from "./api.js";

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

/** Encola respuestas: una por llamada, en orden. */
function mockFetchSequence(
  respuestas: Array<{ status: number; body: unknown }>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => {
    const r = respuestas.shift();
    if (!r) throw new Error("fetch llamado más veces de las esperadas");
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      json: async () => r.body,
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
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

  it("expone el estado HTTP cuando la respuesta no es ok", async () => {
    mockFetch({}, false, 500);
    await expect(request("GET", "perfil")).rejects.toMatchObject({
      name: "HttpError",
      status: 500,
      method: "GET",
      path: "/perfil",
    });
  });

  it("renueva y reintenta cuando el token está vencido (403)", async () => {
    const fetchMock = mockFetchSequence([
      { status: 403, body: {} }, // token vencido
      { status: 200, body: { access_token: "nuevo.access.token", refresh_token: "nuevo.refresh" } },
      { status: 200, body: { codError: "0", desError: "", vDataItem: { ok: true } } },
    ]);

    await expect(request("GET", "perfil")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [urlRetoken] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(urlRetoken).toMatch(/\/retoken$/);
    // El reintento usa el access token nuevo, no el vencido.
    const [, initReintento] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((initReintento.headers as Record<string, string>).Authorization).toBe(
      "Bearer nuevo.access.token",
    );
  });

  it("no reintenta si la renovación falla", async () => {
    const fetchMock = mockFetchSequence([
      { status: 403, body: {} },
      { status: 400, body: { error: "invalid_grant" } }, // refresh vencido
    ]);

    await expect(request("GET", "perfil")).rejects.toThrow(/HTTP 403/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("renovarSesion", () => {
  it("manda el refresh token en snake_case y devuelve el access nuevo", async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { access_token: "access.nuevo", refresh_token: "refresh.nuevo" } },
    ]);

    await expect(renovarSesion()).resolves.toBe("access.nuevo");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "eyJhbGci.eyJzdWIi.firma" });
    // /retoken es público: mandar el access token vencido lo hace fallar con 403.
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("propaga errores transitorios de /retoken con su estado HTTP", async () => {
    mockFetchSequence([{ status: 500, body: {} }]);
    const renovacion = renovarSesion();
    await expect(renovacion).rejects.toBeInstanceOf(HttpError);
    await expect(renovacion).rejects.toMatchObject({ status: 500, path: "/retoken" });
  });
});

describe("parseCredenciales", () => {
  it("lee el par de la raíz (respuesta de /retoken)", () => {
    expect(parseCredenciales({ access_token: "a", refresh_token: "r" })).toEqual({
      access_token: "a",
      refresh_token: "r",
    });
  });

  it("lee el par de data.credenciales (respuesta de /lg)", () => {
    const lg = { message: null, codResult: 1, data: { credenciales: { access_token: "a" } } };
    expect(parseCredenciales(lg)?.access_token).toBe("a");
  });

  it("devuelve null si no hay access_token", () => {
    expect(parseCredenciales({ data: { credenciales: { refresh_token: "r" } } })).toBeNull();
    expect(parseCredenciales(null)).toBeNull();
    expect(parseCredenciales("nada")).toBeNull();
  });
});
