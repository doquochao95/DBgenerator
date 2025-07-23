import * as vscode from 'vscode';
import * as pathLib from 'path';
import { DbGeneratorConfig, FileContent } from '../common/interfaces';

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