'use strict';
import * as vscode from 'vscode';
import { GeneratorController } from './controller/generator.controller';
import { getConfiguration } from './helpers/config.helper';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "converter" is now active!');
    const generatorController = new GeneratorController(getConfiguration());
    const workspacePath = vscode.workspace.workspaceFolders;
    const databaseCommand = vscode.commands.registerCommand('dbgenerator.database', async (uri: vscode.Uri) => {
        await generatorController.genDatabase(uri, workspacePath)
    });
    const repositoryCommand = vscode.commands.registerCommand('dbgenerator.repository', async (uri: vscode.Uri) => {
        await generatorController.genRepository(uri, workspacePath)
    });
    context.subscriptions.push(
        databaseCommand,
        repositoryCommand
    );
}
// This method is called when your extension is deactivated 
export function deactivate() { }