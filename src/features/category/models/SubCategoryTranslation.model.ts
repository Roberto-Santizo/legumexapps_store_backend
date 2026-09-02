import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import SubCategory from "./SubCategory.model";

@Table({
    tableName: "subCategoryTranslations",
    indexes: [
        {
            unique: true,
            fields: ["subCategoryId", "language"]
        }
    ]
})
class SubCategoryTranslation extends Model {
    @ForeignKey(() => SubCategory)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare subCategoryId: number

    @Column({
        type: DataType.STRING(5),
        allowNull: false
    })
    declare language: string

    @Column({
        type: DataType.STRING(80),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare fullDescription: string | null

    @BelongsTo(() => SubCategory, "subCategoryId")
    declare parentSubCategory: SubCategory
}

export default SubCategoryTranslation;
