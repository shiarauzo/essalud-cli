import { describe, expect, it } from "vitest";
import {
  extractCredencialesFromHar,
  extractPacienteFromHar,
  extractTokenFromHar,
  parsePacienteFromLgBody,
} from "./har.js";

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

describe("extractCredencialesFromHar", () => {
  /** Entry de login tal como la exporta DevTools: el par va en data.credenciales. */
  function lgEntry(access: string, refresh: string): unknown {
    return {
      request: { url: "https://api.miconsulta.essalud.gob.pe/api/lg", headers: [] },
      response: {
        content: {
          text: JSON.stringify({
            message: null,
            codResult: 1,
            data: {
              successLogin: true,
              credenciales: {
                access_token: access,
                refresh_token: refresh,
                token_type: "bearer",
                expires_in: 86400,
              },
            },
          }),
        },
      },
    };
  }

  it("extrae el access y el refresh token del login", () => {
    const cred = extractCredencialesFromHar(har([lgEntry(JWT, "refresh.uno")]));
    expect(cred).toMatchObject({ access_token: JWT, refresh_token: "refresh.uno" });
  });

  it("se queda con el login más reciente cuando hay varios", () => {
    const content = har([lgEntry(JWT, "refresh.viejo"), lgEntry(JWT, "refresh.nuevo")]);
    expect(extractCredencialesFromHar(content)?.refresh_token).toBe("refresh.nuevo");
  });

  it("devuelve null si el HAR no tiene el login", () => {
    const content = har([
      {
        request: {
          url: "https://api.miconsulta.essalud.gob.pe/api/citasEmitidas",
          headers: [{ name: "Authorization", value: `Bearer ${JWT}` }],
        },
      },
    ]);
    expect(extractCredencialesFromHar(content)).toBeNull();
  });

  it("devuelve null con HAR inválido o body no-JSON", () => {
    expect(extractCredencialesFromHar("{no json")).toBeNull();
    const content = har([
      {
        request: { url: "https://api.miconsulta.essalud.gob.pe/api/lg", headers: [] },
        response: { content: { text: "<html>error</html>" } },
      },
    ]);
    expect(extractCredencialesFromHar(content)).toBeNull();
  });
});

describe("parsePacienteFromLgBody", () => {
  it("arma el nombre con priNombre/segNombre y el celular con numCelular", () => {
    const body = JSON.stringify({
      data: {
        paciente: {
          codCentro: "021",
          desCentro: "POL. EJEMPLO",
          apePaterno: "PEREZ",
          apeMaterno: "GOMEZ",
          priNombre: "JUANA",
          segNombre: "MARIA",
          numCelular: "999000111",
          email: "a@b.com",
        },
      },
    });
    expect(parsePacienteFromLgBody(body)).toMatchObject({
      nombres: "JUANA MARIA",
      celular: "999000111",
    });
  });

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
