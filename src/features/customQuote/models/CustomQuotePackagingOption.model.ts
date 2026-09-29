import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Packaging from "../../packaging/models/Packaging.model";
import { CUSTOM_QUOTE_QUANTITY_BASES, CustomQuoteQuantityBasis } from "../constants/customQuoteConfig.constant";

// Material de empaque ofrecido en cotizaciones a la medida. El nivel (unit/intermediate/pallet) es
// el packagingRole del Packaging, nunca una columna propia. Mismo modelo de grupos de opciones que
// ProductVariant*Material, pero GLOBAL por nivel (no por SKU): optionGroup null = fila fija (se
// costea siempre); un nombre de grupo = alternativa dentro de ese grupo, con un isDefault por grupo.
// quantity/quantityBasis: ver customQuoteConfig.constant.ts (null en el nivel intermedio).
@Table({
    tableName: "customQuotePackagingOptions",
    indexes: [
        {
            name: "cqpko_packaging_unique",
            unique: true,
            fields: ["packagingId"]
        }
    ]
})
class CustomQuotePackagingOption extends BaseCatalogModel {
    @ForeignKey(() => Packaging)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare packagingId: number

    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: true
    })
    declare quantity: number | null

    @Column({
        type: DataType.ENUM(...CUSTOM_QUOTE_QUANTITY_BASES),
        allowNull: true
    })
    declare quantityBasis: CustomQuoteQuantityBasis | null

    @Column({
        type: DataType.STRING(60),
        allowNull: true
    })
    declare optionGroup: string | null

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare isDefault: boolean

    @BelongsTo(() => Packaging, "packagingId")
    declare packaging: Packaging
}

export default CustomQuotePackagingOption;
