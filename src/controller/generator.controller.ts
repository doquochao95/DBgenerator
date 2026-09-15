import * as vscode from 'vscode';
import * as pathLib from 'path';
import glob = require('glob');
import { ColumnInfoModel, CommonModel, Connection, DbGeneratorConfig, FileContent, PackageDetail, ParameterInfoModel, Project, QuickPickModel, StoreProcedureInfoModel, TableModel, VariableInfoModel } from '../common/interfaces';
import { pickManyItems, pickSingleItem, showError, showMessage, confirm } from '../helpers/dialog.helper';
import { GenType, Mode, SqlOtherDataTypes, SQLSchemaType, SqlStringDataTypes, ArchitectureType } from '../common/enums';
import { ConnectionOption, EFCoreDesign, SDCores } from '../common/constants';
import { exists, findProjects, readFileContent, runCommand, saveFile, createTempDir, copyDirSync, removeDirSync, writeFileContent } from '../helpers';
import { getPackages } from '../helpers/xml.helper';
import { queryStoredProcedures, queryStoredProceduresInfo, queryStoredProceduresParameters, queryStoredProcedureDefinition, queryTables, queryViews } from '../helpers/sql.helper';
import { getUpdateStoreProcedureDbContextFile, getIRepoFile, getStoredProcedureModelFile, getRepoFile, getUpdateDbContextFile, geUpdateRepoFile, getCleanArchitectureEntityFile, getCleanArchitectureConfigurationsSnippet, transformEntityForCleanArch, transformEntityForNTier, readAllCsFiles, generateCleanArchDbContext, extractEntityBlocks } from '../helpers/content.helper';
import { FileType, Progress, ProgressLocation, QuickPickItem, QuickPickItemKind, Uri, window, workspace, WorkspaceFolder } from 'vscode';

export class GeneratorController {
    _connection: Connection
    _uri: Uri
    _path: string
    _genTypes: QuickPickModel[]
    _repoAction: QuickPickModel
    _architectureType: ArchitectureType

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
                progress.report({ message: `Initializing...` });
                if (this._genTypes.some(x => x.id == GenType.Database || x.id == GenType.Procedure)) {
                    progress.report({ message: `Selecting architecture type...` });
                    const archType = await this.selectArchitectureType()
                    if (!archType) return
                    this._architectureType = archType
                }
                if (this._genTypes.some(x => x.id == GenType.Database || x.id == GenType.Repository)) {
                    let listData: QuickPickModel[] = []
                    progress.report({ message: `Loading tables/views from database...` });
                    const tables = await this.getTableList();
                    const views = await this.getViewList();
                    listData = [...tables, ...views]
                    if (listData.length == 0)
                        return showError('Empty database')
                    progress.report({ message: `Waiting for tables/views selection...` });
                    const selectedTables = await this.getPickedTables(listData, 'Select tables/views') as QuickPickModel[];
                    if (selectedTables && selectedTables.length > 0) {
                        const selectedViewNames = selectedTables.filter(x => views.some(v => v.id === x.id)).map(x => x.id)
                        if (this._genTypes.some(x => x.id == GenType.Database)) {
                            progress.report({ message: `Building database...` });
                            if (!await this.generate(selectedTables.map(x => x.id), selectedViewNames)) return
                        }
                        if (this._genTypes.some(x => x.id == GenType.Repository)) {
                            progress.report({ message: `Creating repository files...` });
                            if (!await this.createRepo(selectedTables.map(x => x.id))) return
                        }
                    }
                }
                if (this._genTypes.some(x => x.id == GenType.Procedure)) {
                    progress.report({ message: `Loading stored procedures from database...` });
                    const procedures = await this.getStoredProcedureList();
                    if (procedures.length == 0)
                        return showError('There are no stored procedures in database')
                    else {
                        progress.report({ message: `Found ${procedures.length} stored procedures. Waiting for selection...` });
                        const selectedProcedures = await this.getPickedTables(procedures, 'Select stored procedures') as QuickPickModel[];
                        if (selectedProcedures && selectedProcedures.length > 0) {
                            progress.report({ message: `Loading details for ${selectedProcedures.length} selected stored procedures...` });
                            const enriched = await this.enrichSelectedProcedures(selectedProcedures, progress);
                            progress.report({ message: `Generating ${enriched.length} stored procedures...` });
                            if (!await this.genStoreProcedure(enriched, progress)) return
                        }
                    }
                }
            })
    }
    //#endregion

    //#region Regenerate
    private async callRegen() {
        await window.withProgress(
            { location: ProgressLocation.Notification },
            async (progress) => {
                progress.report({ message: `Initializing...` });
                if (this._genTypes.some(x => x.id == GenType.Database || x.id == GenType.Procedure)) {
                    progress.report({ message: `Selecting architecture type...` });
                    const archType = await this.selectArchitectureType()
                    if (!archType) return
                    this._architectureType = archType
                }
                if (this._genTypes.some(x => x.id == GenType.Database || x.id == GenType.Repository)) {
                    let listData: QuickPickModel[] = []
                    progress.report({ message: `Loading tables/views from database...` });
                    const tables = await this.getTableList();
                    const views = await this.getViewList();
                    listData = [...tables, ...views]
                    if (listData.length == 0)
                        return showError('Empty database')
                    progress.report({ message: `Waiting for tables/views selection...` });
                    const selectedTables = await this.getPickedTables(listData, 'Select tables/views') as QuickPickModel[];
                    if (selectedTables && selectedTables.length > 0) {
                        const selectedViewNames = selectedTables.filter(x => views.some(v => v.id === x.id)).map(x => x.id)
                        if (this._genTypes.some(x => x.id == GenType.Database)) {
                            progress.report({ message: `Building database...` });
                            const tempDir = await this.regenerate(selectedTables.map(x => x.id), selectedViewNames)
                            progress.report({ message: `Regenerating ${this.config.dbContextFileName} ...` });
                            if (!await this.regenDbContext(selectedTables.map(x => x.id), selectedViewNames, tempDir ?? undefined)) return
                            if (tempDir) removeDirSync(tempDir)
                        }
                        if (this._genTypes.some(x => x.id == GenType.Repository)) {
                            progress.report({ message: `Creating repository files...` });
                            if (!await this.updateRepo(selectedTables.map(x => x.id))) return
                        }
                    }
                }
                if (this._genTypes.some(x => x.id == GenType.Procedure)) {
                    progress.report({ message: `Loading stored procedures from database...` });
                    const procedures = await this.getStoredProcedureList();
                    if (procedures.length == 0)
                        return showError('There are no stored procedures in database')
                    else {
                        progress.report({ message: `Found ${procedures.length} stored procedures. Waiting for selection...` });
                        const selectedProcedures = await this.getPickedTables(procedures, 'Select stored procedures') as QuickPickModel[];
                        if (selectedProcedures && selectedProcedures.length > 0) {
                            progress.report({ message: `Loading details for ${selectedProcedures.length} selected stored procedures...` });
                            const enriched = await this.enrichSelectedProcedures(selectedProcedures, progress);
                            progress.report({ message: `Generating ${enriched.length} stored procedures...` });
                            if (!await this.genStoreProcedure(enriched, progress)) return
                        }
                    }
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
                    item: <QuickPickItem>{ label: `${item.NAME}`, description: SQLSchemaType.TABLE }
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
                    item: <QuickPickItem>{ label: `${item.NAME}`, description: SQLSchemaType.VIEW }
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
            .then(res => res.map(item => <QuickPickModel>{
                id: item.NAME,
                info: [],
                params: [],
                item: <QuickPickItem>{ label: `${item.NAME}`, description: SQLSchemaType.PROCEDURE }
            }))
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
    private async enrichSelectedProcedures(selected: QuickPickModel[], progress: Progress<{ message?: string }>): Promise<QuickPickModel[]> {
        const connectionOption = new ConnectionOption(this._connection)
        for (const sp of selected) {
            progress.report({ message: `Loading params for ${sp.id}...` })
            sp.params = await queryStoredProceduresParameters(connectionOption, sp.id)
                .catch(() => [])
        }

        const dmlProcedures: string[] = []
        for (const sp of selected) {
            progress.report({ message: `Checking DML for ${sp.id}...` })
            try {
                const definition = await queryStoredProcedureDefinition(connectionOption, sp.id)
                const dmlPattern = /\b(INSERT|UPDATE|DELETE|MERGE)\b/i
                if (definition && dmlPattern.test(definition)) {
                    dmlProcedures.push(sp.id)
                }
            } catch (e) { }
        }
        if (dmlProcedures.length > 0) {
            const confirmed = await confirm(
                `${dmlProcedures.join(', ')} contains DML. Execute anyway?`
            )
            if (!confirmed) {
                return []
            }
        }

        for (const sp of selected) {
            progress.report({ message: `Discovering columns for ${sp.id}...` })
            const params = (sp.params || []).map(p => ({ name: p.name, typeName: p.typeName }))
            const info: ColumnInfoModel[] = await queryStoredProceduresInfo(connectionOption, sp.id, params)
                .then(result => result.filter(x => x.NAME && x.TYPE))
                .catch(() => [])
            sp.info = Array.from(new Set(info.map(x => JSON.stringify(x)))).map(x => JSON.parse(x))
        }
        return selected
    }
    //#endregion

    //#region File
    private async scaffoldToTemp(tableString: string, contextName: string): Promise<{ tempDir: string, entityFiles: Map<string, string> } | null> {
        const tempDir = createTempDir()
        const tempOutput = `${tempDir}/Entities`
        const tempContext = `${tempDir}/Context`
        const isCleanArch = this._architectureType === ArchitectureType.CleanArchitecture
        const annotations = isCleanArch ? '' : ' --data-annotations'
        const command = `dotnet ef dbcontext scaffold "${this._connection.connectionString}" Microsoft.EntityFrameworkCore.SqlServer --table ${tableString} --context ${contextName} --context-dir ${tempContext} --output-dir ${tempOutput}${annotations} --use-database-names --no-onconfiguring --no-pluralize  --force`
        await runCommand(this._path, command)
        const entityFiles = readAllCsFiles(`${tempDir}/Entities`)
        return { tempDir, entityFiles }
    }
    private async regenerate(selectedTables: string[], viewNames: string[] = []): Promise<string | null> {
        if (!await this.checkPackage(EFCoreDesign))
            return null
        const tableString = selectedTables.join(` --table `)
        const isCleanArch = this._architectureType === ArchitectureType.CleanArchitecture
        const folders = isCleanArch ? this.getCleanArchFolders() : null
        const contextName = isCleanArch ? this.config.cleanArchDbContextFileName : this.config.dbContextFileName
        const result = await this.scaffoldToTemp(tableString, contextName)
        if (!result) return null
        const { tempDir, entityFiles } = result
        const projectName = isCleanArch ? this.getBaseProjectName() : ''
        // Step 1: Process files in temp (temp is the source for modifications)
        if (isCleanArch) {
            for (const [name, content] of entityFiles) {
                if (!viewNames.includes(name) && !selectedTables.includes(name)) continue
                const transformed = transformEntityForCleanArch(content, name, projectName)
                const tempEntityPath = `${tempDir}/Entities/${name}.cs`
                writeFileContent(tempEntityPath, transformed)
            }
        } else {
            const rootNamespace = pathLib.basename(this._path)
            for (const [name, content] of entityFiles) {
                if (!viewNames.includes(name) && !selectedTables.includes(name)) continue
                const transformed = transformEntityForNTier(content, name, rootNamespace)
                const tempEntityPath = `${tempDir}/Entities/${name}.cs`
                writeFileContent(tempEntityPath, transformed)
            }
        }
        // Step 2: Copy from temp to target (temp is the source)
        if (isCleanArch) {
            const tempEntitiesDir = `${tempDir}/Entities`
            const targetEntitiesDir = `${folders!.root}/${folders!.domainFolder}/${folders!.entityFolder}`
            copyDirSync(tempEntitiesDir, targetEntitiesDir)
        } else {
            const tempEntitiesDir = `${tempDir}/Entities`
            const targetEntitiesDir = `${this._path}/${this.config.modelFolder}`
            copyDirSync(tempEntitiesDir, targetEntitiesDir)
        }
        return tempDir
    }
    private async generate(selectedTables: string[], viewNames: string[] = []) {
        if (!await this.checkPackage(EFCoreDesign))
            return false
        const tableString = selectedTables.join(` --table `)
        const isCleanArch = this._architectureType === ArchitectureType.CleanArchitecture
        const folders = isCleanArch ? this.getCleanArchFolders() : null
        const contextName = isCleanArch ? this.config.cleanArchDbContextFileName : this.config.dbContextFileName
        const result = await this.scaffoldToTemp(tableString, contextName)
        if (!result) return false
        const { tempDir, entityFiles } = result
        try {
            const projectName = isCleanArch ? this.getBaseProjectName() : ''
            const tableConfigs: string[] = []
            const viewConfigs: string[] = []
            // Step 1: Process files in temp (temp is the source for modifications)
            if (isCleanArch) {
                // Extract entity blocks from scaffolded context BEFORE overwriting
                const scaffoldedContextPath = `${tempDir}/Context/${contextName}.cs`
                if (await exists(scaffoldedContextPath)) {
                    const scaffoldedContext = readFileContent(scaffoldedContextPath)
                    const entityBlocks = extractEntityBlocks(scaffoldedContext)
                    for (const { entityName, block } of entityBlocks) {
                        if (viewNames.includes(entityName)) {
                            viewConfigs.push(block)
                        } else if (selectedTables.includes(entityName)) {
                            tableConfigs.push(block)
                        }
                    }
                }
                for (const [name, content] of entityFiles) {
                    if (!viewNames.includes(name) && !selectedTables.includes(name)) continue
                    const transformed = transformEntityForCleanArch(content, name, projectName)
                    const tempEntityPath = `${tempDir}/Entities/${name}.cs`
                    writeFileContent(tempEntityPath, transformed)
                }
                const dbContextContent = generateCleanArchDbContext(projectName, contextName)
                writeFileContent(`${tempDir}/Context/${contextName}.cs`, dbContextContent)
            } else {
                const rootNamespace = pathLib.basename(this._path)
                for (const [name, content] of entityFiles) {
                    if (!viewNames.includes(name) && !selectedTables.includes(name)) continue
                    const transformed = transformEntityForNTier(content, name, rootNamespace)
                    const tempEntityPath = `${tempDir}/Entities/${name}.cs`
                    writeFileContent(tempEntityPath, transformed)
                }
            }

            // Step 2: Copy from temp to target (temp is the source)
            if (isCleanArch) {
                const tempEntitiesDir = `${tempDir}/Entities`
                const targetEntitiesDir = `${folders!.root}/${folders!.domainFolder}/${folders!.entityFolder}`
                copyDirSync(tempEntitiesDir, targetEntitiesDir)

                const tempContextDir = `${tempDir}/Context`
                const targetContextDir = `${folders!.root}/${folders!.infrastructureFolder}/Data`
                copyDirSync(tempContextDir, targetContextDir)

                // Generate AppDBConfigurations.cs from extracted entity blocks
                const tableEntries = tableConfigs.map(s => `            ${s.trim()}`).join('\r\n\r\n')
                const viewEntries = viewConfigs.map(s => `            ${s.trim()}`).join('\r\n\r\n')
                const configurationsContent = `using Microsoft.EntityFrameworkCore;\r\nusing ${projectName}.Domain.Entities;\r\n\r\nnamespace ${projectName}.Infrastructure.Data.Configurations;\r\n\r\npublic static class AppDBConfigurations\r\n{\r\n    public static void Configure(ModelBuilder modelBuilder)\r\n    {\r\n        #region Tables\r\n${tableEntries || '        '}\r\n        #endregion\r\n\r\n        #region Views\r\n${viewEntries || '        '}\r\n        #endregion\r\n\r\n        #region Stored Procedures\r\n        #endregion\r\n    }\r\n}`
                await saveFile(<FileContent>{ path: folders!.root, folder: `${folders!.infrastructureFolder}/${folders!.configurationsFolder}`, filename: 'AppDBConfigurations.cs', content: configurationsContent })
            } else {
                // NTier: copy entity files and context from temp to target
                const tempEntitiesDir = `${tempDir}/Entities`
                const targetEntitiesDir = `${this._path}/${this.config.modelFolder}`
                copyDirSync(tempEntitiesDir, targetEntitiesDir)
            }
        } finally {
            removeDirSync(tempDir)
        }
        return true
    }
    private async createRepo(selectedTables: string[]) {
        if (!await this.checkPackage(SDCores))
            return false
        const tempDir = createTempDir()
        try {
            const repofile = [getIRepoFile(tempDir, selectedTables, this.config), getRepoFile(tempDir, selectedTables, this.config)]
            repofile.forEach(async file => { await saveFile(file); })
        } finally {
            removeDirSync(tempDir)
        }
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
        const tempDir = createTempDir()
        try {
            const repofile = geUpdateRepoFile(tempDir, selectedTables, this.config)
            repofile.forEach(async file => { await saveFile(file); })
        } finally {
            removeDirSync(tempDir)
        }
        showMessage('Repository files created successfully');
        return true
    }
    private async genStoreProcedure(selectedProcedures: QuickPickModel[], progress: Progress<{ message?: string }>) {
        progress.report({ message: `Validating project files...` });
        if (this._architectureType === ArchitectureType.CleanArchitecture) {
            const folders = this.getCleanArchFolders()
            const folder: string = `${folders.infrastructureFolder}/Data`
            const filename: string = `${this.config.cleanArchDbContextFileName}.cs`;
            if (!await exists(`${folders.root}\\${folder}\\${filename}`)) {
                showError(`File ${filename} does not exist in ${folder}, please generate database first`);
                return false
            }
        } else {
            const folder: string = this.config.dbContextFolder
            const filename: string = `${this.config.dbContextFileName}.cs`;
            if (!await exists(`${this._path}\\${folder}\\${filename}`)) {
                showError(`File ${filename} does not exist, please generate database first`);
                return false
            }
        }
        progress.report({ message: `Analyzing ${selectedProcedures.length} stored procedures...` });
        const regexp = /([A-Za-z0-9]+)(\((.*)\)|(.*))/
        const storeList: StoreProcedureInfoModel[] = selectedProcedures.map(x => {
            let variables: VariableInfoModel[] = (x.info || []).map(info => {
                const typeStr = regexp.exec(info.TYPE)?.[1] || info.TYPE
                const isValueType = !!SqlOtherDataTypes[typeStr as keyof typeof SqlOtherDataTypes]
                const baseType = isValueType
                    ? SqlOtherDataTypes[typeStr as keyof typeof SqlOtherDataTypes] as string
                    : SqlStringDataTypes[typeStr as keyof typeof SqlStringDataTypes] as string || 'object'
                return <VariableInfoModel>{
                    columnName: info.NAME,
                    variableName: info.NAME?.trim().replace(/[^\p{L}\d\s_]+/gu, '').replace(/\s+/g, "_"),
                    sqlType: info.TYPE,
                    dataType: baseType
                }
            })
            if (variables.length === 0 && x.params && x.params.length > 0) {
                variables = x.params
                    .filter(p => !p.isOutput)
                    .map(p => {
                        const typeStr = regexp.exec(p.typeName)?.[1] || p.typeName
                        const isValueType = !!SqlOtherDataTypes[typeStr as keyof typeof SqlOtherDataTypes]
                        const baseType = isValueType
                            ? SqlOtherDataTypes[typeStr as keyof typeof SqlOtherDataTypes] as string
                            : SqlStringDataTypes[typeStr as keyof typeof SqlStringDataTypes] as string || 'object'
                        return <VariableInfoModel>{
                            columnName: p.name?.replace(/^@/, ''),
                            variableName: p.name?.replace(/^@/, '').trim().replace(/[^\p{L}\d\s_]+/gu, '').replace(/\s+/g, "_"),
                            sqlType: p.typeName,
                            dataType: baseType
                        }
                    })
            }
            return <StoreProcedureInfoModel>{
                storeName: x.id,
                variables: variables,
                parameters: (x.params || []).map(p => {
                    const typeStr = regexp.exec(p.typeName)?.[1] || p.typeName
                    const isValueType = !!SqlOtherDataTypes[typeStr as keyof typeof SqlOtherDataTypes]
                    const baseType = isValueType
                        ? SqlOtherDataTypes[typeStr as keyof typeof SqlOtherDataTypes] as string
                        : SqlStringDataTypes[typeStr as keyof typeof SqlStringDataTypes] as string || 'object'
                    return {
                        name: p.name,
                        typeName: p.typeName,
                        maxLength: p.maxLength,
                        precision: p.precision,
                        scale: p.scale,
                        isOutput: p.isOutput,
                        variableName: p.name?.replace(/^@/, '').trim().replace(/[^\p{L}\d\s]+/gu, '').replace(/\s+/g, "_"),
                        dataType: isValueType ? baseType + "?" : baseType
                    }
                })
            }
        })
        if (this._architectureType === ArchitectureType.CleanArchitecture) {
            const folders = this.getCleanArchFolders()
            const projectName = this.getBaseProjectName()
            try {
                // Generate entity files directly to target (no temp needed - code-generated, not scaffolded)
                progress.report({ message: `Generating entity files...` });
                for (const store of storeList) {
                    const rawContent = getCleanArchitectureEntityFile(this._path, store, this.config, projectName)
                    const transformed = transformEntityForCleanArch(rawContent.content, store.storeName, projectName)
                    await saveFile(<FileContent>{
                        path: folders.root,
                        folder: `${folders.domainFolder}/${folders.entityFolder}`,
                        filename: `${store.storeName}.cs`,
                        content: transformed
                    })
                }
            } catch (error: any) {
                showError(`Error generating entity files: ${error.message}`);
                return false
            }
            progress.report({ message: `Updating AppDBConfigurations...` });
            try {
                const configurationsFolder = `${folders.infrastructureFolder}/${folders.configurationsFolder}`
                const configurationsFile = `${configurationsFolder}/AppDBConfigurations.cs`
                if (!await exists(`${folders.root}\\${configurationsFile}`)) {
                    showError(`File AppDBConfigurations.cs does not exist`);
                    return false
                }
                let content = readFileContent(`${folders.root}\\${configurationsFile}`)
                const storeNames = storeList.map(s => s.storeName)
                const newEntries = getCleanArchitectureConfigurationsSnippet(storeNames)
                const insertBefore = '#endregion'
                const lastSpRegionIndex = content.lastIndexOf('#region Stored Procedures')
                const lastRegionEnd = content.lastIndexOf(insertBefore)
                if (lastSpRegionIndex !== -1 && lastRegionEnd !== -1) {
                    content = content.slice(0, lastRegionEnd) + '\r\n' + newEntries + '\r\n        ' + content.slice(lastRegionEnd)
                }
                await saveFile(<FileContent>{ path: folders.root, folder: configurationsFolder, filename: 'AppDBConfigurations.cs', content: content })
            } catch (error: any) {
                showError(`Error updating AppDBConfigurations: ${error.message}`);
                return false
            }
            showMessage(`Generated ${storeList.length} Clean Architecture entity files successfully`);
        } else {
            try {
                // Generate model files directly to target
                progress.report({ message: `Generating model files...` });
                for (const store of storeList) {
                    const modelContent = getStoredProcedureModelFile(this._path, store, this.config)
                    await saveFile(modelContent)
                }
                // Update DbContext directly (reads existing, adds new SP DbSets + HasNoKey)
                progress.report({ message: `Updating DbContext...` });
                const dbContextContent = getUpdateStoreProcedureDbContextFile(this._path, storeList, this.config)
                await saveFile(dbContextContent);
            } catch (error: any) {
                showError(`Error generating files: ${error.message}`);
                return false
            }
            showMessage(`Generated ${storeList.length} model(s) and updated DbContext successfully`);
        }
        return true
    }
    private async regenDbContext(tableNames: string[] = [], viewNames: string[] = [], tempDir?: string) {
        const isCleanArch = this._architectureType === ArchitectureType.CleanArchitecture
        const folders = isCleanArch ? this.getCleanArchFolders() : null
        const basePath = isCleanArch ? folders!.root : this._path
        const folder: string = isCleanArch ? `${folders!.infrastructureFolder}/Data` : this.config.dbContextFolder
        const contextName = isCleanArch ? this.config.cleanArchDbContextFileName : this.config.dbContextFileName
        const filename: string = `${contextName}.cs`;
        if (!await exists(`${basePath}\\${folder}\\${filename}`)) {
            showError(`File ${filename} does not exist in ${folder}, use generate instead`);
            return false
        }
        if (!isCleanArch) {
            const tempContextPath = tempDir ? `${tempDir}/Context/${contextName}.cs` : undefined
            const dbContextContent = getUpdateDbContextFile(this._path, this.config, undefined, undefined, tempContextPath)
            if (dbContextContent == null) {
                showError(`File ${filename} is not in right format, please check or use generate instead`);
                return false
            }
            await saveFile(dbContextContent);
        }
        if (isCleanArch && (tableNames.length > 0 || viewNames.length > 0)) {
            const configurationsFolder = `${folders!.infrastructureFolder}/${folders!.configurationsFolder}`
            const configurationsFile = `${configurationsFolder}/AppDBConfigurations.cs`
            const configPath = `${basePath}\\${configurationsFile}`
            if (await exists(configPath) && tempDir) {
                let content = readFileContent(configPath)
                // Read entity configs from scaffolded context in temp
                const tempContextPath = `${tempDir}/Context/${contextName}.cs`
                if (await exists(tempContextPath)) {
                    const tempContext = readFileContent(tempContextPath)
                    const entityBlocks = extractEntityBlocks(tempContext)
                    const tableConfigs: string[] = []
                    const viewConfigs: string[] = []
                    for (const { entityName, block } of entityBlocks) {
                        if (viewNames.includes(entityName)) {
                            viewConfigs.push(block)
                        } else if (tableNames.includes(entityName)) {
                            tableConfigs.push(block)
                        }
                    }
                    // Replace Tables region
                    const tablesRegionIndex = content.indexOf('#region Tables')
                    const tablesRegionEnd = content.indexOf('#endregion', tablesRegionIndex)
                    if (tablesRegionIndex !== -1 && tablesRegionEnd !== -1) {
                        const newEntries = tableConfigs.map(s => `            ${s.trim()}`).join('\r\n\r\n')
                        content = content.slice(0, tablesRegionEnd) + '\r\n\r\n' + newEntries + '\r\n        ' + content.slice(tablesRegionEnd)
                    }
                    // Replace Views region
                    const viewsRegionIndex = content.indexOf('#region Views')
                    if (viewsRegionIndex !== -1) {
                        const viewsRegionEnd = content.indexOf('#endregion', viewsRegionIndex)
                        if (viewsRegionEnd !== -1) {
                            const newEntries = viewConfigs.map(s => `            ${s.trim()}`).join('\r\n\r\n')
                            content = content.slice(0, viewsRegionEnd) + '\r\n\r\n' + newEntries + '\r\n        ' + content.slice(viewsRegionEnd)
                        }
                    } else {
                        const spRegionIndex = content.indexOf('#region Stored Procedures')
                        if (spRegionIndex !== -1 && viewConfigs.length > 0) {
                            const viewEntries = viewConfigs.map(s => `            ${s.trim()}`).join('\r\n\r\n')
                            const viewsRegion = `\r\n\r\n        #region Views\r\n${viewEntries}\r\n        #endregion\r\n`
                            content = content.slice(0, spRegionIndex) + viewsRegion + content.slice(spRegionIndex)
                        }
                    }
                }
                await saveFile(<FileContent>{ path: basePath, folder: configurationsFolder, filename: 'AppDBConfigurations.cs', content: content })
            }
        }
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
        const projectList = await this.getAllProjects();
        const hasPackage = projectList.some(p => p.packages.some(x => x.packageName == name))
        if (!hasPackage) {
            showError(`Can not find ${name} package`);
            return false
        }
        return true
    }
    private async getAllProjects(): Promise<Project[]> {
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
        return projectList
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
    private getBaseProjectName(): string {
        const projectName = pathLib.basename(this._path)
        const suffixes = ['.Api', '.API', '.Application', '.Domain', '.Infrastructure', '.Shared', '.Core']
        for (const suffix of suffixes) {
            if (projectName.endsWith(suffix)) {
                return projectName.slice(0, -suffix.length)
            }
        }
        return projectName
    }
    private getCleanArchRoot(): string {
        return pathLib.dirname(this._path)
    }
    private getCleanArchFolders() {
        const baseName = this.getBaseProjectName()
        const root = this.getCleanArchRoot()
        return {
            root,
            domainFolder: `${baseName}.Domain`,
            entityFolder: 'Entities',
            infrastructureFolder: `${baseName}.Infrastructure`,
            configurationsFolder: 'Data/Configurations',
            apiFolder: `${baseName}.Api`
        }
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
    private async selectArchitectureType(): Promise<ArchitectureType | undefined> {
        const obj = Object.keys(ArchitectureType)
        const quickPickItems: QuickPickModel[] = [
            <QuickPickModel>{
                id: ArchitectureType.NTier,
                item: <QuickPickItem>{
                    label: obj[Object.values(ArchitectureType).indexOf(ArchitectureType.NTier)],
                    description: ArchitectureType.NTier,
                }
            },
            <QuickPickModel>{
                id: ArchitectureType.CleanArchitecture,
                item: <QuickPickItem>{
                    label: obj[Object.values(ArchitectureType).indexOf(ArchitectureType.CleanArchitecture)],
                    description: ArchitectureType.CleanArchitecture,
                }
            }
        ];
        const picked = await pickSingleItem(quickPickItems, 'Select architecture type')
        if (!picked)
            showError('Not pick item yet')
        return picked?.id as ArchitectureType | undefined
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

