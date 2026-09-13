import { Table, Column, DataType, Model } from "sequelize-typescript";

// Imágenes reemplazables de la landing pública (hero + "quiénes somos" + las 7 líneas de
// producto) desde el panel admin. Cada fila es un "slot" fijo (ver SITE_IMAGE_SLOTS) -- no se
// crean/eliminan slots, solo se sube/reemplaza la imagen de uno existente. Sin BaseCatalogModel:
// no hay concepto de "activo/inactivo" acá, solo "tiene imagen" (imageUrl) o no (null, y el
// frontend público cae al bundled default de esa sección).
export const SITE_IMAGE_SLOTS = [
    "hero",
    "who_we_are",
    "line_fresh",
    "line_frozen",
    "line_hpp",
    "line_snacks",
    "line_shelf",
    "line_foodservice",
    "line_privatelabel",
] as const;
export type SiteImageSlotKey = typeof SITE_IMAGE_SLOTS[number];

@Table({
    tableName: "site_images"
})
class SiteImage extends Model {
    // STRING, no ENUM: sequelize-typescript + sync({alter:true}) genera SQL inválido cuando una
    // columna es ENUM y UNIQUE a la vez -- alter arma "ALTER COLUMN ... TYPE ... UNIQUE USING
    // (...)", y "UNIQUE" no es válido ahí (error 42601 al reiniciar el backend). Los valores
    // permitidos se validan en Zod (siteImageSlotEnum en siteImage.schema.ts), no a nivel de
    // columna. El índice único queda con nombre explícito para que alter no intente
    // recrearlo/duplicarlo en cada startup.
    @Column({
        type: DataType.STRING(30),
        allowNull: false,
        unique: "site_images_slotkey_unique"
    })
    declare slotKey: SiteImageSlotKey

    @Column({
        type: DataType.STRING,
        allowNull: true
    })
    declare imageUrl: string | null

    @Column({
        type: DataType.STRING(150),
        allowNull: true
    })
    declare altText: string | null
}

export default SiteImage;
