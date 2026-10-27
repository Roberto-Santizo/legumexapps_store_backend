import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Packaging from "../../packaging/models/Packaging.model";
import GenericPackagingConfigurationGroup from "./GenericPackagingConfigurationGroup.model";

@Table({
    tableName: "genericPackagingConfigurationMaterials",
    indexes: [
        {
            name: "gpcm_group_packaging_unique",
            unique: true,
            fields: ["configurationGroupId", "packagingId"]
        }
    ]
})
export default class GenericPackagingConfigurationMaterial extends BaseCatalogModel {
    @ForeignKey(() => GenericPackagingConfigurationGroup)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare configurationGroupId: number;

    @ForeignKey(() => Packaging)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare packagingId: number;

    @Column({
        type: DataType.STRING(20),
        allowNull: false
    })
    declare quantityBasis: "per_unit" | "per_intermediate" | "per_box" | "per_pallet";

    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: true
    })
    declare quantityValue: number | null;

    @BelongsTo(() => GenericPackagingConfigurationGroup, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare configurationGroup: GenericPackagingConfigurationGroup;

    @BelongsTo(() => Packaging, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare packaging: Packaging;
}
