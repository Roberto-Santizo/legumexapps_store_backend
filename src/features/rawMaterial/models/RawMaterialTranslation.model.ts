import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import RawMaterial from "./RawMaterial.model";

// Mismo patrón que CategoryTranslation -- ver shared/utils/translation.util.ts.
@Table({
    tableName: "rawMaterialTranslations",
    indexes: [
        {
            unique: true,
            fields: ["rawMaterialId", "language"]
        }
    ]
})
class RawMaterialTranslation extends Model {
    @ForeignKey(() => RawMaterial)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare rawMaterialId: number

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

    @BelongsTo(() => RawMaterial, "rawMaterialId")
    declare parentRawMaterial: RawMaterial
}

export default RawMaterialTranslation;
