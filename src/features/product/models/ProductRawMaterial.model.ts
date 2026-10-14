import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "./Product.model";
import RawMaterial from "../../rawMaterial/models/RawMaterial.model";

@Table({
    tableName: "productRawMaterials",
    indexes: [
        {
            unique: true,
            fields: ["productId", "rawMaterialId"]
        }
    ]
})
class ProductRawMaterial extends BaseCatalogModel {
    @ForeignKey(() => Product)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productId: number

    @ForeignKey(() => RawMaterial)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare rawMaterialId: number

    // % del peso neto fijado por el admin; el cliente nunca puede alterarlo. Las filas activas de un
    // producto deben sumar 100 al cotizar.
    @Column({
        type: DataType.DECIMAL(5, 2),
        allowNull: true
    })
    declare percentage: number

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0
    })
    declare displayOrder: number

    @BelongsTo(() => Product, "productId")
    declare parentProduct: Product

    @BelongsTo(() => RawMaterial, "rawMaterialId")
    declare usedRawMaterial: RawMaterial
}

export default ProductRawMaterial;
