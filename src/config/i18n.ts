import i18next from "i18next"
import middleware from "i18next-http-middleware"
import es from "../locales/es/translation.json"
import en from "../locales/en/translation.json"

i18next.use(middleware.LanguageDetector).init({
    fallbackLng: "es",
    supportedLngs: ["es", "en"],
    preload: ["es", "en"],
    resources: {
        es: { translation: es },
        en: { translation: en },
    },
})

export const i18nextMiddleware = middleware
export default i18next
