
import * as vscode from 'vscode';
import { DbGeneratorConfig } from '../common/interfaces';

/**
 * Get the package configuration from VSCode
 */
export function getConfiguration(): DbGeneratorConfig {
  const dbContextFolder = vscode.workspace.getConfiguration('dbgenerator').get("dbContextFolder") as string;
  const modelFolder = vscode.workspace.getConfiguration('dbgenerator').get("modelFolder") as string;
  const appSettingFileName = vscode.workspace.getConfiguration('dbgenerator').get("appSettingFileName") as string;
  return {
    dbContextFolder,
    modelFolder,
    appSettingFileName
  };
}
