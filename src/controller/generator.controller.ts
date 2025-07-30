import * as vscode from 'vscode';
import * as pathLib from 'path';
import glob = require('glob');
import { ColumnInfoModel, CommonModel, Connection, DbGeneratorConfig, PackageDetail, Project, QuickPickModel, StoreProcedureInfoModel, TableModel, VariableInfoModel } from '../common/interfaces';
import { confirm, pickManyItems, pickSingleItem, showError, showMessage } from '../helpers/dialog.helper';
import { GenType, Mode, SqlOtherDataTypes, SQLSchemaType, SqlStringDataTypes } from '../common/enums';
import { ConnectionOption, EFCoreDesign, SDCores } from '../common/constants';
import { deleteFile, exists, findProjects, readFileContent, runCommand, saveFile } from '../helpers';
import { getPackages } from '../helpers/xml.helper';
import { queryStoredProcedures, queryStoredProceduresInfo, queryTables, queryViews } from '../helpers/sql.helper';
import { getUpdateStoreProcedureDbContextFile, getIRepoFile, getStoredProcedureModelFile, getRepoFile, getUpdateDbContextFile, geUpdateRepoFile } from '../helpers/content.helper';
import { FileType, ProgressLocation, QuickPickItem, QuickPickItemKind, Uri, window, workspace, WorkspaceFolder } from 'vscode';

export class GeneratorController {
    _connection: Connection
    _uri: Uri
    _path: string
    _genTypes: QuickPickModel[]
    _repoAction: QuickPickModel

    constructor(private readonly config: DbGeneratorConfig, private workspacePath: readonly WorkspaceFolder[]) { }
    //#region Main function
    public async genDatabase(uri: Uri, mode: string) {
        this._uri = uri
        this._connection = await this.readConnectionString()
        if (!this._connection) return
        this._genTypes = await this.selectGenType()
        if (!this._genTypes) return
        mode == Mode.Generate ? await this.callGen() : await this.callRegen()
    }
    //#endregion

    //#region ConnectionString
    private async readConnectionString() {
        const uriType = (await workspace.fs.stat(this._uri)).type
        if (uriType == FileType.File) {
            this._path = pathLib.dirname(this._uri.fsPath)
            if (this._uri.fsPath.includes(this.config.appSettingFileName))
                return await this.getSelectConnection(this._uri)
            showError('Selected file needed to be appsettings.json file');
            return undefined
        }
        else if (uriType == FileType.Directory) {
            this._path = this._uri.fsPath
            const file = await workspace.fs.readDirectory(this._uri)
            if (file.some(x => x[0] === this.config.appSettingFileName && x[1] === FileType.File))
                return await this.getSelectConnection(Uri.joinPath(this._uri, this.config.appSettingFileName))
            showError('Can not find appsettings.json file');
            return undefined
        }
        else
            showError('Selected item type is not supported');
        return undefined
    }
    private async getSelectConnection(uri: Uri) {
        const result = await workspace.fs.readFile(uri).then(async res => {
            const content = JSON.parse(res.toString()).ConnectionStrings;
            let connections: Connection[] = [];
            for (let keys in content) {
                const conn: Connection = { name: keys, connectionString: content[keys] };
                connections.push(conn);
            }
            const pickedItem = await this.selectConnectionString(connections)
            if (pickedItem) {
                const result = connections.find(x => x.name === pickedItem.id);
                return result;
            }
            showError('Not pick item yet');
            return undefined;
        });
        return result;
    }
    //#endregion

    //#region Generate
    private async callGen() {
        await window.withProgress(
            { location: ProgressLocation.Notification },
            async (progress) => {
                progress.report({ message: `Initialing...` });
                if (this._genTypes.some(x => x.id == GenType.Database || x.id == GenType.Repository)) {
                    let listData: QuickPickModel[] = []
                    progress.report({ message: `Loading tables/views from database...` });
                    const tables = await this.getTableList();
                    const views = await this.getViewList();
                    listData = [...tables, ...views]
                    if (listData.length == 0)
                        return showError('Empty database')
                    progress.report({ message: `Waiting for tables/views picking...` });
                    const selectedTables = await this.getPickedTables(listData, 'Select tables/views') as QuickPickModel[];
                    if (selectedTables && selectedTables.length > 0) {
                        if (this._genTypes.some(x => x.id == GenType.Database)) {
                            progress.report({ message: `Building database...` });
                            if (!await this.scaffold(selectedTables.map(x => x.id))) return
                        }
                        if (this._genTypes.some(x => x.id == GenType.Repository)) {
                            progress.report({ message: `Creating repository files...` });
                            if (!await this.createRepo(selectedTables.map(x => x.id))) return
                        }
                    }
                }
                if (this._genTypes.some(x => x.id == GenType.Procedure)) {
                    setTimeout(async () => {
                        progress.report({ message: `Loading stored procedure from database...` });
                        const procedures = await this.getStoredProcedureList();
                        if (procedures.length == 0)
                            return showError('There are no stored procedures in database')
                        else {
                            progress.report({ message: `Waiting for stored procedures picking...` });
                            const selectedProcedures = await this.getPickedTables(procedures, 'Select stored procedure') as QuickPickModel[];
                            if (selectedProcedures && selectedProcedures.length > 0) {
                                progress.report({ message: `Generatting stored procedures...` });
                                if (!await this.genStoreProcedure(selectedProcedures)) return
                            }
                        }
                    }, 300)
                }
            })
    }
    //#endregion

    //#region Regenerate
    private async callRegen() {
        await window.withProgress(
            { location: ProgressLocation.Notification },
            async (progress) => {
                progress.report({ message: `Initialing...` });
                if (this._genTypes.some(x => x.id == GenType.Database || x.id == GenType.Repository)) {
                    let listData: QuickPickModel[] = []
                    progress.report({ message: `Loading tables/views from database...` });
                    const tables = await this.getTableList();
                    const views = await this.getViewList();
                    listData = [...tables, ...views]
                    if (listData.length == 0)
                        return showError('Empty database')
                    progress.report({ message: `Waiting for tables/views picking...` });
                    const selectedTables = await this.getPickedTables(listData, 'Select tables/views') as QuickPickModel[];
                    if (selectedTables && selectedTables.length > 0) {
                        if (this._genTypes.some(x => x.id == GenType.Database)) {
                            progress.report({ message: `Building database...` });
                            if (!await this.scaffoldTemp(selectedTables.map(x => x.id))) return
                            progress.report({ message: `Regenerating ${this.config.dbContextFileName} ...` });
                            if (!await this.regenDbContext()) return
                        }
                        if (this._genTypes.some(x => x.id == GenType.Repository)) {
                            progress.report({ message: `Creating repository files...` });
                            if (!await this.updateRepo(selectedTables.map(x => x.id))) return
                        }
                    }
                }
                if (this._genTypes.some(x => x.id == GenType.Procedure)) {
                    setTimeout(async () => {
                        progress.report({ message: `Loading stored procedure from database...` });
                        const procedures = await this.getStoredProcedureList();
                        if (procedures.length == 0)
                            return showError('There are no stored procedures in database')
                        else {
                            progress.report({ message: `Waiting for stored procedures picking...` });
                            const selectedProcedures = await this.getPickedTables(procedures, 'Select stored procedure') as QuickPickModel[];
                            if (selectedProcedures && selectedProcedures.length > 0) {
                                progress.report({ message: `Generatting stored procedures...` });
                                if (!await this.genStoreProcedure(selectedProcedures)) return
                            }
                        }
                    }, 300)
                }
            })
    }
    //#endregion

    //#region SQL object
    private async getTableList() {
        const connectionOption = new ConnectionOption(this._connection)
        let result: QuickPickModel[] = []
        const tables: QuickPickModel[] = await queryTables(connectionOption)
            .then(async result => result.map(item => {
                return <QuickPickModel>{
                    id: item.NAME,
                    item: <QuickPickItem>{ label: item.NAME }
                }
            }))
            .catch(error => {
                showError(`${error.code} : ${error.message}`);
                return []
            })
        if (tables.length > 0) {
            result.push(<QuickPickModel>{ item: { label: SQLSchemaType.TABLE, kind: QuickPickItemKind.Separator } })
            result.push(...tables)
        }
        return result
    }
    private async getViewList() {
        const connectionOption = new ConnectionOption(this._connection)
        let result: QuickPickModel[] = []
        const views: QuickPickModel[] = await queryViews(connectionOption)
            .then(async result => result.map(item => {
                return <QuickPickModel>{
                    id: item.NAME,
                    item: <QuickPickItem>{ label: item.NAME }
                }
            }))
            .catch(error => {
                showError(`${error.code} : ${error.message}`);
                return []
            })
        if (views.length > 0) {
            result.push(<QuickPickModel>{ item: { label: SQLSchemaType.VIEW, kind: QuickPickItemKind.Separator } })
            result.push(...views)
        }
        return result
    }
    private async getStoredProcedureList() {
        const connectionOption = new ConnectionOption(this._connection)
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
                        item: <QuickPickItem>{
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
            result.push(<QuickPickModel>{ item: { label: SQLSchemaType.PROCEDURE, kind: QuickPickItemKind.Separator } })
            result.push(...procedures)
        }
        return result
    }
    //#endregion

    //#region File
    private async scaffoldTemp(selectedTables: string[]) {
        if (!await this.checkPackage(EFCoreDesign))
            return false
        const tableString = selectedTables.join(` --table `)
        const command = `dotnet ef dbcontext scaffold "${this._connection.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --table ${tableString} --context ${this.config.dbContextFileName}_temp --context-dir ${this.config.dbContextFolder} --output-dir ${this.config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
        await runCommand(this._path, command)
        return true
    }
    private async scaffold(selectedTables: string[]) {
        if (!await this.checkPackage(EFCoreDesign))
            return false
        const tableString = selectedTables.join(` --table `)
        const command = `dotnet ef dbcontext scaffold "${this._connection.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --table ${tableString} --context ${this.config.dbContextFileName} --context-dir ${this.config.dbContextFolder} --output-dir ${this.config.modelFolder} --data-annotations --use-database-names --no-onconfiguring --no-pluralize  --force`
        await runCommand(this._path, command)
    }
    private async createRepo(selectedTables: string[]) {
        if (!await this.checkPackage(SDCores))
            return false
        const repofile = [getIRepoFile(this._path, selectedTables, this.config), getRepoFile(this._path, selectedTables, this.config)]
        repofile.forEach(async file => { await saveFile(file); })
        showMessage('Repository files created successfully');
        return true
    }
    private async updateRepo(selectedTables: string[]) {
        const folder: string = this.config.repoFolder
        const repoName: string = `${this.config.repoFileName}.cs`;
        const irepoName: string = `I${this.config.repoFileName}.cs`;
        if (!await exists(`${this._path}\\${folder}\\${repoName}`)) {
            showError(`File ${repoName} does not exist, use generate instead`);
            return false
        }
        if (!await exists(`${this._path}\\${folder}\\${irepoName}`)) {
            showError(`File ${irepoName} does not exist, use generate instead`);
            return false
        }
        const repofile = geUpdateRepoFile(this._path, selectedTables, this.config)
        repofile.forEach(async file => { await saveFile(file); })
        showMessage('Repository files created successfully');
        return true
    }
    private async genStoreProcedure(selectedProcedures: QuickPickModel[]) {
        const folder: string = this.config.dbContextFolder
        const filename: string = `${this.config.dbContextFileName}.cs`;
        if (!await exists(`${this._path}\\${folder}\\${filename}`)) {
            showError(`File ${filename} does not exist, please to generate database again`);
            return false
        }
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
        storeList.forEach(async store => {
            const modelContent = getStoredProcedureModelFile(this._path, store, this.config)
            await saveFile(modelContent);
        })
        const dbContextContent = getUpdateStoreProcedureDbContextFile(this._path, storeList, this.config)
        await saveFile(dbContextContent);
        showMessage('Stored procedures generated successfully');
        return true
    }
    private async regenDbContext() {
        const folder: string = this.config.dbContextFolder
        const filename: string = `${this.config.dbContextFileName}.cs`;
        const filename_Temp: string = `${this.config.dbContextFileName}_temp.cs`;
        if (!await exists(`${this._path}\\${folder}\\${filename}`)) {
            showError(`File ${filename} does not exist, use generate instead`);
            return false
        }
        const dbContextContent = getUpdateDbContextFile(this._path, this.config)
        if (dbContextContent == null) {
            showError(`File ${filename} is not in right format, please check or use generate instead`);
            return false
        }
        await saveFile(dbContextContent);
        await deleteFile(`${this._path}\\${folder}\\${filename_Temp}`);
        return true
    }
    //#endregion

    //#region Check Package
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
        const uriType = (await workspace.fs.stat(this._uri)).type
        let file = glob.sync(this._uri.fsPath)[0];
        const result = projectList.find(x =>
            pathLib.dirname(x.projectPath) === (uriType == FileType.File ? pathLib.dirname(file) : file)
        )
        return result
    }
    //#endregion

    //#region Selection
    private async selectGenType() {
        const obj = Object.keys(GenType)
        const quickPickItems: QuickPickModel[] = [
            <QuickPickModel>{
                id: GenType.Database,
                item: <QuickPickItem>{
                    label: obj[Object.values(GenType).indexOf(GenType.Database)],
                    description: GenType.Database,
                }
            },
            <QuickPickModel>{
                id: GenType.Procedure,
                item: <QuickPickItem>{
                    label: obj[Object.values(GenType).indexOf(GenType.Procedure)],
                    description: GenType.Procedure,
                }
            },
            <QuickPickModel>{
                id: GenType.Repository,
                item: <QuickPickItem>{
                    label: obj[Object.values(GenType).indexOf(GenType.Repository)],
                    description: GenType.Repository,
                }
            }
        ];
        const picked = await pickManyItems(quickPickItems, 'What type of generation do you want ?')
        if (!picked || picked.length == 0)
            showError('Not pick item yet')
        return picked
    }
    
    private async selectConnectionString(connections: Connection[]) {
        const quickPickItems: QuickPickModel[] = connections.map(item =>
            <QuickPickModel>{
                id: item.name,
                item: <QuickPickItem>{
                    label: item.name,
                    detail: item.connectionString,
                }
            }
        );
        const picked = await pickSingleItem(quickPickItems, 'Select connection string')
        if (!picked)
            showError('Not pick item yet')
        return picked
    }

    private async getPickedTables(tables: QuickPickModel[], placeHolder: string) {
        const pickedItem = await pickManyItems(tables, placeHolder)
        if (!pickedItem || pickedItem.length == 0)
            showError('Not pick item yet');
        return pickedItem;
    }
    //#endregion
}

