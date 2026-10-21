import { Sequelize } from "sequelize";

export interface PanelDatabaseOptions {
  storage: string;
}

export function createPanelDatabase({ storage }: PanelDatabaseOptions): Sequelize {
  return new Sequelize({
    dialect: "sqlite",
    storage,
    logging: false,
    pool: { max: 1, min: 0, idle: 1_000 },
    retry: { max: 0 },
  });
}
