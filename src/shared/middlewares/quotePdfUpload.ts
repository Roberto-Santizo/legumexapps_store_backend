import multer from "multer"

// PDF de una cotización generado en el navegador (envío por correo y aprobación de la revisión
// gerencial): en memoria, un solo archivo de hasta 5 MB. El tipo lo valida cada controlador.
export const quotePdfUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single("file")
