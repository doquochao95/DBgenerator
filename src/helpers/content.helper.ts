import * as vscode from 'vscode';
import * as fs from 'fs';
import * as pathLib from 'path';
import { DbGeneratorConfig, FileContent, StoreProcedureInfoModel } from '../common/interfaces';
import { readFileContent } from './filesystem.helper';
import { Path } from 'glob';

export function getUpdateDbContextFile(path: string, config: DbGeneratorConfig, overrideFolder?: string, overrideContextName?: string, tempContextPath?: string) {
    const folder: string = overrideFolder || config.dbContextFolder
    const contextName: string = overrideContextName || config.dbContextFileName
    const filename = `${contextName}.cs`;
    let content: string = readFileContent(`${path}\\${folder}\\${filename}`);
    let content_Temp: string = tempContextPath
        ? readFileContent(tempContextPath)
        : readFileContent(`${path}\\${folder}\\${filename}`)

    const dbSetRegex = /public\s+virtual\s+DbSet<[^>]+>[^;]+;/g
    const newDbSets = content_Temp.match(dbSetRegex) || []

    const entityBlockRegex = /modelBuilder\.Entity<[^>]+>\(entity\s*=>\s*\{[\s\S]*?\}\);/g
    const newEntities = content_Temp.match(entityBlockRegex) || []

    if (newDbSets.length > 0) {
        const insertIndex = content.indexOf('protected override void OnModelCreating')
        if (insertIndex !== -1) {
            const dbsetStr = newDbSets.map(s => `        ${s.trim()}`).join('\r\n\r\n        ')
            content = content.slice(0, insertIndex) + dbsetStr + '\r\n\r\n        ' + content.slice(insertIndex)
        }
    }

    if (newEntities.length > 0) {
        const insertIndex = content.indexOf('OnModelCreatingPartial(modelBuilder);')
        if (insertIndex !== -1) {
            const entityStr = newEntities.map(s => `            ${s.trim()}`).join('\r\n\r\n            ')
            content = content.slice(0, insertIndex) + entityStr + '\r\n\r\n            ' + content.slice(insertIndex)
        }
    }

    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
}
export function getUpdateStoreProcedureDbContextFile(path: string, storeList: StoreProcedureInfoModel[], config: DbGeneratorConfig) {
    const folder: string = config.dbContextFolder
    const filename = `${config.dbContextFileName}.cs`;
    const regexNamespace = new RegExp(`namespace.*${folder}\\s*{`)
    const regex = /public.*?(public\svirtual\sDbSet.*?)\s*protected\soverride\svoid\sOnModelCreating\(.*?\)\s*{.*?(modelBuilder.*?)\s*OnModelCreatingPartial\(.*?\);.*?\(.*?\);\s*}/s
    let content: string = readFileContent(`${path}\\${folder}\\${filename}`);
    const onNamespaceBracket = regexNamespace.test(content)
    const seperateDbset = onNamespaceBracket ? '\r\n\r\n        ' : '\r\n\r\n    '
    const seperateEntity = onNamespaceBracket ? '\r\n\r\n            ' : '\r\n\r\n        '
    const contentRegex = regex.exec(content)
    let dbsetContents: string[] = []
    let modelbuilderContents: string[] = []
    storeList.forEach(x => {
        if (contentRegex[1].indexOf(x.storeName) == -1)
            dbsetContents.push(`public virtual DbSet<${x.storeName}> ${x.storeName} { get; set; }${seperateDbset}`)
        if (contentRegex[2].indexOf(x.storeName) == -1)
            modelbuilderContents.push(`modelBuilder.Entity<${x.storeName}>().HasNoKey();${seperateEntity}`)
    })
    let dbsetIndex: number = content.indexOf('protected override void OnModelCreating(ModelBuilder modelBuilder)');
    content = [content.slice(0, dbsetIndex), dbsetContents.join(''), content.slice(dbsetIndex)].join("");
    let modelbuilderIndex: number = content.indexOf('OnModelCreatingPartial(modelBuilder);');
    content = [content.slice(0, modelbuilderIndex), modelbuilderContents.join(''), content.slice(modelbuilderIndex)].join("");
    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
}
export function getStoredProcedureModelFile(path: string, store: StoreProcedureInfoModel, config: DbGeneratorConfig) {
    const variables = (store.variables || []).map(variable => {
        const dataType = variable.dataType.endsWith('?') ? variable.dataType : `${variable.dataType}?`
        return `public ${dataType} ${variable.variableName} { get; set; }`
    })
    const root = pathLib.basename(path)
    const folder: string = config.modelFolder
    const name: string = store.storeName
    const filename = `${name}.cs`;
    const content = `namespace ${root}.${folder}
{
    public class ${name}
    {
        ${variables.length > 0 ? variables.join('\r\n        ') : '// No result set columns'}
    }
}`;
    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
}
export function getCleanArchitectureEntityFile(path: string, store: StoreProcedureInfoModel, config: DbGeneratorConfig, projectName: string) {
    const variables = (store.variables || []).map(variable => {
        const dataType = variable.dataType.endsWith('?') ? variable.dataType : `${variable.dataType}?`
        return `    public ${dataType} ${variable.variableName} { get; set; }`
    })
    const name: string = store.storeName
    const filename = `${name}.cs`;
    const folder = `${config.domainFolder}/${config.entityFolder}`
    const content = `namespace ${projectName}.${config.domainFolder}.${config.entityFolder};

public class ${name}
{
${variables.length > 0 ? variables.join('\r\n') : '    // No result set columns'}
}`;
    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
}
export function getCleanArchitectureConfigurationsSnippet(storeNames: string[]): string {
    const snippets = storeNames.map(name =>
        `        modelBuilder.Entity<${name}>(entity =>
        {
            entity.HasNoKey();
        });`)
    return snippets.join('\r\n\r\n')
}
export function generateCleanArchDbContext(projectName: string, contextName: string): string {
    return `using Microsoft.EntityFrameworkCore;

namespace ${projectName}.Infrastructure.Data;

public partial class ${contextName}(DbContextOptions<${contextName}> options) : DbContext(options) { }
`
}
export function geUpdateRepoFile(path: string, tableNames: string[], config: DbGeneratorConfig) {
    const folder: string = config.repoFolder
    const ifilename = `I${config.repoFileName}.cs`;
    const filename = `${config.repoFileName}.cs`;
    const iregex = /public\sinterface.*?{(.*?)(IRepository<.*?>.*?})\s*(Task<bool>.*?\s*|\s*)}/s
    const regex = /public\sclass.*private (.*?)\s(.*?);\s*public.*Context;\s*(.*= new Repository.*?)\s*}\s*(public\sIRepository<.*?>.*?)\s*public\sasync.*?;\s*}\s*}/s
    let icontent: string = readFileContent(`${path}\\${folder}\\${ifilename}`);
    let content: string = readFileContent(`${path}\\${folder}\\${filename}`);

    const icontentRegex = iregex.exec(icontent)
    const contentRegex = regex.exec(content)
    if (icontentRegex == null || contentRegex == null) return null
    const irepo = tableNames.flatMap(table => {
        const content = `IRepository<${table}> ${table} { get; }`
        return icontentRegex[2].indexOf(content) == -1 ? content : []
    })
    const repo_value = tableNames.flatMap(table => {
        const content = `${table} = new Repository<${table}, ${contentRegex[1]}>(${contentRegex[2]});`
        return contentRegex[3].indexOf(content) == -1 ? content : []
    })
    const repo_variable = tableNames.flatMap(table => {
        const content = `public IRepository<${table}> ${table} { get; set; }`
        return contentRegex[4].indexOf(content) == -1 ? content : []
    })

    icontent = icontent.replace(icontentRegex[2], `${icontentRegex[2]}\n        ${irepo.join('\n        ')}`)
    content = content.replace(contentRegex[3], `${contentRegex[3]}\n            ${repo_value.join('\n            ')}`)
    content = content.replace(contentRegex[4], `${contentRegex[4]}\n        ${repo_variable.join('\n        ')}`)

    return [
        <FileContent>{ path: path, folder: folder, filename: ifilename, content: icontent },
        <FileContent>{ path: path, folder: folder, filename: filename, content: content }
    ]
}
export function getIRepoFile(path: string, tableNames: string[], config: DbGeneratorConfig) {
    const irepo = tableNames.map(table => `IRepository<${table}> ${table} { get; }`)
    const root = pathLib.basename(path)
    const folder: string = config.repoFolder
    const name: string = `I${config.repoFileName}`
    const filename = `${name}.cs`;
    const content = `using ${root}.${config.modelFolder};
using Microsoft.EntityFrameworkCore.Storage;
using SDCores;
namespace ${root}.${folder}
{
    [DependencyInjection(ServiceLifetime.Scoped)]
    public interface ${name}
    {
        Task<bool> Save();
        Task<IDbContextTransaction> BeginTransactionAsync();
        ${irepo.join('\n        ')}
    }
}`;
    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
}

export function getRepoFile(path: string, tableNames: string[], config: DbGeneratorConfig) {
    const repo = tableNames.map(table => `${table} = new Repository<${table}, ${config.dbContextFileName}>(_dbContext);`)
    const irepo = tableNames.map(table => `public IRepository<${table}> ${table} { get; set; }`)
    const root = pathLib.basename(path)
    const folder: string = config.repoFolder
    const name: string = config.repoFileName
    const filename = `${name}.cs`;
    const content = `using ${root}.${config.dbContextFolder};
using ${root}.${config.modelFolder};
using Microsoft.EntityFrameworkCore.Storage;
using SDCores;
namespace ${root}.${folder}
{
    public class ${name} : I${name}
    {
        private ${config.dbContextFileName} _dbContext;
        public ${config.repoFileName}(${config.dbContextFileName} dbContext)
        {
            _dbContext = dbContext;
            ${repo.join('\n            ')}
        }
        ${irepo.join('\n        ')}
        public async Task<bool> Save()
        {
            return await _dbContext.SaveChangesAsync() > 0;
        }
        public async Task<IDbContextTransaction> BeginTransactionAsync()
        {
            return await _dbContext.Database.BeginTransactionAsync();
        }
    }
}`;
    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
}
export function transformEntityForCleanArch(content: string, entityName: string, projectName?: string): string {
    const lines = content.split(/\r?\n/)
    const newLines: string[] = []
    let hasUsingData = false
    for (const line of lines) {
        if (line.includes('[Table(')) {
            continue
        } else if (line.includes('[Column(')) {
            continue
        } else if (line.includes('using System.ComponentModel.DataAnnotations.Schema;')) {
            continue
        } else if (line.includes('using System.ComponentModel.DataAnnotations;')) {
            hasUsingData = true
            newLines.push(line)
        } else if (line.match(/^namespace\s+/) && projectName) {
            newLines.push(`namespace ${projectName}.Domain.Entities;`)
        } else if (line.match(/public\s+\w+\??\s+\w+\s*\{\s*get;\s*set;\s*\}/)) {
            const transformed = transformProperty(line)
            newLines.push(transformed)
        } else {
            newLines.push(line)
        }
    }
    return newLines.join('\r\n')
}
export function transformEntityForNTier(content: string, entityName: string, rootNamespace?: string): string {
    if (!rootNamespace) return content
    const lines = content.split(/\r?\n/)
    const newLines: string[] = []
    for (const line of lines) {
        if (line.match(/^namespace\s+/)) {
            newLines.push(`namespace ${rootNamespace}.Models;`)
        } else {
            newLines.push(line)
        }
    }
    return newLines.join('\r\n')
}
function transformProperty(line: string): string {
    const match = line.match(/public\s+(\w+)(\?)?\s+(\w+)\s*\{\s*get;\s*set;\s*\}/)
    if (!match) return line
    const typeName = match[1]
    const isNullable = match[2] === '?'
    const propName = match[3]
    const valueTypes = ['int', 'long', 'short', 'byte', 'decimal', 'double', 'float', 'bool', 'DateTime', 'DateTimeOffset', 'TimeSpan', 'Guid']
    const isValueType = valueTypes.includes(typeName)
    if (isValueType && !isNullable) {
        return `    public ${typeName} ${propName} { get; set; }`
    } else if (!isValueType && !isNullable) {
        return `    public required ${typeName} ${propName} { get; set; }`
    } else {
        return `    public ${typeName}? ${propName} { get; set; }`
    }
}
export function readAllCsFiles(dirPath: string): Map<string, string> {
    const result = new Map<string, string>()
    try {
        const files = fs.readdirSync(dirPath)
        for (const file of files) {
            if (file.endsWith('.cs')) {
                const name = file.replace('.cs', '')
                const content = readFileContent(`${dirPath}\\${file}`)
                if (content) {
                    result.set(name, content)
                }
            }
        }
    } catch (e) { }
    return result
}