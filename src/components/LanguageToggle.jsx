import { useI18n } from "../i18n/LanguageContext";

export default function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="lang-toggle" role="group" aria-label={t("languageSelectorAria")}>
      <button
        className={`lang-btn ${language === "en" ? "lang-btn-active" : ""}`}
        onClick={() => setLanguage("en")}
        type="button"
      >
        {t("languageEnglish")}
      </button>
      <button
        className={`lang-btn ${language === "ko" ? "lang-btn-active" : ""}`}
        onClick={() => setLanguage("ko")}
        type="button"
      >
        {t("languageKorean")}
      </button>
    </div>
  );
}
