import { Terminal, window } from 'vscode';
import { getRealpath } from './filesystem.helper';

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
): Promise<void> => {
  path = await getRealpath(path)
  const terminal = window.terminals.some(x => x.name === "DB Generator")
    ? window.terminals.find(x => x.name === "DB Generator") as Terminal
    : window.createTerminal("DB Generator");
  terminal.show();
  terminal.sendText(`cd ${path}`);
  terminal.sendText(command);
};
