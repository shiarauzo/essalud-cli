import { describe, expect, it } from "vitest";
import { decodeJwtPayload, JWT_RE, looksLikeEsSaludJwt } from "./jwt.js";

/** Arma un JWT de juguete (header.payload.firma) a partir de un payload. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJlMTIzNA`;
}

describe("decodeJwtPayload", () => {
  it("decodifica el payload de un JWT válido", () => {
    const token = makeJwt({ sub: "12345678", exp: 1999999999 });
    expect(decodeJwtPayload(token)).toMatchObject({ sub: "12345678", exp: 1999999999 });
  });

  it("devuelve null si el token no tiene 3 partes", () => {
    expect(decodeJwtPayload("solo.dos")).toBeNull();
    expect(decodeJwtPayload("sintpuntos")).toBeNull();
  });

  it("devuelve null si el payload no es JSON válido", () => {
    const token = `abc.${Buffer.from("no-json").toString("base64url")}.sig`;
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe("looksLikeEsSaludJwt", () => {
  it("acepta un JWT con exp numérico", () => {
    expect(looksLikeEsSaludJwt(makeJwt({ exp: 1999999999 }))).toBe(true);
  });

  it("acepta un JWT con scope", () => {
    expect(looksLikeEsSaludJwt(makeJwt({ scope: ["read"] }))).toBe(true);
  });

  it("rechaza un payload sin exp ni scope", () => {
    expect(looksLikeEsSaludJwt(makeJwt({ foo: "bar" }))).toBe(false);
  });

  it("rechaza basura que no es JWT", () => {
    expect(looksLikeEsSaludJwt("no-soy-un-jwt")).toBe(false);
  });
});

describe("JWT_RE", () => {
  it("matchea un JWT embebido en texto", () => {
    const token = makeJwt({ sub: "12345678", exp: 1999999999, scope: ["read"] });
    expect(`Authorization: Bearer ${token}`.match(JWT_RE)?.[0]).toBe(token);
  });
});
