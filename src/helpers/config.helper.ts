
import * as vscode from 'vscode';
import { DbGeneratorConfig } from '../common/interfaces';

/**
 * Get the package configuration from VSCode
 */
export function getConfiguration(): DbGeneratorConfig {
  const dbContextFileName = vscode.workspace.getConfiguration('dbgenerator').get("dbContextFileName") as string;
  const dataFolder = vscode.workspace.getConfiguration('dbgenerator').get("dataFolder") as string;
  const modelFolder = vscode.workspace.getConfiguration('dbgenerator').get("modelFolder") as string;
  const appSettingFileName = vscode.workspace.getConfiguration('dbgenerator').get("appSettingFileName") as string;
  const repoFileName = vscode.workspace.getConfiguration('dbgenerator').get("repoFileName") as string;
  const repoFolder = vscode.workspace.getConfiguration('dbgenerator').get("repoFolder") as string;
  // Clean Architecture
  const domainFolder = vscode.workspace.getConfiguration('dbgenerator').get("domainFolder") as string || 'Domain';
  const entityFolder = vscode.workspace.getConfiguration('dbgenerator').get("entityFolder") as string || 'Entities';
  const infrastructureFolder = vscode.workspace.getConfiguration('dbgenerator').get("infrastructureFolder") as string || 'Infrastructure';
  const configurationsFolder = vscode.workspace.getConfiguration('dbgenerator').get("configurationsFolder") as string || 'Configurations';
  const cleanArchDbContextFileName = vscode.workspace.getConfiguration('dbgenerator').get("cleanArchDbContextFileName") as string || 'AppDBContext';
  const cleanArchDbConfigurationsFileName = vscode.workspace.getConfiguration('dbgenerator').get("cleanArchDbConfigurationsFileName") as string || 'AppDBConfigurations';
  return {
    dbContextFileName,
    dataFolder,
    modelFolder,
    appSettingFileName,
    repoFileName,
    repoFolder,
    domainFolder,
    entityFolder,
    infrastructureFolder,
    configurationsFolder,
    cleanArchDbContextFileName,
    cleanArchDbConfigurationsFileName
  };
}
