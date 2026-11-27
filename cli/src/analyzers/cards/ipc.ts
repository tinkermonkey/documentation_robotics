/**
 * Electron IPC registrations: `ipcMain.handle('files:read', handler)` and `ipcMain.on(...)`.
 *
 * The graph has no node for a registration: its handler is usually an inline arrow, and a channel
 * name is a string, not a symbol. {@link readIpcHandlers} reads the registrations from a file's
 * text, where the channel is a string literal, and says when it met one it could not read (a
 * channel held in a constant or built at run time). That is for the agent to check, never a
 * channel absent. Each registration is a card (label {@link IPC_HANDLER_LABEL}) that Tier 0
 * decides as an application service: a callable the renderer reaches by name.
 */
import { VENDOR_EXCLUDE } from "./build.js";
import { TEST_PATH } from "./routes.js";

export const IPC_HANDLER_LABEL = "IpcHandler";
export const IPC_HANDLER_RULE = "ipc_main_registration";

export interface IpcHandler {
  /** The registering call: `handle` (request and reply) or `on` (a message with no reply). */
  kind: "handle" | "on";
  channel: string;
  /** 1-based line of the registration. */
  line: number;
}

export interface IpcHandlersRead {
  handlers: IpcHandler[];
  /** A registration whose channel is not a string literal: not read, so the list may be short. */
  partial: boolean;
}

const REGISTRATION = /\bipcMain\s*\.\s*(handle|handleOnce|on|once)\s*\(\s*([^,)]*)/g;
const LITERAL = /^(['"`])([^'"`$\\\n]+)\1$/;

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Comments blanked (lines kept), so a commented-out registration is not read. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => " ".repeat(m.length));
}

export function readIpcHandlers(source: string): IpcHandlersRead {
  const text = withoutComments(source);
  const found = new Map<string, IpcHandler>();
  let partial = false;
  for (const m of text.matchAll(REGISTRATION)) {
    const literal = LITERAL.exec(m[2].trim());
    if (!literal) {
      partial = true;
      continue;
    }
    const kind = m[1].startsWith("handle") ? "handle" : "on";
    const key = `${kind} ${literal[2]}`;
    if (!found.has(key)) found.set(key, { kind, channel: literal[2], line: lineOf(text, m.index ?? 0) });
  }
  return { handlers: [...found.values()], partial };
}

export interface FileIpcHandler extends IpcHandler {
  file: string;
}

/** The IPC registrations of a project's JS/TS files (tests and vendored code left out), and the files with an unreadable channel. */
export function collectIpcHandlers(
  files: Iterable<string>,
  text: (file: string) => string | null
): { handlers: FileIpcHandler[]; partialFiles: string[] } {
  const handlers: FileIpcHandler[] = [];
  // One element per channel: the same channel in two files (or as handle and on) is read once, at its first file.
  const seen = new Set<string>();
  const partialFiles: string[] = [];
  for (const file of [...files].sort()) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || TEST_PATH.test(file) || VENDOR_EXCLUDE.test(file)) continue;
    const source = text(file);
    if (!source || !source.includes("ipcMain")) continue;
    const read = readIpcHandlers(source);
    for (const h of read.handlers) {
      if (seen.has(h.channel)) continue;
      seen.add(h.channel);
      handlers.push({ ...h, file });
    }
    if (read.partial) partialFiles.push(file);
  }
  return { handlers, partialFiles };
}
