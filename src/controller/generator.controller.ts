import * as vscode from 'vscode';
import * as pathLib from 'path';
import glob = require('glob');
import { Connection, DbGeneratorConfig, PackageDetail, Project } from '../common/interfaces';
import { confirm, pickManyItems, pickSingleItem, showError, showMessage } from '../helpers/dialog.helper';
import { GenType } from '../common/enums';
import { ConnectionOption, EFCoreDesign, SDCores } from '../common/constants';
import { execShell, findProjects, readFileContent, runCommand, saveFile } from '../helpers';
import { getPackages } from '../helpers/xml.helper';
import { execute } from '../helpers/sql.helper';
import { getIRepoFile, getRepoFile } from '../helpers/content.helper';

export class GeneratorController {

    _isAllowGenRepo: boolean
    _connectionString: Connection
    _uri: vscode.Uri

    constructor(private readonly config: DbGeneratorConfig, private workspacePath: readonly vscode.WorkspaceFolder[]) { }
    public async genDatabase(uri: vscode.Uri) {
        this._uri = uri
        const isChecked = await this.checkPackage(EFCoreDesign)
        if (isChecked) {
            const uriType = (await vscode.workspace.fs.stat(this._uri)).type
            if (uriType == vscode.FileType.File)
                await this.onFile()
            else if (uriType == vscode.FileType.Directory)
                await this.onFolder()
            else
                showError('Selected item type is not supported');
        }
    }
    public async genRepository(uri: vscode.Uri, getConnectionString: boolean = true) {
        this._uri = uri
        const isChecked = await this.checkPackage(SDCores)
        if (isChecked) {
            const uriType = (await vscode.workspace.fs.stat(uri)).type
            if (uriType == vscode.FileType.File)
                await this.onFile(true, getConnectionString)
            else if (uriType == vscode.FileType.Directory)
                await this.onFolder(true, getConnectionString)
            else
                showError('Selected item type is not supported');
        }
    }
    private async onFile(isGenRepo: boolean = false, getConnectionString: boolean = true) {
        if (this._uri.fsPath.includes(this.config.appSettingFileName)) {
            if (getConnectionString)
                this._connectionString = await this.readConnectionString(this._uri) as Connection;
            if (this._connectionString !== undefined)
                isGenRepo ? await this.createRepo(pathLib.dirname(this._uri.fsPath)) : await this.selectGenType(pathLib.dirname(this._uri.fsPath))
        }
        else
            showError('Selected file needed to be appsettings.json file');
    }
    private async onFolder(isGenRepo: boolean = false, getConnectionString: boolean = true) {
        await vscode.workspace.fs.readDirectory(this._uri).then(async res => {
            if (res.some(x => x[0] === this.config.appSettingFileName && x[1] === vscode.FileType.File)) {
                if (getConnectionString)
                    this._connectionString = await this.readConnectionString(vscode.Uri.joinPath(this._uri, this.config.appSettingFileName)) as Connection;
                if (this._connectionString !== undefined)
                    isGenRepo ? await this.createRepo(this._uri.fsPath) : await this.selectGenType(this._uri.fsPath)
            }
            else
                showError('Can not find appsettings.json file');
        });
    }
    private async selectGenType(path: string) {
        const obj = Object.keys(GenType)
        const quickPickItems: vscode.QuickPickItem[] = [
            { label: obj[Object.values(GenType).indexOf(GenType.All)], detail: GenType.All },
            { label: obj[Object.values(GenType).indexOf(GenType.Specific)], detail: GenType.Specific }
        ];
        const genType = await pickSingleItem(quickPickItems, 'What type of generation do you want ?')
        if (genType == undefined)
            return showError('Not pick item yet')
        this._isAllowGenRepo = await confirm('Auto generate repository after database generation ?')
        switch (genType.detail) {
            case GenType.All:
                await this.callGenAll(path, this._connectionString)
                break;
            case GenType.Specific:
                await this.callGenSpecific(path, this._connectionString)
                break;
        }
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
            if (pickedItem == undefined) {
                showError('Not pick item yet');
                return undefined;
            }
            return connections.find(x => x.name === pickedItem.label);
        });
        return result;
    }
    private async callGenAll(path: string, connectionString: Connection) {
        const command = `dotnet ef dbcontext scaffold "${connectionString.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --context ${this.config.dbContextFileName} --context-dir ${this.config.dbContextFolder} --output-dir ${this.config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
        const commandResult = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
        }, async (progress) => {
            progress.report({
                message: `Building...`,
            });
            return await runCommand(path, command)
        })
        if (commandResult?.indexOf('Build succeeded') != -1)
            this._isAllowGenRepo ? await this.genRepository(this._uri, false) : showMessage('Build succeeded')
        else
            showError('Build failed')
    }
    private async callGenSpecific(path: string, connectionString: Connection) {
        const tableNames = await this.getTableNames(connectionString);
        if (tableNames) {
            const selectedTables = await this.getPickedTables(tableNames) as string[];
            if (selectedTables) {
                const tableString = selectedTables.join(` --table `)
                const command = `dotnet ef dbcontext scaffold "${connectionString.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --table ${tableString} --context ${this.config.dbContextFileName} --context-dir ${this.config.dbContextFolder} --output-dir ${this.config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
                const commandResult = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                }, async (progress) => {
                    progress.report({
                        message: `Building...`,
                    });
                    return await runCommand(path, command)
                })
                if (commandResult?.indexOf('Build succeeded') != -1)
                    this._isAllowGenRepo ? await this.genRepository(this._uri, false) : showMessage('Build succeeded')
                else
                    showError('Build failed')
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
        if (pickedItem == undefined) {
            showError('Not pick item yet');
            return undefined;
        }
        const result = pickedItem.map(x => x.label)
        return result;
    }
    private async checkPackage(name: string) {
        const project = await this.getProjectList();
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
    private async getProjectList() {
        let projectID = 1;
        let projectList: Project[] = [];
        const projectPathList = await findProjects(this.workspacePath)
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
        const uriType = (await vscode.workspace.fs.stat(this._uri)).type
        let file = glob.sync(this._uri.fsPath)[0];
        const result = projectList.find(x =>
            pathLib.dirname(x.projectPath) === (uriType == vscode.FileType.File ? pathLib.dirname(file) : file)
        )
        return result
    }
    private async createRepo(path: string) {
        const tableNames = await this.getTableNames(this._connectionString);
        const repofile = [getIRepoFile(path, tableNames, this.config), getRepoFile(path, tableNames, this.config)]
        repofile.forEach(async file => { await saveFile(file); })
    }
}

