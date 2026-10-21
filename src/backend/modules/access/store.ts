import { QueryTypes, type Sequelize, type Transaction } from "sequelize";
export class AccessStore {
  constructor(readonly db: Sequelize, readonly transaction: Transaction) {}
  rows<T extends object>(sql: string, bind: Record<string, unknown> = {}): Promise<T[]> {
    return this.db.query<T>(sql, { bind, type: QueryTypes.SELECT, transaction: this.transaction });
  }
  async run(sql: string, bind: Record<string, unknown> = {}): Promise<void> { await this.db.query(sql, { bind, transaction: this.transaction }); }
}
