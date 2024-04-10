import { DatabaseType } from "./enums";
import { Connection } from "./interfaces";

export class ConnectionOption {
    host: string;
    port: number;
    user: string;
    password?: string;
    dbType?: DatabaseType;
    database?: string;
    name?: string;
    timezone?: string;
    connectTimeout?: number;
    requestTimeout?: number;
    includeDatabases?: string;
    connectionUrl?: string;
    usingSSH?: boolean;
    global?: boolean;
    disable?: boolean;
    useSSL?: boolean;
    caPath?: string;
    clientCertPath?: string;
    clientKeyPath?: string;
    encrypt?: boolean;
    instanceName?: string;
    domain?: string;
    authType?: string;

    private serverRegex = /Server=["']?(.*?)(?:["'];|["';])/gm;
    private databaseRegex = /Database=["']?(.*?)(?:["'];|["';])/gm;
    private userRegex = /User Id=["']?(.*?)(?:["'];|["';])/gm;
    private passwordRegex = /Password=["']?(.*?)(?:["'];|["';])/gm;

    constructor(connectionString: Connection) {
        const _server = this.serverRegex.exec(connectionString.connectionString)
        const _user = this.userRegex.exec(connectionString.connectionString)
        const _password = this.passwordRegex.exec(connectionString.connectionString)
        const _database = this.databaseRegex.exec(connectionString.connectionString)
        this.host = _server[1];
        this.port = 1433;
        this.user = _user[1];
        this.authType = "default";
        this.password = _password[1];
        this.database = _database[1];
        this.usingSSH = false;
        this.includeDatabases = null;
        this.dbType = DatabaseType.MSSQL;
        this.encrypt = true;
        this.connectionUrl = "";
        this.global = true;
        this.timezone = "+00:00"
    }
}