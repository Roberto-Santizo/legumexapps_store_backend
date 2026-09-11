import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import ProcessingCost from "./ProcessingCost.model";

// Mismo patrón que IngredientTranslation/CategoryTranslation -- ver shared/utils/translation.util.ts.
@Table({
    tableName: "processingCostTranslations",
    indexes: [
        {
            unique: true,
            fields: ["processingCostId", "language"]
        }
    ]
})
class ProcessingCostTranslation extends Model {
    @ForeignKey(() => ProcessingCost)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare processingCostId: number

    @Column({
        type: DataType.STRING(5),
        allowNull: false
    })
    declare language: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string

    @BelongsTo(() => ProcessingCost, "processingCostId")
    declare parentProcessingCost: ProcessingCost
}

export default ProcessingCostTranslation;
