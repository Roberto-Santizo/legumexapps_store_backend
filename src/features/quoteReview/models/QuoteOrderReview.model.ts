import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Salesperson from "../../salesperson/models/Salesperson.model";
import Client from "../../client/models/Client.model";
import User from "../../accessControl/user/models/User.model";

// Revisión gerencial de un PEDIDO (todas las líneas con el mismo breakdown.order.id, en `quotes` y en
// `customQuotes`): gerencia define una ganancia por libra y el sistema calcula el precio final. Tabla
// aparte a propósito: no toca las cotizaciones guardadas (su costo congelado sigue intacto) ni las
// métricas que las leen. Una fila por pedido.
// pending = el representante lo envió a revisión; approved = ganancia definida y precio final calculado
// (los pedidos del admin nacen aprobados: el admin define su ganancia al cotizar).
export const QUOTE_ORDER_REVIEW_STATUSES = ["pending", "approved"] as const;
export type QuoteOrderReviewStatus = typeof QUOTE_ORDER_REVIEW_STATUSES[number];

// Aviso por correo a gerencia: el estado de la revisión nunca depende de él (un aviso fallido se
// reenvía desde el admin). not_required = pedido del admin, que no se envía a revisión.
export const QUOTE_REVIEW_NOTIFICATION_STATUSES = ["pending", "sent", "failed", "not_configured", "not_required"] as const;
export type QuoteReviewNotificationStatus = typeof QUOTE_REVIEW_NOTIFICATION_STATUSES[number];

// Envío del PDF con el precio final al cliente al aprobar (con copia al representante). pending = aún
// sin aprobar; sending = un proceso tomó el envío (evita duplicados); not_required = pedido del admin,
// que envía su PDF por su cuenta. Un envío fallido no deshace la aprobación: gerencia lo reenvía.
export const QUOTE_REVIEW_CLIENT_EMAIL_STATUSES = ["pending", "sending", "sent", "failed", "not_required"] as const;
export type QuoteReviewClientEmailStatus = typeof QUOTE_REVIEW_CLIENT_EMAIL_STATUSES[number];

@Table({
    tableName: "quoteOrderReviews",
    indexes: [
        {
            unique: true,
            fields: ["orderId"]
        }
    ]
})
class QuoteOrderReview extends Model {
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare orderId: string

    // Representante que envió el pedido a revisión; null en los pedidos del admin.
    @ForeignKey(() => Salesperson)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare salespersonId: number | null

    // Cliente real del pedido; null para un prospecto (solo productos nuevos).
    @ForeignKey(() => Client)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare clientId: number | null

    @Column({
        type: DataType.STRING(150),
        allowNull: false
    })
    declare clientName: string

    // Correo del cliente para ESTE pedido (el que escribió o confirmó el representante al enviarlo a
    // revisión); null en los pedidos del admin.
    @Column({
        type: DataType.STRING(254),
        allowNull: true
    })
    declare clientEmail: string | null

    @Column({
        type: DataType.ENUM(...QUOTE_ORDER_REVIEW_STATUSES),
        allowNull: false,
        defaultValue: "pending"
    })
    declare status: QuoteOrderReviewStatus

    // Huella de las líneas revisadas (ids y costos congelados). Si el pedido cambia mientras está
    // pendiente, deja de coincidir y la aprobación se rechaza.
    @Column({
        type: DataType.STRING(64),
        allowNull: false
    })
    declare linesDigest: string

    // Ganancia por libra definida al aprobar; null mientras está pendiente.
    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: true
    })
    declare profitPerPound: number | null

    // Resultado de pricing/services/quoteProfit.ts::buildOrderProfit al aprobar (por línea: libras,
    // ganancia y precio final; y los totales del pedido); null mientras está pendiente.
    @Column({
        type: DataType.JSONB,
        allowNull: true
    })
    declare pricing: object | null

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare reviewedByUserId: number | null

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare reviewedAt: Date | null

    @Column({
        type: DataType.ENUM(...QUOTE_REVIEW_NOTIFICATION_STATUSES),
        allowNull: false,
        defaultValue: "pending"
    })
    declare notificationStatus: QuoteReviewNotificationStatus

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0
    })
    declare notificationAttempts: number

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare notifiedAt: Date | null

    @Column({
        type: DataType.ENUM(...QUOTE_REVIEW_CLIENT_EMAIL_STATUSES),
        allowNull: false,
        defaultValue: "pending"
    })
    declare clientEmailStatus: QuoteReviewClientEmailStatus

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare clientEmailedAt: Date | null

    @BelongsTo(() => Salesperson, "salespersonId")
    declare submittingSalesperson: Salesperson | null

    @BelongsTo(() => Client, "clientId")
    declare orderClient: Client | null

    @BelongsTo(() => User, "reviewedByUserId")
    declare reviewingUser: User | null
}

export default QuoteOrderReview;
