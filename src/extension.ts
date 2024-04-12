'use strict';
import * as vscode from 'vscode';
import { GeneratorController } from './controller/generator.controller';
import { getConfiguration } from './helpers/config.helper';

export function activate(context: vscode.ExtensionContext) {
    const generatorController = new GeneratorController(getConfiguration(), vscode.workspace.workspaceFolders);
    const databaseCommand = vscode.commands.registerCommand('dbgenerator.database', async (uri: vscode.Uri) => {
        await generatorController.genDatabase(uri)
    });
    const repositoryCommand = vscode.commands.registerCommand('dbgenerator.repository', async (uri: vscode.Uri) => {
        await generatorController.genRepository(uri)
    });
    context.subscriptions.push(
        databaseCommand,
        repositoryCommand
    );
}
// This method is called when your extension is deactivated 
export function deactivate() { }