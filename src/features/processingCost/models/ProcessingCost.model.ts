import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProcessingCostTranslation from "./ProcessingCostTranslation.model";

// Catálogo "Costos adicionales" (nombre de negocio) -- costos de proceso por peso (energía, mano
// de obra indirecta, análisis de laboratorio, almacenaje, mantenimiento) que se suman a CADA
// cotización sobre el peso total de materia prima. Se llama "ProcessingCost" en el código (no
// "AdditionalCost") a propósito: el repo ya tiene un concepto distinto y no relacionado llamado
// `Product.additionalCostPerUnit` (un ajuste plano por producto, expuesto como "adjustment"/
// "adjustmentCost" en quote.service.ts) -- usar el mismo nombre habría creado dos conceptos de
// "costo adicional" indistinguibles en el código. La etiqueta que ve el admin sigue siendo
// "Costos adicionales" (ver locales), solo el nombre técnico difiere.
@Table({
    tableName: "processingCosts"
})
class ProcessingCost extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string

    // Monto en Quetzales. Por ahora SIEMPRE "por libra" (ver quote.service.ts) -- no hay un
    // campo de unidad de costeo aquí como en Ingredient/Packaging porque el negocio define este
    // catálogo específicamente como costos por libra de materia prima, no un costeo genérico.
    // DECIMAL(10,4) igual que Packaging.unitCost/Destination.baseCost -- alimenta el motor de
    // cotización, mismo criterio de precisión (ver shared/utils/money.util.ts).
    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: false
    })
    declare value: number

    // "per_weight" es el único tipo implementado hoy (ver quoteService.calculateQuote).
    // "percentage" queda definido como placeholder a propósito para un futuro costo de
    // "contingencia 2%" -- el modelo/enum lo admite, pero NINGÚN cálculo lo usa todavía. No
    // remover ni "completar" esta rama sin que el usuario lo pida explícitamente (Fase futura).
    @Column({
        type: DataType.ENUM("per_weight", "percentage"),
        allowNull: false,
        defaultValue: "per_weight"
    })
    declare calculationType: string

    @HasMany(() => ProcessingCostTranslation, "processingCostId")
    declare translations: ProcessingCostTranslation[]
}

export default ProcessingCost;
