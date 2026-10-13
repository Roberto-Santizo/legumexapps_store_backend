type PackagingNames = { displayName: string; displayNameEn?: string | null }

// Additive snapshot metadata; legacy snapshots without English remain readable.
export function packagingNames(material: PackagingNames | undefined) {
    return {
        displayName: material?.displayName ?? "",
        ...(material?.displayNameEn?.trim() ? { displayNameEn: material.displayNameEn } : {}),
    }
}

export function packagingName(material: PackagingNames | undefined, language: string) {
    return language.toLowerCase().startsWith("en") && material?.displayNameEn?.trim()
        ? material.displayNameEn : material?.displayName ?? ""
}
