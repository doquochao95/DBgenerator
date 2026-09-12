import { ConnectionOption } from "../common/constants";
import { ColumnInfoModel, CommonModel, ParameterInfoModel, RoutineModel, TableModel } from "../common/interfaces";
import { MSSqlConnnection } from "../_core/mssqlConnection";
import { QueryUnit } from "../_core/queryUnit";
import { SQLSchemaType } from "../common/enums";

export async function queryStoredProcedureDefinition(connection: ConnectionOption, procedureName: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const sql = `SELECT OBJECT_DEFINITION(OBJECT_ID('${procedureName}')) AS definition`
        await QueryUnit.queryPromise<any[]>(newConnection, sql)
          .then(res => {
            resolve(res.rows[0]?.definition || '')
          })
          .catch(error => {
            reject(error)
          })
      }
    });
  });
}

export async function queryTables(connection: ConnectionOption): Promise<CommonModel[]> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const sql = `SELECT *
                  FROM INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_CATALOG = '${connection.database}' 
                  AND TABLE_TYPE = '${SQLSchemaType.TABLE}'
                  ORDER BY TABLE_NAME`
        await QueryUnit.queryPromise<TableModel[]>(newConnection, sql)
          .then(res => {
            const result: CommonModel[] = res.rows.map(x => <CommonModel>{
              CATALOG: x.TABLE_CATALOG,
              NAME: x.TABLE_NAME,
              SCHEMA: x.TABLE_SCHEMA,
              TYPE: x.TABLE_TYPE
            })
            resolve(result)
          }
          ).catch(error => {
            reject(error)
          })
      }
    });
  });
}
export async function queryViews(connection: ConnectionOption): Promise<CommonModel[]> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const sql = `SELECT *
                  FROM INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_CATALOG = '${connection.database}' 
                  AND TABLE_TYPE = '${SQLSchemaType.VIEW}'
                  ORDER BY TABLE_NAME`
        await QueryUnit.queryPromise<TableModel[]>(newConnection, sql)
          .then(res => {
            const result: CommonModel[] = res.rows.map(x => <CommonModel>{
              CATALOG: x.TABLE_CATALOG,
              NAME: x.TABLE_NAME,
              SCHEMA: x.TABLE_SCHEMA,
              TYPE: x.TABLE_TYPE
            })
            resolve(result)
          }
          ).catch(error => {
            reject(error)
          })
      }
    });
  });
}
export async function queryStoredProcedures(connection: ConnectionOption): Promise<CommonModel[]> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const sql = `SELECT *
                  FROM INFORMATION_SCHEMA.ROUTINES
                  WHERE ROUTINE_CATALOG = '${connection.database}' 
                  AND ROUTINE_TYPE = '${SQLSchemaType.PROCEDURE}'
                  ORDER BY ROUTINE_NAME`
        await QueryUnit.queryPromise<RoutineModel[]>(newConnection, sql)
          .then(res => {
            const result: CommonModel[] = res.rows.map(x => <CommonModel>{
              CATALOG: x.ROUTINE_CATALOG,
              NAME: x.ROUTINE_NAME,
              SCHEMA: x.ROUTINE_SCHEMA,
              TYPE: x.ROUTINE_TYPE
            })
            resolve(result)
          }
          ).catch(error => {
            reject(error)
          })
      }
    });
  });
}
export async function queryStoredProceduresInfo(connection: ConnectionOption, procedureName: string, params: { name: string, typeName: string }[] = []): Promise<ColumnInfoModel[]> {
  if (params.length === 0) return []
  return await queryStoredProcedureInfoViaExecution(connection, procedureName, params)
}
export async function queryStoredProceduresParameters(connection: ConnectionOption, procedureName: string): Promise<ParameterInfoModel[]> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const sql = `SELECT
                    p.name AS NAME,
                    t.name AS TypeName,
                    p.max_length AS MaxLength,
                    p.precision AS Precision,
                    p.scale AS Scale,
                    p.is_output AS IsOutput
                  FROM sys.parameters p
                  INNER JOIN sys.types t ON p.system_type_id = t.system_type_id AND p.user_type_id = t.user_type_id
                  WHERE p.object_id = OBJECT_ID('${procedureName}')
                  AND p.name != ''
                  ORDER BY p.parameter_id`
        await QueryUnit.queryPromise<any[]>(newConnection, sql)
          .then(res => {
            const result = res.rows.map(x => <ParameterInfoModel>{
              name: x.NAME,
              typeName: x.typeName,
              maxLength: x.maxLength,
              precision: x.precision,
              scale: x.scale,
              isOutput: x.isOutput === 1
            })
            resolve(result)
          }
          ).catch(error => {
            resolve([])
          })
      }
    });
  });
}
async function queryStoredProcedureInfoViaExecution(connection: ConnectionOption, procedureName: string, params: { name: string, typeName: string }[]): Promise<ColumnInfoModel[]> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const execParams = params.map(p => `${p.name} = NULL`).join(', ')
        const execStatement = execParams ? `[${procedureName}] ${execParams}` : `[${procedureName}]`
        const sql = `SET NOCOUNT ON; EXEC ${execStatement}`
        let capturedFields: any[] = []
        newConnection.query(sql, (err: any, rows: any, fields: any) => {
          if (fields && fields.length > 0) {
            capturedFields = fields
          }
          const result: ColumnInfoModel[] = capturedFields
            .filter((f: any) => f.name)
            .map((f: any) => ({
              NAME: f.name,
              TYPE: f.typeName || 'nvarchar(max)'
            }))
          resolve(result)
        })
      }
    });
  });
}