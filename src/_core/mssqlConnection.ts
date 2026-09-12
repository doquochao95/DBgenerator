import { Connection, ConnectionConfig, Request } from "./tedious";
import { EventEmitter } from "events";
import format = require('date-format');
import { FieldInfo } from "../common/interfaces";
import { pcStatus } from "../common/enums";
import { ConnectionOption } from "../common/constants";

const tediousTypeMap: Record<string, string> = {
    'BITN': 'bit', 'BIT': 'bit',
    'INTN': 'int', 'INT': 'int', 'INT4': 'int', 'INT8': 'bigint',
    'BIGINT': 'bigint', 'SMALLINT': 'smallint', 'TINYINT': 'tinyint',
    'FLT8': 'float', 'FLT4': 'real', 'FLOATN': 'float', 'REAL': 'real',
    'DECIMALN': 'decimal', 'DECIMAL': 'decimal',
    'NUMERICN': 'numeric', 'NUMERIC': 'numeric',
    'MONEYN': 'money', 'MONEY': 'money', 'MONEY4': 'smallmoney',
    'STRING': 'varchar', 'VARCHAR': 'varchar',
    'NSTRING': 'nvarchar', 'NVARCHAR': 'nvarchar', 'NVarChar': 'nvarchar',
    'TEXT': 'text', 'NTEXT': 'ntext', 'XML': 'xml',
    'DATETIMN': 'datetime', 'DATETIME': 'datetime', 'DATETIME2': 'datetime2',
    'DATETIME4': 'smalldatetime', 'DATE': 'date', 'TIME': 'time',
    'TIMESTAMP': 'timestamp', 'UNIQUEIDN': 'uniqueidentifier',
    'BINARY': 'binary', 'VARBINARY': 'varbinary', 'IMAGE': 'image',
    'SQL_VARIANT': 'sql_variant'
};

export class IpoolConnection<T> {
    public actual?: T;
    constructor(public id: number, public status: pcStatus) {
    }
}

export type queryCallback = (err: Error | null, results?: any, fields?: FieldInfo[], total?: number) => void;

export class MSSqlConnnection {
    private config: ConnectionConfig;
    private connections: IpoolConnection<Connection>[] = [];
    private waitQueue: Function[] = [];
    constructor(connection: ConnectionOption) {
        this.config = {
            server: connection.host,
            options: {
                port: connection.instanceName ? undefined : parseInt(connection.port as any),
                instanceName: connection.instanceName,
                useUTC: false,
                trustServerCertificate: true,
                database: connection.database || undefined,
                connectTimeout: connection.connectTimeout ? parseInt(connection.connectTimeout as any) : 5000,
                requestTimeout: connection.requestTimeout ? parseInt(connection.requestTimeout as any) : 10000,
                encrypt: connection.encrypt
            },
            authentication: {
                type: connection.authType,
                options: {
                    domain: connection.domain,
                    userName: connection.user,
                    password: connection.password,
                }
            }
        };
    }
     async getConnection(callback?: (connection: IpoolConnection<Connection>) => void): Promise<IpoolConnection<Connection>> {
        for (let i = 0; i < this.connections.length; i++) {
            const connection = this.connections[i];
            if (connection && connection.status == pcStatus.FREE) {
                if (callback)
                    callback(connection)
                connection.status = pcStatus.BUSY
                return connection
            }
        }
        this.waitQueue.push(callback)
        await this.fill()
    }

     async fill() {
        const amount = 1
        for (let i = 0; i < amount; i++) {
            if (this.connections[i]) continue;
            const poolConnection = new IpoolConnection<Connection>(i, pcStatus.PEENDING);
            this.connections.push(poolConnection)
            await this.createConnection(poolConnection)
        }
    }
    private createConnection(poolConnection: IpoolConnection<Connection>): Promise<void> {
        return new Promise(async (resolve) => {
            try {
                this.newConnection((err, con) => {
                    if (err) {
                        this.createConnection(poolConnection)
                    }
                    poolConnection.actual = con
                    if (con instanceof EventEmitter) {
                        con.on("error", () => {
                            this.endConnnection(poolConnection)
                        })
                        con.on("end", () => {
                            this.endConnnection(poolConnection)
                        })
                    }
                    const waiter = this.waitQueue.shift()
                    if (waiter) {
                        poolConnection.status = pcStatus.BUSY
                        waiter(poolConnection)
                    } else {
                        poolConnection.status = pcStatus.FREE
                    }
                    resolve();
                })
            } catch (error) {
                this.createConnection(poolConnection)
            }
        })
    }
     release(poolConnection: IpoolConnection<Connection>): void {
        poolConnection.status = pcStatus.FREE
        const waiter = this.waitQueue.shift()
        if (waiter) {
            poolConnection.status = pcStatus.BUSY
            waiter(poolConnection)
        }
    }
     endConnnection(poolConnection: IpoolConnection<Connection>): void {
        try {
            (poolConnection.actual as any).end();
        } catch (error) { }
        delete this.connections[poolConnection.id];
    }
    query(sql: string, callback?: queryCallback): void;
    query(sql: string, values: any, callback?: queryCallback): void;
    query(sql: any, values?: any, callback?: any) {
        if (!callback && values instanceof Function) 
            callback = values;
        let fields = [];
        let datas = [];
        const event = new EventEmitter()
        this.getConnection(poolConnection => {
            let tempDatas = [];
            let columnCount = 0;
            const connection = poolConnection.actual;
            const isDML = sql.match(/^\s*\b(insert|update|delete)\b/i)
            connection.execSql(new Request(sql, (err: any) => {
                const multi = columnCount > 1;
                event.emit("end")
                if (callback) {
                    if (err) {
                        callback(err, null, multi ? fields : fields[0] || [])
                    } else if (isDML) {
                        callback(null, { affectedRows: datas.length })
                    } else {
                        if (multi) datas.push(tempDatas)
                        callback(null, multi ? datas : tempDatas, multi ? fields : fields[0] || [])
                    }
                }
                this.release(poolConnection)
            }).on('columnMetadata', (columns: any[]) => {
                columnCount++;
                let tempFields = []
                columns.forEach((column: { colName: any; }) => {
                    let typeName = ''
                    try {
                        const colType = (column as any).type
                        if (colType) {
                            if (typeof colType.declaration === 'function') {
                                typeName = colType.declaration({})
                            }
                            if (!typeName) {
                                const typeId = colType.type || colType.name || ''
                                typeName = tediousTypeMap[typeId] || typeId.toLowerCase() || ''
                            }
                        }
                    } catch (e) { }
                    tempFields.push({
                        name: column.colName,
                        orgTable: ((column) as any).tableName,
                        typeName: typeName,
                        isNullable: (column as any).nullable !== false
                    })
                });
                fields.push(tempFields)
                if (columnCount > 1) {
                    datas.push(tempDatas)
                    tempDatas = []
                }
            }).on('row', (columns: any[]) => {
                let temp = {};
                columns.forEach((column: { metadata: { colName: string | number; }; value: any; }) => {
                    temp[column.metadata.colName] = column.value
                    if (column.value instanceof Date) {
                        temp[column.metadata.colName] = format("yyyy-MM-dd hh:mm:ss", column.value)
                    }
                });
                if (!callback) {
                    event.emit("result", temp)
                    return;
                }
                tempDatas.push(temp)
            }))
        })
        return event;
    }
    connect(callback: (err: Error) => void): void {
        try {
            const con = new Connection(this.config)
            con.on("connect", async (err: Error) => {
                if (!err)
                    await this.fill()
                callback(err)
            }).on("error", (err: Error) => {
                callback(err)
            })
        } catch (error: any) {
            callback(error)
        }
    }
    newConnection(callback: (err: Error, connection: Connection) => void): void {
        const connection = new Connection(this.config)
        connection.on("connect", (err: Error) => {
            callback(err, connection)
        })
    }
}