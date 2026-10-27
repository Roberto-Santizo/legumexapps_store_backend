import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model";
import GenericPackagingConfiguration from "./GenericPackagingConfiguration.model";
import GenericPackagingConfigurationMaterial from "./GenericPackagingConfigurationMaterial.model";

@Table({
    tableName: "genericPackagingConfigurationGroups",
    indexes: [
        {
            name: "gpcg_configuration_group_level_unique",
            unique: true,
            fields: ["configurationId", "packagingGroupId", "level"]
        }
    ]
})
export default class GenericPackagingConfigurationGroup extends BaseCatalogModel {
    @ForeignKey(() => GenericPackagingConfiguration)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare configurationId: number;

    @ForeignKey(() => PackagingGroup)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare packagingGroupId: number;

    @Column({
        type: DataType.STRING(12),
        allowNull: false
    })
    declare level: "unit" | "intermediate" | "pallet";

    @Column({
        type: DataType.STRING(3),
        allowNull: false
    })
    declare selectionMode: "one" | "all";

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false
    })
    declare isRequired: boolean;

    @BelongsTo(() => GenericPackagingConfiguration, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare configuration: GenericPackagingConfiguration;

    @BelongsTo(() => PackagingGroup, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare group: PackagingGroup;

    @HasMany(() => GenericPackagingConfigurationMaterial, {
        foreignKey: "configurationGroupId",
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare options: GenericPackagingConfigurationMaterial[];
}
