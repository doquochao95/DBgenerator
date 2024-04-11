import { ConnectionOption } from "../common/constants";
import { TableModel } from "../common/interfaces";
import { MSSqlConnnection } from "../_core/mssqlConnection";
import { QueryUnit } from "../_core/queryUnit";

export async function execute(connection: ConnectionOption): Promise<TableModel[]> {
  return new Promise(async (resolve, reject) => {
    const newConnection = new MSSqlConnnection(connection)
    newConnection.connect(async (err: Error) => {
      if (err)
        reject(err)
      else {
        const sql = `SELECT *
                  FROM INFORMATION_SCHEMA.TABLES
                  WHERE
                  TABLE_TYPE = 'BASE TABLE'
                  AND TABLE_CATALOG = '${connection.database}' order by TABLE_NAME`
        await QueryUnit.queryPromise<TableModel[]>(newConnection, sql)
          .then(res => {
            const result: TableModel[] = res.rows
            resolve(result)
          }
          ).catch(error => {
            reject(error)
          })
      }
    });
  });

}