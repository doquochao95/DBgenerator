import { ConnectionOption } from "../common/constants";
import { ColumnInfoModel, CommonModel, RoutineModel, TableModel } from "../common/interfaces";
import { MSSqlConnnection } from "../_core/mssqlConnection";
import { QueryUnit } from "../_core/queryUnit";
import { SQLSchemaType } from "../common/enums";

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
export async function queryStoredProceduresInfo(connection: ConnectionOption, procedureName : string): Promise<ColumnInfoModel[]> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const sql = `SELECT [NAME] = name, system_type_name as TYPE
                  FROM sys.dm_exec_describe_first_result_set_for_object ( OBJECT_ID('${procedureName}'), NULL);`
        await QueryUnit.queryPromise<ColumnInfoModel[]>(newConnection, sql)
          .then(res => {
            const result = res.rows
            resolve(result)
          }
          ).catch(error => {
            reject(error)
          })
      }
    });
  });
}