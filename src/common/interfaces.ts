import { WorkspaceConfiguration } from "vscode";
import { DatabaseType, Types } from "./enums";

export interface DbGeneratorConfig {
    dbContextFolder: string;
    modelFolder: string;
    appSettingFileName: string;
}
export interface Connection {
    name: string;
    connectionString: string;
}
export interface TableModel {
    TABLE_CATALOG: string;
    TABLE_NAME: string;
    TABLE_SCHEMA: string;
    TABLE_TYPE: string;
}

export interface FieldInfo {
    catalog: string;
    db: string;
    schema: string;
    table: string;
    orgTable: string;
    name: string;
    orgName: string;
    charsetNr: number;
    length: number;
    flags: number;
    decimals: number;
    default?: string;
    zeroFill: boolean;
    protocol41: boolean;
    type: Types;
}


export interface ColumnMeta {
    /**
     * column name.
     */
    name: string;
    /**
     * column type without length example: varcahr.
     */
    simpleType: string;
    /**
     * column type with length, example:varchar(255). 
     */
    type: string;
    /**
     * column comment.
     */
    comment: string;
    /**
     * indexed key.
     */
    key: string;
    /**
     * "YES" or  "NO" .
     */
    nullable: string;
    /**
     * man length or this column value.
     */
    maxLength: string;
    /**
     * default value or column.
     */
    defaultValue: any;
    /**
     * extra info, auto_increment
     */
    extra: any;
    isNotNull: boolean;
    isAutoIncrement: boolean;
    isUnique: boolean;
    isPrimary: boolean;
    pk: string;
}

export interface TableMeta {
    name: string;
    comment: string;
    rows: string;
    /**
     * below mysql only
     */
    auto_increment?: string;
    row_format?: string;
    /**
     * clustered bytes * pagesize
     */
    data_length?: string;
    /**
     * clustered bytes * pagesize
     */
    index_length?: string;
}
export interface QueryResult<T> {
    rows: T; fields: FieldInfo[];
    total?: number;
}