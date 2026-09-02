import { Column, DataType, Model } from "sequelize-typescript";

abstract class BaseCatalogModel extends Model {
    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true
    })
    declare isActive: boolean
}

export default BaseCatalogModel;
