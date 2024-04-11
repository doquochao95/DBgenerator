import { Types } from "./enums";

export interface FileContent {
    path: string
    folder: string
    name: string
    filename: string
    content: string
}
export interface DbGeneratorConfig {
    dbContextFileName: string;
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
export interface Project {
    /**
     * The unique id for each project
     */
    id: number;
    /**
     * The project name is the same as `[project-name]`.csproj/fsproj
     */
    projectName: string;
    /**
     * The project path
     */
    projectPath: string;
    /**
     * The packages in the project
     */
    packages: PackageDetail[];
}
export interface PackageDetail {
    /**
     * The package name
     */
    packageName: string;
    /**
     * The package version
     */
    packageVersion: string;
}
export interface Element {
    /**
     * The name of element
     */
    name: string;
    /**
     * The type of element
     */
    type: string;
    /**
     * The attributes of element
     */
    attributes?: any;
    /**
     * The children elements
     */
    elements: Element[];
    /**
     * The text of element
     */
    text?: string;

    /**
     * The tag is self closing
     */
    isSelfClosing?: boolean;
}
export interface ItemGroup {
    /**
     * The root xml
     */
    rootElement: Element;
    /**
     * The index of ItemGroup tag
     */
    itemGroupIndex: number;
    /**
     * The root element is <Project Sdk="Microsoft...">
     */
    projectElement: Element;
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