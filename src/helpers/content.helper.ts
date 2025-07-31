import * as vscode from 'vscode';
import * as pathLib from 'path';
import { DbGeneratorConfig, FileContent, StoreProcedureInfoModel } from '../common/interfaces';
import { readFileContent } from './filesystem.helper';
import { Path } from 'glob';

export function getUpdateDbContextFile(path: string, config: DbGeneratorConfig) {
    const folder: string = config.dbContextFolder
    const filename = `${config.dbContextFileName}.cs`;
    const filename_Temp = `${config.dbContextFileName}_temp.cs`;
    const regexNamespace = new RegExp(`namespace.*${folder}\\s*{`)
    const regexNewline = /\r\n    /gi
    const regexNoSpace = /\s+/g
    const regexDbset = /(?=public)/
    const regexEntity = /(?=modelBuilder)/
    const regex = /public.*?(public\svirtual\sDbSet.*?)protected\soverride\svoid\sOnModelCreating\(.*?\)\s*{.*?(modelBuilder.*?)OnModelCreatingPartial\(.*?\);.*?\(.*?\);\s*}/s
    let content: string = readFileContent(`${path}\\${folder}\\${filename}`);
    let content_Temp: string = readFileContent(`${path}\\${folder}\\${filename_Temp}`);
    const onNamespaceBracket = regexNamespace.test(content)
    const seperateDbset = onNamespaceBracket ? '\r\n\r\n        ' : '\r\n\r\n    '
    const seperateEntity = onNamespaceBracket ? '\r\n\r\n            ' : '\r\n\r\n        '
    const contentRegex = regex.exec(content)
    const contentRegex_Temp = regex.exec(content_Temp)
    if (contentRegex == null || contentRegex[1] == null || contentRegex[2] == null) return null
    let contentDbset_Temp: string[] = []
    let contentEntity_Temp: string[] = []
    const tempDbset = contentRegex_Temp[1].split(regexDbset).map(x => x.trim())
    const tempEntity = contentRegex_Temp[2].split(regexEntity).map(x => x.trim())
    const contentRegexDbset_NoSpace = contentRegex[1].replace(regexNoSpace, '')
    const contentRegexEntity_NoSpace = contentRegex[2].replace(regexNoSpace, '')
    tempDbset.forEach((x: string) => {
        if (contentRegexDbset_NoSpace.indexOf(x.replace(regexNoSpace, '')) == -1)
            contentDbset_Temp.push(`${x}${seperateDbset}`)
    })
    tempEntity.forEach((x: string) => {
        if (contentRegexEntity_NoSpace.indexOf(x.replace(regexNoSpace, '')) == -1) {
            x = onNamespaceBracket ? x.replace(regexNewline, '\r\n        ') : x
            contentEntity_Temp.push(`${x}${seperateEntity}`)
        }
    })
    content = content.replace(contentRegex[1], `${contentRegex[1]}${contentDbset_Temp.join('')}`)
    content = content.replace(contentRegex[2], `${contentRegex[2]}${contentEntity_Temp.join('')}`)
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
    const variables = store.variables.map(variable =>
        `[Column("${variable.columnName}", TypeName ="${variable.sqlType}")]\r\n        public ${variable.dataType} ${variable.variableName} { get; set; }`)
    const root = pathLib.basename(path)
    const folder: string = config.modelFolder
    const name: string = store.storeName
    const filename = `${name}.cs`;
    const content = `using System.ComponentModel.DataAnnotations.Schema;

namespace ${root}.${folder}
{
    public class ${name}
    {
        ${variables.join('\r\n        ')}
    }
}`;
    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
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