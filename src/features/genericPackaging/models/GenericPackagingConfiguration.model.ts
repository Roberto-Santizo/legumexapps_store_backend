import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Category from "../../category/models/Category.model";
import Presentation from "../../presentation/models/Presentation.model";
import GenericPackagingConfigurationGroup from "./GenericPackagingConfigurationGroup.model";

@Table({
    tableName: "genericPackagingConfigurations"
})
export default class GenericPackagingConfiguration extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(60),
        allowNull: false,
        unique: true
    })
    declare reference: string;

    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string;

    @ForeignKey(() => Category)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare categoryId: number;

    @ForeignKey(() => Presentation)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare presentationId: number;

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare bagsPerBox: number;

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare boxesPerPallet: number;

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare unitsPerIntermediatePackage: number | null;

    @BelongsTo(() => Category, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare category: Category;

    @BelongsTo(() => Presentation, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare presentation: Presentation;

    @HasMany(() => GenericPackagingConfigurationGroup, {
        foreignKey: "configurationId",
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare groups: GenericPackagingConfigurationGroup[];
}
