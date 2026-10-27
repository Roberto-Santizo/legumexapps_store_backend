import { Transaction } from "sequelize";
import sequelize from "../../../database/connection";
import { AppError } from "../../../shared/errors/AppError";
import Profile from "../models/GenericPackagingConfiguration.model";
import Group from "../models/GenericPackagingConfigurationGroup.model";
import Option from "../models/GenericPackagingConfigurationMaterial.model";
import Category from "../../category/models/Category.model";
import CategoryTranslation from "../../category/models/CategoryTranslation.model";
import Presentation from "../../presentation/models/Presentation.model";
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model";
import Packaging from "../../packaging/models/Packaging.model";
import { genericConfigurationSchema, type GenericConfigurationInput } from "../schemas/genericPackaging.schema";
import { isPalletKitType } from "../../packaging/constants/packagingMaterialType.constant";
import { validateGenericProfile, genericError, type GenericProfile } from "./genericPackagingResolver";
const genericIncludes = [Category, Presentation, { model: Group, include: [PackagingGroup, { model: Option, include: [Packaging] }] }];
export async function loadGenericProfiles(transaction?: Transaction): Promise<GenericProfile[]> {
    const rows = await Profile.findAll({ include: genericIncludes, transaction, order: [["id", "ASC"]] });
    return rows.map(row => {
        const profile = row.toJSON() as GenericProfile;
        profile.groups.sort((a, b) => a.id - b.id).forEach(group => group.options.sort((a, b) => a.id - b.id));
        return profile;
    });
}
export function genericReadiness(profile: GenericProfile) {
    try {
        validateGenericProfile(profile);
        return { ready: true, issues: [] as {
                key: string;
                params?: Record<string, unknown>;
            }[] };
    }
    catch (error) {
        if (error instanceof AppError)
            return { ready: false, issues: [{ key: error.key, params: error.params }] };
        throw error;
    }
}
async function assertGenericReferences(input: GenericConfigurationInput, transaction?: Transaction) {
    const category = await Category.findOne({ where: { id: input.categoryId, isActive: true }, transaction });
    const presentation = await Presentation.findOne({ where: { id: input.presentationId, isActive: true }, transaction });
    if (!category || !presentation)
        genericError("configuration");
    for (const group of input.groups) {
        if (!await PackagingGroup.findOne({ where: { id: group.packagingGroupId, isActive: true }, transaction }))
            genericError("configuration");
        for (const option of group.options) {
            const material = await Packaging.findOne({ where: { id: option.packagingId, isActive: true, classification: "generic", packagingRole: group.level }, transaction });
            if (!material)
                genericError("selection");
            if (isPalletKitType(material?.materialType))
                genericError("pallet_kit");
        }
    }
}
export async function saveGenericProfile(input: GenericConfigurationInput, id?: number, suppliedTransaction?: Transaction): Promise<number> {
    input = genericConfigurationSchema.parse(input);
    const work = async (transaction: Transaction) => {
        await sequelize.query("SELECT pg_advisory_xact_lock(174226, 3)", { transaction });
        await assertGenericReferences(input, transaction);
        const { groups, ...fields } = input;
        let profile: Profile;
        if (id != null) {
            const existing = await Profile.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!existing)
                throw new AppError(404, "errors.generic_packaging_configuration");
            profile = await existing.update(fields, { transaction });
        }
        else
            profile = await Profile.create(fields, { transaction });
        // Soft deactivate removed associations; saved quote snapshots are never rewritten.
        const previousGroups = await Group.findAll({ where: { configurationId: profile.id }, transaction });
        await Group.update({ isActive: false }, { where: { configurationId: profile.id }, transaction });
        for (const old of previousGroups)
            await Option.update({ isActive: false }, { where: { configurationGroupId: old.id }, transaction });
        for (const { options, ...values } of groups) {
            let group = previousGroups.find(row => row.packagingGroupId === values.packagingGroupId && row.level === values.level);
            if (group)
                await group.update({ ...values, isActive: true }, { transaction });
            else
                group = await Group.create({ ...values, configurationId: profile.id, isActive: true }, { transaction });
            for (const values of options) {
                const existing = await Option.findOne({ where: { configurationGroupId: group.id, packagingId: values.packagingId }, transaction });
                if (existing)
                    await existing.update({ ...values, isActive: true }, { transaction });
                else
                    await Option.create({ ...values, configurationGroupId: group.id, isActive: true }, { transaction });
            }
        }
        return profile.id!;
    };
    return suppliedTransaction ? work(suppliedTransaction) : sequelize.transaction(work);
}
export async function genericCatalogOptions(transaction?: Transaction) {
    const [categories, presentations, groups, materials] = await Promise.all([
        Category.findAll({ include: [{ model: CategoryTranslation, as: "translations", separate: true }], transaction, ...(transaction ? { lock: transaction.LOCK.SHARE } : {}), where: { isActive: true }, order: [["displayName", "ASC"]] }),
        Presentation.findAll({ order: [["id", "ASC"]], transaction, ...(transaction ? { lock: transaction.LOCK.SHARE } : {}), where: { isActive: true } }), PackagingGroup.findAll({ order: [["id", "ASC"]], transaction, ...(transaction ? { lock: transaction.LOCK.SHARE } : {}), where: { isActive: true } }),
        Packaging.findAll({ transaction, ...(transaction ? { lock: transaction.LOCK.SHARE } : {}), where: { classification: "generic", isActive: true }, order: [["displayName", "ASC"]] }),
    ]);
    return { categories, presentations, groups, materials };
}
