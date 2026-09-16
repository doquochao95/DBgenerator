import * as pathLib from 'path';
import glob = require('glob');
import { ColumnInfoModel, CommonModel, Connection, DbGeneratorConfig, FileContent, ConfigModel, PackageDetail, ParameterInfoModel, Project, QuickPickModel, StoreProcedureInfoModel, TableModel, VariableInfoModel } from '../common/interfaces';
import { pickManyItems, pickSingleItem, showError, showMessage, confirm } from '../helpers/dialog.helper';
import { GenType, Mode, SqlOtherDataTypes, SQLSchemaType, SqlStringDataTypes, ArchitectureType } from '../common/enums';
import { ConnectionOption, EFCoreDesign, SDCores } from '../common/constants';
import { exists, findProjects, readFileContent, runCommand, saveFile, createTempDir, copyDirSync, removeDirSync, writeFileContent } from '../helpers';
import { getPackages } from '../helpers/xml.helper';
import { queryStoredProcedures, queryStoredProceduresInfo, queryStoredProceduresParameters, queryStoredProcedureDefinition, queryTables, queryViews } from '../helpers/sql.helper';
import { getUpdateStoreProcedureDbContextFile, getIRepoFile, getStoredProcedureModelFile, getRepoFile, updateDbContextFile, geUpdateRepoFile, getCleanArchitectureEntityFile, getCleanArchitectureConfigurationsSnippet, transformEntityForCleanArch, transformEntityForNTier, readAllCsFiles, extractEntityBlocks, updateAppDBConfigurations, createAppDBContextFile, createAppDBConfigurations, createDbContextFile } from '../helpers/content.helper';
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
                progress.report({ message: `Selecting architecture type...` });
                const archType = await this.selectArchitectureType()
                if (!archType) return
                this._architectureType = archType

                this._genTypes = await this.selectGenType(this._architectureType)
                if (!this._genTypes) return

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
                progress.report({ message: `Selecting architecture type...` });
                const archType = await this.selectArchitectureType()
                if (!archType) return
                this._architectureType = archType

                this._genTypes = await this.selectGenType(this._architectureType)
                if (!this._genTypes) return

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
                            if (!await this.regenerate(selectedTables.map(x => x.id), selectedViewNames)) return
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
    private async regenerate(selectedTables: string[], viewNames: string[] = []): Promise<boolean> {
        if (!await this.checkPackage(EFCoreDesign))
            return false
        const tableString = selectedTables.join(` --table `)
        const isCleanArch = this._architectureType === ArchitectureType.CleanArchitecture
        const config = isCleanArch ? this.getCleanArchConfigs() : this.getNTierConfigs()
        const contextFile = `${config.dataPath}\\${config.dbContextFileName}.cs`
        if (!await exists(contextFile)) {
            showError(`File ${config.dbContextFileName}.cs does not exist in ${config.dataPath}, use generate instead`);
            return false
        }
        const result = await this.scaffoldToTemp(tableString, 'DBcontext')
        if (!result) return false
        const { tempDir, entityFiles } = result
        try {
            const tableConfigs: string[] = []
            const viewConfigs: string[] = []
            // Step 1: Process files in temp
            if (isCleanArch) {
                const scaffoldedContextPath = `${tempDir}/Context/DBcontext.cs`
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
                    const transformed = transformEntityForCleanArch(config, content)
                    const tempEntityPath = `${tempDir}/Entities/${name}.cs`
                    writeFileContent(tempEntityPath, transformed)
                }
            } else {
                const scaffoldedContextPath = `${tempDir}/Context/DBcontext.cs`
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
                const rootNamespace = pathLib.basename(this._path)
                for (const [name, content] of entityFiles) {
                    if (!viewNames.includes(name) && !selectedTables.includes(name)) continue
                    const transformed = transformEntityForNTier(content, name, rootNamespace)
                    const tempEntityPath = `${tempDir}/Entities/${name}.cs`
                    writeFileContent(tempEntityPath, transformed)
                }
            }
            // Step 2: Copy from temp to target + regen context
            if (isCleanArch) {
                copyDirSync(`${tempDir}/Entities`, `${config.entityPath}`)
                const configurationsContent = updateAppDBConfigurations(config, tableConfigs, viewConfigs)
                if (configurationsContent == null) {
                    showError(`File ${this.config.cleanArchDbConfigurationsFileName}.cs does not exist`);
                    return false
                }
                await saveFile(configurationsContent)
            } else {
                copyDirSync(`${tempDir}/Entities`, `${config.entityPath}`)
                const dbContextContent = updateDbContextFile(config, tableConfigs, viewConfigs)
                if (dbContextContent == null) {
                    showError(`File ${config.dbContextFileName}.cs is not in right format, please check or use generate instead`);
                    return false
                }
                await saveFile(dbContextContent);
            }
        } finally {
            removeDirSync(tempDir)
        }
        return true
    }
    private async generate(selectedTables: string[], viewNames: string[] = []) {
        if (!await this.checkPackage(EFCoreDesign))
            return false
        const tableString = selectedTables.join(` --table `)
        const isCleanArch = this._architectureType === ArchitectureType.CleanArchitecture
        const config = isCleanArch ? this.getCleanArchConfigs() : this.getNTierConfigs()
        const result = await this.scaffoldToTemp(tableString, 'DBcontext')
        if (!result) return false
        const { tempDir, entityFiles } = result
        try {
            const tableConfigs: string[] = []
            const viewConfigs: string[] = []
            // Step 1: Process files in temp (temp is the source for modifications)
            if (isCleanArch) {
                // Extract entity blocks from scaffolded context BEFORE overwriting
                const scaffoldedContextPath = `${tempDir}/Context/DBcontext.cs`
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
                    const transformed = transformEntityForCleanArch(config, content)
                    const tempEntityPath = `${tempDir}/Entities/${name}.cs`
                    writeFileContent(tempEntityPath, transformed)
                }
            } else {
                const scaffoldedContextPath = `${tempDir}/Context/DBcontext.cs`
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
                copyDirSync(tempEntitiesDir, config.entityPath)

                const dbContextContent = createAppDBContextFile(config)
                await saveFile(dbContextContent)

                // Generate AppDBConfigurations.cs from extracted entity blocks
                const configurationsContent = createAppDBConfigurations(config, tableConfigs, viewConfigs)
                await saveFile(configurationsContent)
            } else {
                const tempEntitiesDir = `${tempDir}/Entities`
                copyDirSync(tempEntitiesDir, config.entityFolder)

                const dbContextContent = createDbContextFile(config, tableConfigs, viewConfigs)
                await saveFile(dbContextContent)
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
        const isCleanArch = this._architectureType === ArchitectureType.CleanArchitecture
        const config = isCleanArch ? this.getCleanArchConfigs() : this.getNTierConfigs()
        if (isCleanArch) {
            const filename: string = `${this.config.cleanArchDbConfigurationsFileName}.cs`;
            if (!await exists(`${config.configurationsPath}\\${filename}`)) {
                showError(`File ${filename} does not exist, please generate database first`);
                return false
            }
        } else {
            const filename: string = `${this.config.dbContextFileName}.cs`;
            if (!await exists(`${config.dataPath}\\${filename}`)) {
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
        if (isCleanArch) {
            try {
                // Generate entity files directly to target (no temp needed - code-generated, not scaffolded)
                progress.report({ message: `Generating entity files...` });
                for (const store of storeList) {
                    const rawContent = getCleanArchitectureEntityFile(config, store)
                    const transformed = transformEntityForCleanArch(config, rawContent.content)
                    await saveFile(<FileContent>{
                        path: config.entityPath,
                        filename: `${store.storeName}.cs`,
                        content: transformed
                    })
                }
            } catch (error: any) {
                showError(`Error generating entity files: ${error.message}`);
                return false
            }
            progress.report({ message: `Updating ${this.config.cleanArchDbConfigurationsFileName}...` });
            try {
                const configurationsFile = `${config.dbConfigurationFileName}.cs`
                if (!await exists(`${config.configurationsPath}\\${configurationsFile}`)) {
                    showError(`File ${this.config.cleanArchDbConfigurationsFileName}.cs does not exist`);
                    return false
                }
                let content = readFileContent(`${config.configurationsPath}\\${configurationsFile}`)
                const storeNames = storeList.map(s => s.storeName)
                const newEntries = getCleanArchitectureConfigurationsSnippet(storeNames)
                const insertBefore = '#endregion'
                const lastSpRegionIndex = content.lastIndexOf('#region Stored Procedures')
                const lastRegionEnd = content.lastIndexOf(insertBefore)
                if (lastSpRegionIndex !== -1 && lastRegionEnd !== -1) {
                    content = content.slice(0, lastRegionEnd) + '\r\n' + newEntries + '\r\n        ' + content.slice(lastRegionEnd)
                }
                await saveFile(<FileContent>{ path: config.configurationsPath, filename: configurationsFile, content: content })
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
                    const modelContent = getStoredProcedureModelFile(config, store)
                    await saveFile(modelContent)
                }
                // Update DbContext directly (reads existing, adds new SP DbSets + HasNoKey)
                progress.report({ message: `Updating DbContext...` });
                const dbContextContent = getUpdateStoreProcedureDbContextFile(config, storeList)
                await saveFile(dbContextContent);
            } catch (error: any) {
                showError(`Error generating files: ${error.message}`);
                return false
            }
            showMessage(`Generated ${storeList.length} model(s) and updated DbContext successfully`);
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
    private getCleanArchConfigs() {
        const root = pathLib.dirname(this._path)
        const baseName = this.getBaseProjectName()
        return <ConfigModel>{
            root: root,
            projectName: baseName,
            dbContextFileName: this.config.cleanArchDbContextFileName,
            dbConfigurationFileName: this.config.cleanArchDbConfigurationsFileName,

            entityPath: `${root}\\${baseName}.${this.config.domainFolder}\\${this.config.entityFolder}`,
            dataPath: `${root}\\${baseName}.${this.config.infrastructureFolder}\\${this.config.dataFolder}`,
            configurationsPath: `${root}\\${baseName}.${this.config.infrastructureFolder}\\${this.config.dataFolder}\\${this.config.configurationsFolder}`,

            entityFolder: this.config.entityFolder,
            dataFolder: this.config.dataFolder,
            domainFolder: this.config.domainFolder,
            infrastructureFolder: this.config.infrastructureFolder,
            configurationsFolder: this.config.configurationsFolder
        }
    }
    private getNTierConfigs() {
        return <ConfigModel>{
            root: pathLib.dirname(this._path),
            dbContextFileName: this.config.dbContextFileName,

            entityPath: `${this._path}\\${this.config.modelFolder}`,
            dataPath: `${this._path}\\${this.config.dataFolder}`,

            entityFolder: this.config.modelFolder,
            dataFolder: this.config.dataFolder,
        }
    }
    //#endregion

    //#region Selection
    private async selectGenType(architectureType: ArchitectureType) {
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
            }
        ];
        if (architectureType === ArchitectureType.NTier) {
            quickPickItems.push(
                <QuickPickModel>{
                    id: GenType.Repository,
                    item: <QuickPickItem>{
                        label: obj[Object.values(GenType).indexOf(GenType.Repository)],
                        description: GenType.Repository,
                    }
                }
            )
        }
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

