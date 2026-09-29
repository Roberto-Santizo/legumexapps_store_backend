import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Presentation from "../../presentation/models/Presentation.model";

// Presentación ofrecida en cotizaciones a la medida + la composición de palet con la que se
// cotiza. Las cuentas viven acá (no en Presentation) porque en productos definidos viven en cada
// ProductVariant y una Presentation no tiene cuentas propias: el admin las escribe una vez por
// presentación ofrecida. unitsPerIntermediatePackage null = esta presentación no tiene nivel
// intermedio en el flujo a la medida.
@Table({
    tableName: "customQuotePresentationOptions",
    indexes: [
        {
            name: "cqpo_presentation_unique",
            unique: true,
            fields: ["presentationId"]
        }
    ]
})
class CustomQuotePresentationOption extends BaseCatalogModel {
    @ForeignKey(() => Presentation)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare presentationId: number

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare boxesPerPallet: number

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare bagsPerBox: number

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare unitsPerIntermediatePackage: number | null

    @BelongsTo(() => Presentation, "presentationId")
    declare presentation: Presentation
}

export default CustomQuotePresentationOption;
