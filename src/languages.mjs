/**
 * Narration languages. Each corpus lives in src/data/narration/<code>/ and is built into its own
 * compendium. Adding a language: a corpus folder, an entry here, a pack in module.json.
 */

/**
 * French elision/contraction around inserted values: "de Arwyn" -> "d'Arwyn", "que Ezren" -> "qu'Ezren",
 * "de le kobold" -> "du kobold". Correctly authored text never contains these forms.
 * ponytail: vowel-based, so names starting with an aspirated h are left alone.
 */
export function contractFrench(text) {
    return text
        .replace(/\b([Dd]e|[Qq]ue|[Ll]orsque|[Pp]uisque|[Jj]usque) (?=[aeiouyàâäéèêëîïôöûüAEIOUYÀÂÄÉÈÊËÎÏÔÖÛÜ])/g, (_m, w) => `${w.slice(0, -1)}'`)
        .replace(/\b([Dd])e le /g, "$1u ")
        .replace(/\b([Dd])e les /g, "$1es ")
        .replace(/\bà le /g, "au ")
        .replace(/\bà les /g, "aux ");
}

export const LANGUAGES = {
    en: {
        label: "English",
        fallbacks: { actor: "the character", attacker: "the attacker", target: "their opponent", weapon: "their weapon", origin: "the effect" },
        degrees: { criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" },
        fix: (text) => text,
    },
    fr: {
        label: "Français",
        fallbacks: { actor: "le personnage", attacker: "l'assaillant", target: "son adversaire", weapon: "son arme", origin: "l'effet" },
        degrees: { criticalSuccess: "Réussite critique", success: "Réussite", failure: "Échec", criticalFailure: "Échec critique" },
        fix: contractFrench,
    },
};

export const DEFAULT_LANGUAGE = "en";

/** Narration language for a requested code ("auto" resolves to the UI language), falling back to English. */
export function resolveLanguage(setting, uiLanguage) {
    const code = setting === "auto" ? uiLanguage : setting;
    return LANGUAGES[code] ? code : DEFAULT_LANGUAGE;
}
