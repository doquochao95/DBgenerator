import * as vscode from 'vscode';
import * as pathLib from 'path';
import { DbGeneratorConfig, FileContent, StoreProcedureInfoModel } from '../common/interfaces';
import { readFileContent } from './filesystem.helper';
import { Path } from 'glob';

export function getDbContextFile(path: string, storeList: StoreProcedureInfoModel[], config: DbGeneratorConfig) {
    const folder: string = config.dbContextFolder
    const filename = `${config.dbContextFileName}.cs`;
    let dbsetContents: string = ''
    let modelbuilderContents: string = ''
    storeList.forEach(x => {
        dbsetContents += `public virtual DbSet<${x.storeName}> ${x.storeName} { get; set; }\r\n\r\n    `
        modelbuilderContents += `modelBuilder.Entity<${x.storeName}>().HasNoKey();\r\n\r\n        `
    })
    let content: string = readFileContent(`${path}\\${folder}\\${filename}`);
    let dbsetIndex: number = content.indexOf('protected override void OnModelCreating(ModelBuilder modelBuilder)');
    content = [content.slice(0, dbsetIndex), dbsetContents, content.slice(dbsetIndex)].join("");
    let modelbuilderIndex: number = content.indexOf('OnModelCreatingPartial(modelBuilder);');
    content = [content.slice(0, modelbuilderIndex), modelbuilderContents, content.slice(modelbuilderIndex)].join("");
    return <FileContent>{ path: path, folder: folder, filename: filename, content: content }
}
export function getModelFile(path: string, store: StoreProcedureInfoModel, config: DbGeneratorConfig) {
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
export function getIRepoFile(path: string, tableNames: string[], config: DbGeneratorConfig) {
    const irepo = tableNames.map(table => `IRepository<${table}> ${table} { get; }`)
    const root = pathLib.basename(path)
    const folder: string = '_Repositories'
    const name: string = 'IRepositoryAccessor'
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
    const folder: string = '_Repositories'
    const name: string = 'RepositoryAccessor'
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
        public RepositoryAccessor(${config.dbContextFileName} dbContext)
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