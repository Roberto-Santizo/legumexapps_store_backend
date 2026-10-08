import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Unit from "../../unit/models/Unit.model";
import ProductRawMaterial from "../../product/models/ProductRawMaterial.model";
import RawMaterialTranslation from "./RawMaterialTranslation.model";

@Table({
    tableName: "rawMaterials"
})
class RawMaterial extends BaseCatalogModel {

    @Column({
        type: DataType.STRING(60),
        allowNull: false,
        unique: true,

        validate: {
            notEmpty: true
        }
    })
    declare code: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false,
        unique: true
    })
    declare urlSlug: string

    @Column({
        type: DataType.ENUM("fruit", "vegetable", "pulp", "other"),
        allowNull: false
    })
    declare ingredientType: string

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "isOrganicAvailable"
    })
    declare isOrganic: boolean

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true
    })
    declare isMixable: boolean

    // Costo por libra: la unidad la fija el servidor en cada create/update. costUnit/costUnitId se
    // conservan porque el motor los usa para convertir % -> gramos -> costo.
    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: true
    })
    declare costPerUnit: number

    @ForeignKey(() => Unit)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare costUnitId: number

    @BelongsTo(() => Unit, "costUnitId")
    declare costUnit: Unit

    @HasMany(() => ProductRawMaterial, "rawMaterialId")
    declare productRawMaterials: ProductRawMaterial[]

    @HasMany(() => RawMaterialTranslation, "rawMaterialId")
    declare translations: RawMaterialTranslation[]
}

export default RawMaterial;
