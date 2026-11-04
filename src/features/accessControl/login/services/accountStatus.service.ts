import User from "../../user/models/User.model"
import Salesperson from "../../../salesperson/models/Salesperson.model"
import type { AccountStatusReader } from "../../../../shared/types/express"

export const accountStatusService: AccountStatusReader = {
    async isStaffActive(id) {
        return !!await User.findOne({ where: { id, isActive: true }, attributes: ["id"] })
    },
    async isSalespersonActive(id) {
        return !!await Salesperson.findOne({ where: { id, isActive: true }, attributes: ["id"] })
    },
}
