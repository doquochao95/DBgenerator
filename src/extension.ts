'use strict';
import * as vscode from 'vscode';
import { GeneratorController } from './controller/generator.controller';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "converter" is now active!');
    const generatorController = new GeneratorController();

    let dbgenerator = vscode.commands.registerCommand('dbgenerator.generate', async (uri: vscode.Uri) => {
        await generatorController.generate(uri)
    });
    context.subscriptions.push(dbgenerator);
}
// This method is called when your extension is deactivated 
export function deactivate() { }