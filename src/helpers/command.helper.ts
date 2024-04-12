import { getRealpath } from './filesystem.helper';
import * as cp from "child_process";
/**
 * Runs a command in the terminal
 *
 * @param {string} path - cd to path
 * @param {string} command - Command to run
 * @example
 * runCommand('D:/Project/', command);
 *
 * @returns {Promise<void>} - No return value
 */
export const runCommand = async (
  path: string,
  command: string,
): Promise<string | undefined> => {
  path = await getRealpath(path)
  try {
    const result = await execShell(`${command}`, path)
    return result
  } catch {
    return undefined
  }
};
export const execShell = async (cmd: string, path: string) =>
  new Promise<string>(resolve => {
    var cmdOpts = { cwd: `${path}` };
    const result = cp.execSync(cmd, cmdOpts);
    resolve(result.toString("utf8"))
  });