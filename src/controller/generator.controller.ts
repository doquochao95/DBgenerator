import * as vscode from 'vscode';
import * as pathLib from 'path';
import glob = require('glob');
import { ColumnInfoModel, CommonModel, Connection, DbGeneratorConfig, PackageDetail, Project, QuickPickModel, StoreProcedureInfoModel, TableModel, VariableInfoModel } from '../common/interfaces';
import { confirm, pickManyItems, pickSingleItem, showError, showMessage } from '../helpers/dialog.helper';
import { GenType, SqlOtherDataTypes, SQLSchemaType, SqlStringDataTypes } from '../common/enums';
import { ConnectionOption, EFCoreDesign, SDCores } from '../common/constants';
import { execShell, findProjects, readFileContent, runCommand, saveFile } from '../helpers';
import { getPackages } from '../helpers/xml.helper';
import { queryStoredProcedures, queryStoredProceduresInfo, queryTables, queryViews } from '../helpers/sql.helper';
import { getDbContextFile, getIRepoFile, getModelFile, getRepoFile } from '../helpers/content.helper';

export class GeneratorController {

    _isAllowGenModel: boolean
    _isAllowGenRepo: boolean
    _connection: Connection
    _uri: vscode.Uri
    _path: string

    constructor(private readonly config: DbGeneratorConfig, private workspacePath: readonly vscode.WorkspaceFolder[]) { }
    public async genDatabase(uri: vscode.Uri, isGenModel: boolean, isGenRepo: boolean) {
        this._uri = uri
        this._isAllowGenModel = isGenModel
        this._isAllowGenRepo = isGenRepo
        await this.readConnectionString()
        if (this._connection == undefined)
            return showError('Missing Connection String')
        const genType = await this.selectGenType()
        if (genType == undefined)
            return showError('Not pick item yet')
        if (!this._isAllowGenRepo)
            this._isAllowGenRepo = await confirm('Auto generate repository after database generation ?')
        await this.callGenTable(genType.detail)
    }
    private async selectGenType() {
        const obj = Object.keys(GenType)
        const quickPickItems: vscode.QuickPickItem[] = [
            { label: obj[Object.values(GenType).indexOf(GenType.All)], detail: GenType.All },
            { label: obj[Object.values(GenType).indexOf(GenType.Specific)], detail: GenType.Specific }
        ];
        const genType = await pickSingleItem(quickPickItems, 'What type of generation do you want ?')
        return genType
    }
    private async readConnectionString() {
        const uriType = (await vscode.workspace.fs.stat(this._uri)).type
        if (uriType == vscode.FileType.File) {
            this._path = pathLib.dirname(this._uri.fsPath)
            this._uri.fsPath.includes(this.config.appSettingFileName)
                ? this._connection = await this.getConnectionFormat(this._uri) as Connection
                : showError('Selected file needed to be appsettings.json file');
        }
        else if (uriType == vscode.FileType.Directory) {
            this._path = this._uri.fsPath
            await vscode.workspace.fs.readDirectory(this._uri).then(async res => {
                res.some(x => x[0] === this.config.appSettingFileName && x[1] === vscode.FileType.File)
                    ? this._connection = await this.getConnectionFormat(vscode.Uri.joinPath(this._uri, this.config.appSettingFileName)) as Connection
                    : showError('Can not find appsettings.json file');
            });
        }
        else
            showError('Selected item type is not supported');

    }
    private async getConnectionFormat(uri: vscode.Uri) {
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
    private async callGenTable(genType: string) {
        const tables = await this.getTableList();
        const views = await this.getViewList();
        if (tables.length == 0 && views.length == 0)
            return showError('Empty database')
        const selectedTables = genType == GenType.All
            ? [...tables.filter(x => x.id), ...views.filter(x => x.id)]
            : await this.getPickedTables([...tables, ...views], 'Select tables/views') as QuickPickModel[];
        if (selectedTables.length == 0)
            return showError('There is nothing to generate')
        await this.createModel(selectedTables.map(x => x.id))
        await this.createRepo(selectedTables.map(x => x.id))
        setTimeout(async () => {
            const procedures = await this.getStoredProcedureList();
            if (procedures.length > 0 && await confirm('Continue creating models related to Stored Procedures ?')) {
                const selectedProcedures = await this.getPickedTables(procedures, 'Select stored procedure') as QuickPickModel[];
                await this.genStoreProcedure(selectedProcedures)
            }
        }, 300)
    }
    private async getTableList() {
        const connectionOption = new ConnectionOption(this._connection)
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification },
            async (progress) => {
                progress.report({ message: `Loading tables from database` });
                let result: QuickPickModel[] = []
                const tables: QuickPickModel[] = await queryTables(connectionOption)
                    .then(async result => result.map(item => {
                        return <QuickPickModel>{
                            id: item.NAME,
                            item: <vscode.QuickPickItem>{ label: item.NAME }
                        }
                    }))
                    .catch(error => {
                        showError(`${error.code} : ${error.message}`);
                        return []
                    })
                if (tables.length > 0) {
                    result.push(<QuickPickModel>{ item: { label: SQLSchemaType.TABLE, kind: vscode.QuickPickItemKind.Separator } })
                    result.push(...tables)
                }
                return result
            }) as QuickPickModel[];
    }
    private async getViewList() {
        const connectionOption = new ConnectionOption(this._connection)
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification },
            async (progress) => {
                progress.report({ message: `Loading views from database` });
                let result: QuickPickModel[] = []
                const views: QuickPickModel[] = await queryViews(connectionOption)
                    .then(async result => result.map(item => {
                        return <QuickPickModel>{
                            id: item.NAME,
                            item: <vscode.QuickPickItem>{ label: item.NAME }
                        }
                    }))
                    .catch(error => {
                        showError(`${error.code} : ${error.message}`);
                        return []
                    })
                if (views.length > 0) {
                    result.push(<QuickPickModel>{ item: { label: SQLSchemaType.VIEW, kind: vscode.QuickPickItemKind.Separator } })
                    result.push(...views)
                }
                return result
            }) as QuickPickModel[];
    }
    private async getStoredProcedureList() {
        const connectionOption = new ConnectionOption(this._connection)
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification },
            async (progress) => {
                progress.report({ message: `Loading stored procedure from database` });
                let result: QuickPickModel[] = []

                const procedures: QuickPickModel[] = await queryStoredProcedures(connectionOption)
                    .then(async result => {
                        return await Promise.all(result.map(async (item): Promise<QuickPickModel> => {
                            const info: ColumnInfoModel[] = await queryStoredProceduresInfo(connectionOption, item.NAME)
                                .then(result => {
                                    return result.filter(x => x.NAME && x.TYPE)
                                })
                                .catch(error => {
                                    showError(`${error.code} : ${error.message}`);
                                    return []
                                })
                            const distinctArray = Array.from(new Set(info.map(x => JSON.stringify(x)))).map(x => JSON.parse(x));
                            return <QuickPickModel>{
                                id: item.NAME,
                                info: distinctArray,
                                item: <vscode.QuickPickItem>{
                                    label: item.NAME,
                                    description: info.length == 0 ? 'not supported' : '',
                                }
                            }
                        }))
                    })
                    .catch(error => {
                        showError(`${error.code} : ${error.message}`);
                        return []
                    })
                if (procedures.length > 0) {
                    result.push(<QuickPickModel>{ item: { label: SQLSchemaType.PROCEDURE, kind: vscode.QuickPickItemKind.Separator } })
                    result.push(...procedures)
                }
                return result
            }) as QuickPickModel[];
    }
    private async getPickedTables(tables: QuickPickModel[], placeHolder: string) {
        const pickedItem = await pickManyItems(tables, placeHolder)
        if (pickedItem == undefined) {
            showError('Not pick item yet');
            return undefined;
        }
        return pickedItem;
    }
    private async createModel(selectedTables: string[]) {
        if (this._isAllowGenModel && await this.checkPackage(EFCoreDesign)) {
            const tableString = selectedTables.join(` --table `)
            const command = `dotnet ef dbcontext scaffold "${this._connection.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --table ${tableString} --context ${this.config.dbContextFileName} --context-dir ${this.config.dbContextFolder} --output-dir ${this.config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification },
                async (progress) => {
                    progress.report({ message: `Building...` });
                    return await runCommand(this._path, command)
                })
            showMessage('Successfully generate database !');
        }
    }
    private async createRepo(selectedTables: string[]) {
        if (this._isAllowGenRepo && await this.checkPackage(SDCores)) {
            const repofile = [getIRepoFile(this._path, selectedTables, this.config), getRepoFile(this._path, selectedTables, this.config)]
            repofile.forEach(async file => { await saveFile(file); })
            showMessage('Successfully generate repository files !');
        }
    }
    private async genStoreProcedure(selectedProcedures: QuickPickModel[]) {
        const regexp = /([A-Za-z0-9]+)(\((.*)\)|(.*))/
        const storeList: StoreProcedureInfoModel[] = selectedProcedures.map(x => {
            return <StoreProcedureInfoModel>{
                storeName: x.id,
                variables: x.info.map(x => {
                    const typeStr = regexp.exec(x.TYPE)[1]
                    return <VariableInfoModel>{
                        columnName: x.NAME,
                        variableName: x.NAME?.trim().replace(/[^\p{L}\d\s]+/gu, '').replace(/\s+/g, "_"),
                        sqlType: x.TYPE,
                        dataType: SqlStringDataTypes[typeStr] ? SqlStringDataTypes[typeStr] as string : SqlOtherDataTypes[typeStr] as string + "?"
                    }
                })
            }
        })
        await this.updateStoreProcedure(storeList)
    }
    private async updateStoreProcedure(storeList: StoreProcedureInfoModel[]) {
        storeList.forEach(async store => {
            const modelContent = getModelFile(this._path, store, this.config)
            await saveFile(modelContent);
        })
        const dbContextContent = getDbContextFile(this._path, storeList, this.config)
        await saveFile(dbContextContent);
        showMessage('Successfully generate stored procedure !');
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
}

