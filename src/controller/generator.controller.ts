import * as vscode from 'vscode';
import { Connection, DbGeneratorConfig, TableModel } from '../common/interfaces';
import { pickManyItems, pickSingleItem, showError, showMessage } from '../helpers/dialog.helper';
import { SqlService } from '../service/sql.service';
import { GenType } from '../common/enums';
import { ConnectionOption } from '../common/constants';
import { getRealpath, getRelativePath, runCommand } from '../helpers';
import { error } from 'console';

export class GeneratorController {
    constructor() { }
    public async generate(uri: vscode.Uri) {
        const config = this.getConfiguration();
        const uriType = (await vscode.workspace.fs.stat(uri)).type
        if (uriType == vscode.FileType.File)
            await this.onFile(uri, config)
        else if (uriType == vscode.FileType.Directory)
            await this.onFolder(uri, config)
        else
            showError('Selected item type is not supported');
    }
    private async onFile(uri: vscode.Uri, config: DbGeneratorConfig) {
        if (uri.fsPath.includes(config.appSettingFileName)) {
            const connectionString = await this.readConnectionString(uri) as Connection;
            await this.selectGenType(uri.path, connectionString, config)
        }
        else showError('Selected file needed to be appsettings.json file');
    }
    private async onFolder(uri: vscode.Uri, config: DbGeneratorConfig) {
        await vscode.workspace.fs.readDirectory(uri).then(async res => {
            if (res.some(x => x[0] === config.appSettingFileName && x[1] === vscode.FileType.File)) {
                const connectionString = await this.readConnectionString(vscode.Uri.joinPath(uri, config.appSettingFileName)) as Connection;
                await this.selectGenType(uri.path, connectionString, config)
            }
            else showError('Can not find appsettings.json file');
        });
    }
    private async selectGenType(path: string, connectionString: Connection, config: DbGeneratorConfig) {
        if (connectionString == undefined)
            return showMessage('Not pick connection string yet');
        const obj = Object.keys(GenType)
        const quickPickItems: vscode.QuickPickItem[] = [
            { label: obj[Object.values(GenType).indexOf(GenType.All)], detail: GenType.All },
            { label: obj[Object.values(GenType).indexOf(GenType.Specific)], detail: GenType.Specific }
        ];
        await pickSingleItem(quickPickItems, 'What type of generation do you want ?')
            .then(async res => {
                switch (res.detail) {
                    case GenType.All:
                        await this.callGenAll(path, connectionString, config)
                        break;
                    case GenType.Specific:
                        await this.callGenSpecific(path, connectionString, config)
                        break;
                }
            })
            .catch(error => {
                showMessage(error);
            })
    }
    private getConfiguration(): DbGeneratorConfig {
        const dbContextFolder = vscode.workspace.getConfiguration('dbgenerator').get("dbContextFolder") as string;
        const modelFolder = vscode.workspace.getConfiguration('dbgenerator').get("modelFolder") as string;
        const appSettingFileName = vscode.workspace.getConfiguration('dbgenerator').get("appSettingFileName") as string;
        return {
            dbContextFolder,
            modelFolder,
            appSettingFileName
        };
    }

    private async readConnectionString(uri: vscode.Uri) {
        const result = await vscode.workspace.fs.readFile(uri).then(async res => {
            const content = JSON.parse(res.toString()).ConnectionStrings;
            let connections: Connection[] = [];
            for (let keys in content) {
                const conn: Connection = { name: keys, connectionString: content[keys] };
                connections.push(conn);
            }
            const quickPickItems: vscode.QuickPickItem[] = connections.map(item => {
                return { label: item.name, detail: item.connectionString };
            });
            const pickedItem = await pickSingleItem(quickPickItems, 'Select connection string')
                .then(value => {
                    return connections.find(x => x.name === value.label);
                })
                .catch(error => {
                    showError(error);
                    return undefined;
                });
            return pickedItem;
        });
        return result;
    }
    private async callGenAll(path: string, connectionString: Connection, config: DbGeneratorConfig) {
        path = path.replace(`/${config.appSettingFileName}`,'')
        const command = `dotnet ef dbcontext scaffold "${connectionString.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --context DBContext --context-dir ${config.dbContextFolder} --output-dir ${config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
        await runCommand(path, command)
    }
    private async callGenSpecific(path: string, connectionString: Connection, config: DbGeneratorConfig) {
        const service = new SqlService
        const connectionOption = new ConnectionOption(connectionString)
        const tableNames = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
        }, async (progress) => {
            progress.report({
                message: `Loading tables from database`,
            });
            return await service.execute(connectionOption)
                .then(async result => {
                    const tableNames = result.map(x => x.TABLE_NAME)
                    return tableNames
                })
                .catch(error => {
                    showError(`${error.code} : ${error.message}`);
                })
        }) as string[];
        if (tableNames) {
            const selectedTables = await this.getPickedTables(tableNames) as string[];
            if (selectedTables) {
                const tableString = selectedTables.join(` --table `)
                const command = `dotnet ef dbcontext scaffold "${connectionString.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --table ${tableString} --context DBContext --context-dir ${config.dbContextFolder} --output-dir ${config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
                await runCommand(path, command)
            }
        }
    }
    private async getPickedTables(tables: string[]) {
        const quickPickItems: vscode.QuickPickItem[] = tables.map(item => {
            return { label: item };
        });
        const pickedItem = await pickManyItems(quickPickItems, 'Select tables')
            .then(value => {
                const result = value.map(x => x.label)
                return result;
            })
            .catch(error => {
                showMessage(error);
                return undefined;
            });
        return pickedItem;
    }
}

