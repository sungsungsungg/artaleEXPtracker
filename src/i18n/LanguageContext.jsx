import { createContext, useContext, useMemo, useState } from "react";
import { translations } from "./translations";

const STORAGE_KEY = "exp_tracker_lang";
const LanguageContext = createContext(null);

function getInitialLanguage() {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "ko" ? "ko" : "en";
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(getInitialLanguage);

  const setAndPersistLanguage = (next) => {
    const safeNext = next === "ko" ? "ko" : "en";
    setLanguage(safeNext);
    window.localStorage.setItem(STORAGE_KEY, safeNext);
  };

  const value = useMemo(() => {
    const t = (key, replacements = null) => {
      const template = translations[language]?.[key] ?? translations.en[key] ?? key;
      if (!replacements) return template;

      return Object.entries(replacements).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        template,
      );
    };

    return { language, setLanguage: setAndPersistLanguage, t };
  }, [language]);

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside LanguageProvider");
  }
  return ctx;
}
