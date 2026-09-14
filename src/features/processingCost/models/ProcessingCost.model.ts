import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProcessingCostTranslation from "./ProcessingCostTranslation.model";


@Table({
    tableName: "processingCosts"
})
class ProcessingCost extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: false
    })
    declare value: number

    @Column({
        type: DataType.ENUM("per_weight", "percentage"),
        allowNull: false,
        defaultValue: "per_weight"
    })
    declare calculationType: string

    @HasMany(() => ProcessingCostTranslation, "processingCostId")
    declare translations: ProcessingCostTranslation[]
}

export default ProcessingCost;
