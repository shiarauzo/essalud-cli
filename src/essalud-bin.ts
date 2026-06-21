#!/usr/bin/env node
/**
 * Punto de entrada del comando global `essalud`.
 * Sin argumentos → modo interactivo.
 * Con argumentos → subcomandos one-shot (login, perfil, citas, etc.).
 */
import { Command } from "commander";
import { makeEssaludCommand } from "./essalud/index.js";
import { runInteractiveMode } from "./essalud/interactive.js";

// Si no hay argumentos más allá de node + script → modo interactivo directo
const args = process.argv.slice(2);
if (args.length === 0) {
  void runInteractiveMode();
} else {
  // Reusar todos los subcomandos del comando essalud, pero en un programa raíz
  const program = new Command();
  program.name("essalud").description("Asistente de citas EsSalud").version("0.1.0");

  const essaludCmd = makeEssaludCommand();
  for (const sub of essaludCmd.commands) {
    program.addCommand(sub);
  }

  program.parse(process.argv);
}
