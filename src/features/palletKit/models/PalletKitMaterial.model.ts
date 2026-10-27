import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Packaging from "../../packaging/models/Packaging.model";

// One row per material in the standard pallet kit; its kit type is the material's own materialType.
// Removing a material from the kit deletes the row: saved quotes keep their own snapshot.
@Table({
    tableName: "palletKitMaterials"
})
export default class PalletKitMaterial extends Model {
    @ForeignKey(() => Packaging)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        unique: true
    })
    declare packagingId: number;

    @BelongsTo(() => Packaging, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare packaging: Packaging;
}
