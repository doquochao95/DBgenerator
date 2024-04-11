import * as vscode from 'vscode';
import * as pathLib from 'path';
import glob = require('glob');
import { Connection, DbGeneratorConfig, PackageDetail, Project } from '../common/interfaces';
import { pickManyItems, pickSingleItem, showError, showMessage } from '../helpers/dialog.helper';
import { GenType } from '../common/enums';
import { ConnectionOption, EFCoreDesign, SDCores } from '../common/constants';
import { findProjects, readFileContent, runCommand, saveFile } from '../helpers';
import { getPackages } from '../helpers/xml.helper';
import { execute } from '../helpers/sql.helper';
import { getIRepoFile, getRepoFile } from '../helpers/content.helper';

export class GeneratorController {
    constructor(private readonly config: DbGeneratorConfig) { }
    public async genDatabase(uri: vscode.Uri, workspacePath: readonly vscode.WorkspaceFolder[]) {
        const isChecked = await this.checkPackage(EFCoreDesign, uri, workspacePath)
        if (isChecked) {
            const uriType = (await vscode.workspace.fs.stat(uri)).type
            if (uriType == vscode.FileType.File)
                await this.onFile(uri)
            else if (uriType == vscode.FileType.Directory)
                await this.onFolder(uri)
            else
                showError('Selected item type is not supported');
        }
    }
    public async genRepository(uri: vscode.Uri, workspacePath: readonly vscode.WorkspaceFolder[]) {
        const isChecked = await this.checkPackage(SDCores, uri, workspacePath)
        if (isChecked) {
            const uriType = (await vscode.workspace.fs.stat(uri)).type
            if (uriType == vscode.FileType.File)
                await this.onFile(uri, true)
            else if (uriType == vscode.FileType.Directory)
                await this.onFolder(uri, true)
            else
                showError('Selected item type is not supported');
        }
    }
    private async onFile(uri: vscode.Uri, isGenRepo: boolean = false) {
        if (uri.fsPath.includes(this.config.appSettingFileName)) {
            const connectionString = await this.readConnectionString(uri) as Connection;
            if (connectionString !== undefined)
                isGenRepo ? await this.createRepo(pathLib.dirname(uri.fsPath), connectionString) : await this.selectGenType(pathLib.dirname(uri.fsPath), connectionString)
        }
        else
            showError('Selected file needed to be appsettings.json file');
    }
    private async onFolder(uri: vscode.Uri, isGenRepo: boolean = false) {
        await vscode.workspace.fs.readDirectory(uri).then(async res => {
            if (res.some(x => x[0] === this.config.appSettingFileName && x[1] === vscode.FileType.File)) {
                const connectionString = await this.readConnectionString(vscode.Uri.joinPath(uri, this.config.appSettingFileName)) as Connection;
                if (connectionString !== undefined)
                    isGenRepo ? await this.createRepo(uri.fsPath, connectionString) : await this.selectGenType(uri.fsPath, connectionString)
            }
            else
                showError('Can not find appsettings.json file');
        });
    }
    private async selectGenType(path: string, connectionString: Connection) {
        const obj = Object.keys(GenType)
        const quickPickItems: vscode.QuickPickItem[] = [
            { label: obj[Object.values(GenType).indexOf(GenType.All)], detail: GenType.All },
            { label: obj[Object.values(GenType).indexOf(GenType.Specific)], detail: GenType.Specific }
        ];
        await pickSingleItem(quickPickItems, 'What type of generation do you want ?')
            .then(async res => {
                switch (res.detail) {
                    case GenType.All:
                        await this.callGenAll(path, connectionString)
                        break;
                    case GenType.Specific:
                        await this.callGenSpecific(path, connectionString)
                        break;
                }
            })
            .catch(error => {
                showMessage(error);
            })
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
    private async callGenAll(path: string, connectionString: Connection) {
        const command = `dotnet ef dbcontext scaffold "${connectionString.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --context ${this.config.dbContextFileName} --context-dir ${this.config.dbContextFolder} --output-dir ${this.config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
        await runCommand(path, command)
    }
    private async callGenSpecific(path: string, connectionString: Connection) {
        const tableNames = await this.getTableNames(connectionString);
        if (tableNames) {
            const selectedTables = await this.getPickedTables(tableNames) as string[];
            if (selectedTables) {
                const tableString = selectedTables.join(` --table `)
                const command = `dotnet ef dbcontext scaffold "${connectionString.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --table ${tableString} --context ${this.config.dbContextFileName} --context-dir ${this.config.dbContextFolder} --output-dir ${this.config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
                await runCommand(path, command)
            }
        }
    }
    private async getTableNames(connectionString: Connection) {
        const connectionOption = new ConnectionOption(connectionString)
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
        }, async (progress) => {
            progress.report({
                message: `Loading tables from database`,
            });
            return await execute(connectionOption)
                .then(async result => {
                    const tableNames = result.map(x => x.TABLE_NAME)
                    return tableNames
                })
                .catch(error => {
                    showError(`${error.code} : ${error.message}`);
                    return undefined
                })
        }) as string[];
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
    private async checkPackage(name: string, uri: vscode.Uri, workspacePath: readonly vscode.WorkspaceFolder[]) {
        const project = await this.getProjectList(uri, workspacePath);
        if (project == undefined) {
            showError('Can not find .csproj C# project file');
            return false
        }
        if (!project.packages.some(x => x.packageName == name)) {
            showError(`Can not find ${name} package`);
            return false
        }
        return true
    }
    private async getProjectList(uri: vscode.Uri, workspacePath: readonly vscode.WorkspaceFolder[]) {
        let projectID = 1;
        let projectList: Project[] = [];
        const projectPathList = await findProjects(workspacePath)
        for (const pathIndex in projectPathList) {
            const projectPath = projectPathList[pathIndex];
            const originalData: string = readFileContent(projectPath);
            let projectName = pathLib.basename(projectPath);
            let packages: PackageDetail[] = getPackages(originalData, {
                id: projectID + 1,
                projectName: projectName,
                projectPath: projectPath,
                packages: [],
            });
            projectList.push({
                id: projectID++,
                projectName: projectName,
                projectPath: projectPath,
                packages: packages.map(pkg => {
                    return {
                        packageName: pkg.packageName,
                        packageVersion: pkg.packageVersion,
                        versionList: [pkg.packageVersion],
                        isUpdated: false,
                        newerVersion: 'Unknown',
                        sourceName: 'Unknown',
                        sourceId: null,
                    };
                }),
            });
        }
        const uriType = (await vscode.workspace.fs.stat(uri)).type
        let file = glob.sync(uri.fsPath)[0];
        const result = projectList.find(x =>
            pathLib.dirname(x.projectPath) === (uriType == vscode.FileType.File ? pathLib.dirname(file) : file)
        )
        return result
    }
    private async createRepo(path: string, connectionString: Connection) {
        const tableNames = await this.getTableNames(connectionString);
        const irepo = getIRepoFile(path, tableNames, this.config)
        const repo = getRepoFile(path, tableNames, this.config)
        await saveFile(irepo);
        await saveFile(repo);
    }
}

