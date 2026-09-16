<h1 align="center">
  DB Model Generator
  <br>
</h1>
<p align="center">
    <a>
        <img src="https://img.shields.io/badge/version-0.0.6-blue" alt="version">
    </a>
    <a>
        <img src="https://img.shields.io/badge/VS%20Code-1.83%2B-blue" alt="vscode">
    </a>
</p>

A VS Code extension to generate Entity Framework Core database context, entities, repositories, and stored procedure models from an existing SQL Server database using `appsettings.json` connection strings.

## Features

- **Generate Database** - Scaffold EF Core entities and DbContext from selected tables/views
- **Regenerate Database** - Update existing entities and DbContext with new/changed tables
- **Generate Repository** - Create repository interfaces and implementations (requires SDCores package, N-Tier only)
- **Generate Stored Procedures** - Create entity models and update DbContext for stored procedures
- **Architecture Support**:
  - **N-Tier** - Traditional layered architecture (Data + Model) with Repository support
  - **Clean Architecture** - Domain/Infrastructure separation with configurations

## Requirements

- .NET SDK with `dotnet-ef` tool installed
- Microsoft.EntityFrameworkCore.Design package in project
- SDCores package (for repository generation - N-Tier only)

## Usage

1. Right-click on `appsettings.json` (or folder containing it) in Explorer
2. Select **Generate Database** or **Regenerate Database**
3. **Select architecture type**: N-Tier or Clean Architecture
4. **Choose generation types** (based on architecture):
   - **N-Tier**: Database, Repository, Stored Procedures
   - **Clean Architecture**: Database, Stored Procedures
5. Pick connection string from appsettings.json
6. Select tables/views or stored procedures to generate

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `dbgenerator.generate` | Generate Database | Generate new entities, DbContext, repositories |
| `dbgenerator.regenerate` | Regenerate Database | Update existing entities and DbContext |

## Configuration

Settings can be configured in VS Code settings (`dbgenerator.*`):

| Setting | Default | Description |
|---------|---------|-------------|
| `dbContextFileName` | `DBContext` | DB context file name (N-Tier) |
| `dataFolder` | `Data` | DB context folder (N-Tier) |
| `modelFolder` | `Models` | Model/Entity folder (N-Tier) |
| `appSettingFileName` | `appsettings.json` | App settings file name |
| `repoFileName` | `RepositoryAccessor` | Repository file name |
| `repoFolder` | `_Repositories` | Repository folder |
| `domainFolder` | `Domain` | Domain folder (Clean Architecture) |
| `entityFolder` | `Entities` | Entity folder inside Domain |
| `infrastructureFolder` | `Infrastructure` | Infrastructure folder |
| `configurationsFolder` | `Configurations` | Configurations folder |
| `cleanArchDbContextFileName` | `AppDBContext` | DB context file name (Clean Architecture) |
| `cleanArchDbConfigurationsFileName` | `AppDBConfigurations` | Configurations file name (Clean Architecture) |

## Generated Structure

### N-Tier
```
Project/
├── Data/
│   └── DBContext.cs
├── Models/
│   ├── Entity1.cs
│   └── Entity2.cs
└── _Repositories/
    ├── IRepositoryAccessor.cs
    └── RepositoryAccessor.cs
```

### Clean Architecture
```
Solution/
├── MyProject.Domain/
│   └── Entities/
│       ├── Entity1.cs
│       └── Entity2.cs
├── MyProject.Infrastructure/
│   ├── Data/
│   │   └── AppDBContext.cs
│   └── Data/Configurations/
│       └── AppDBConfigurations.cs
```

## License

MIT