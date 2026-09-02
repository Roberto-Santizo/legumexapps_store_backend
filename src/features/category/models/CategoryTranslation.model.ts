import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Category from "./Category.model";

@Table({
    tableName: "categoryTranslations",
    indexes: [
        {
            unique: true,
            fields: ["categoryId", "language"]
        }
    ]
})
class CategoryTranslation extends Model {
    @ForeignKey(() => Category)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare categoryId: number

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

    @BelongsTo(() => Category, "categoryId")
    declare parentCategory: Category
}

export default CategoryTranslation;
