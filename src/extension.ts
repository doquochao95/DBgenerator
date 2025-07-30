'use strict';
import * as vscode from 'vscode';
import { GeneratorController } from './controller/generator.controller';
import { getConfiguration } from './helpers/config.helper';
import { Mode } from './common/enums';

export function activate(context: vscode.ExtensionContext) {
    const generatorController = new GeneratorController(getConfiguration(), vscode.workspace.workspaceFolders);
    const databaseCommand = vscode.commands.registerCommand('dbgenerator.generate', async (uri: vscode.Uri) => {
        await generatorController.genDatabase(uri, Mode.Generate)
    });
    const repositoryCommand = vscode.commands.registerCommand('dbgenerator.regenerate', async (uri: vscode.Uri) => {
        await generatorController.genDatabase(uri, Mode.Regenerate)
    });
    context.subscriptions.push(
        databaseCommand,
        repositoryCommand
    );
}
// This method is called when your extension is deactivated 
export function deactivate() { }