import { describe, expect, it } from "vitest";
import { extractPacienteFromHar, extractTokenFromHar, parsePacienteFromLgBody } from "./har.js";

const JWT = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3OCIsImV4cCI6MTk5OTk5OTk5OX0.c2lnMTIzNDU2";

/** HAR mínimo con las entries dadas. */
function har(entries: unknown[]): string {
  return JSON.stringify({ log: { entries } });
}

describe("extractTokenFromHar", () => {
  it("extrae el token del header Authorization", () => {
    const content = har([
      {
        request: {
          url: "https://api.miconsulta.essalud.gob.pe/api/perfil",
          headers: [{ name: "Authorization", value: `Bearer ${JWT}` }],
        },
      },
    ]);
    expect(extractTokenFromHar("x.har", content)).toBe(JWT);
  });

  it("extrae el token embebido en el body de la respuesta", () => {
    const content = har([
      {
        request: { url: "https://api.miconsulta.essalud.gob.pe/api/lg", headers: [] },
        response: { content: { text: `{"access_token":"${JWT}"}` } },
      },
    ]);
    expect(extractTokenFromHar("x.har", content)).toBe(JWT);
  });

  it("devuelve null si no hay ningún JWT", () => {
    const content = har([
      { request: { url: "https://otro.com", headers: [{ name: "X", value: "y" }] } },
    ]);
    expect(extractTokenFromHar("x.har", content)).toBeNull();
  });

  it("lanza si el HAR no es JSON válido", () => {
    expect(() => extractTokenFromHar("malo.har", "{no json")).toThrow(/HAR inválido/);
  });
});

describe("parsePacienteFromLgBody", () => {
  it("mapea los datos del paciente desde /api/lg", () => {
    const body = JSON.stringify({
      data: {
        paciente: {
          codCentro: "021",
          desCentro: "Hospital X",
          apePaterno: "Pérez",
          apeMaterno: "Gómez",
          nombres: "Ana",
          nroCelular: "999888777",
        },
      },
    });
    expect(parsePacienteFromLgBody(body)).toEqual({
      codCentro: "021",
      desCentro: "Hospital X",
      apePaterno: "Pérez",
      apeMaterno: "Gómez",
      nombres: "Ana",
      email: null,
      celular: "999888777",
    });
  });

  it("devuelve null con body vacío o sin paciente", () => {
    expect(parsePacienteFromLgBody("")).toBeNull();
    expect(parsePacienteFromLgBody("{}")).toBeNull();
    expect(parsePacienteFromLgBody('{"data":{}}')).toBeNull();
  });
});

describe("extractPacienteFromHar", () => {
  it("encuentra el paciente en la entry /api/lg", () => {
    const content = har([
      { request: { url: "https://x/api/otro" }, response: { content: { text: "{}" } } },
      {
        request: { url: "https://x/api/lg" },
        response: {
          content: { text: '{"data":{"paciente":{"codCentro":"021","desCentro":"H"}}}' },
        },
      },
    ]);
    expect(extractPacienteFromHar(content)?.codCentro).toBe("021");
  });

  it("devuelve null si no hay entry /api/lg", () => {
    const content = har([{ request: { url: "https://x/api/otro" } }]);
    expect(extractPacienteFromHar(content)).toBeNull();
  });
});
