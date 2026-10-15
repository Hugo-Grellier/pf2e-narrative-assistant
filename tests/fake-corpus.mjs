// A stand-in corpus built from src/data/rules.json, so the glue tests do not depend on the shipped text:
// every rule gets a table per degree with three entries naming the table, the language and the actors.
import { DEGREES } from "../src/engine.mjs";
import { loadRules } from "../tools/source.mjs";

const SAMPLE = {
    en: (key, i) => `[en] ${key} #${i}: {actor} against {target}.`,
    // « à {target} » and « de {target} » exercise the French contraction (« au », « du »).
    fr: (key, i) => `[fr] ${key} #${i} : {actor} fait face à {target}, loin de {target}.`,
};

export function fakeTables(lang) {
    const tables = [];
    for (const rule of loadRules().values()) {
        const base = { priority: rule.priority ?? 0, gmOnly: !!rule.gmOnly };
        if (rule.slot) {
            tables.push({ ...base, key: rule.key, slot: rule.slot, when: rule.when ?? {}, entries: [{ text: `${lang}:${rule.key}`, weight: 1 }] });
            continue;
        }
        for (const degree of DEGREES) {
            const key = `${rule.key}.${degree}`;
            const entries = [1, 2, 3].map((i) => ({ text: SAMPLE[lang](key, i), weight: 1 }));
            tables.push({ ...base, key, slot: "narration", when: { ...rule.when, degreeOfSuccess: degree }, entries });
        }
    }
    return tables;
}
