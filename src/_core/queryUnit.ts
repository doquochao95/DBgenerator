"use strict";
import { QueryResult } from "../common/interfaces";
import { MSSqlConnnection } from "./mssqlConnection";

export class QueryUnit {
    public static queryPromise<T>(connection: MSSqlConnnection, sql: string): Promise<QueryResult<T>> {
        return new Promise((resolve, reject) => {
            connection.query(sql, (err: Error, rows, fields, total) => {
                err ? reject(err) : resolve(({ rows, fields, total }));
            });
        });
    }

}
