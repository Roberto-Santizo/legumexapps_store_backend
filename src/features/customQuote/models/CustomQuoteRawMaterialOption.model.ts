import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import SubCategory from "../../category/models/SubCategory.model";
import RawMaterial from "../../rawMaterial/models/RawMaterial.model";

// Materia prima que un representante puede elegir al armar un producto a la medida dentro de una
// subcategoría (lista de permitidos por subcategoría). min/max opcionales = 0 / 100. La asociación
// se llama usedRawMaterial a propósito: la misma forma que ProductRawMaterial, así una fila cumple
// RawMaterialPoolEntry (quoteCostLines.ts) y sirve de pool para buildCustomizableRawMaterials.
@Table({
    tableName: "customQuoteRawMaterialOptions",
    indexes: [
        {
            name: "cqrmo_subcategory_raw_material_unique",
            unique: true,
            fields: ["subCategoryId", "rawMaterialId"]
        }
    ]
})
class CustomQuoteRawMaterialOption extends BaseCatalogModel {
    @ForeignKey(() => SubCategory)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare subCategoryId: number

    @ForeignKey(() => RawMaterial)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare rawMaterialId: number

    @Column({
        type: DataType.DECIMAL(5, 2),
        allowNull: true
    })
    declare minPercentage: number | null

    @Column({
        type: DataType.DECIMAL(5, 2),
        allowNull: true
    })
    declare maxPercentage: number | null

    @BelongsTo(() => SubCategory, "subCategoryId")
    declare subCategory: SubCategory

    @BelongsTo(() => RawMaterial, "rawMaterialId")
    declare usedRawMaterial: RawMaterial
}

export default CustomQuoteRawMaterialOption;
