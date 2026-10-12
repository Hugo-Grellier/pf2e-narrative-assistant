/**
 * Reads the human-edited sources into plain engine tables, per language.
 * Shared by the pack builder and the tests, so both see exactly what ships.
 *
 * src/data/rules.json: when a category applies, shared by every language
 *   [{ key, when?, priority?, gmOnly?, slot? }]   slot set = component table, absent = narration
 *
 * src/data/narration/<lang>/**.json: the text, one definition or an array of them
 *   narration: { key, label: [...], outcomes: { criticalSuccess: [...], "success,criticalSuccess": [...] } }
 *              -> one table per outcome key, key "<key>.<degrees joined by +>"
 *   component: { key, label: [...], entries: [...] }
 * An entry is a string or { text, weight }.
 */
import fs from "node:fs";
import path from "node:path";
import { DEGREES } from "../src/engine.mjs";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data");
export const RULES_FILE = path.join(DATA_DIR, "rules.json");
export const corpusDir = (lang) => path.join(DATA_DIR, "narration", lang);

const toEntry = (e) => (typeof e === "string" ? { text: e, weight: 1 } : { weight: 1, ...e });

function* walk(dir) {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, dirent.name);
        if (dirent.isDirectory()) yield* walk(full);
        else if (dirent.name.endsWith(".json")) yield full;
    }
}

const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(`${path.relative(DATA_DIR, file)}: ${error.message}`);
    }
};

export function loadRules() {
    const rules = new Map();
    for (const rule of readJson(RULES_FILE)) {
        if (rules.has(rule.key)) throw new Error(`rules.json: duplicate key ${rule.key}`);
        rules.set(rule.key, rule);
    }
    return rules;
}

export function definitionToTables(def, rule) {
    const base = { label: def.label, priority: rule.priority ?? 0, gmOnly: !!rule.gmOnly };
    if (rule.slot) {
        if (!def.entries) throw new Error(`${def.key}: component tables need "entries"`);
        return [{ ...base, key: def.key, slot: rule.slot, when: rule.when ?? {}, entries: def.entries.map(toEntry) }];
    }
    if (!def.outcomes) throw new Error(`${def.key}: narration tables need "outcomes"`);
    return Object.entries(def.outcomes).filter(([, texts]) => texts?.length).map(([outcome, texts]) => {
        const degrees = outcome.split(",").map((d) => d.trim());
        const unknown = degrees.filter((d) => !DEGREES.includes(d));
        if (unknown.length) throw new Error(`${def.key}: unknown outcome(s) ${unknown.join(", ")}`);
        return {
            ...base,
            key: `${def.key}.${degrees.join("+")}`,
            slot: "narration",
            degrees,
            when: { ...rule.when, degreeOfSuccess: degrees.length === 1 ? degrees[0] : degrees },
            entries: texts.map(toEntry),
        };
    });
}

export function loadSourceTables(lang = "fr") {
    const rules = loadRules();
    const tables = [];
    const seen = new Set();
    for (const file of walk(corpusDir(lang))) {
        for (const def of [readJson(file)].flat()) {
            const rule = rules.get(def.key);
            if (!rule) throw new Error(`${lang}/${path.relative(corpusDir(lang), file)}: "${def.key}" is not in rules.json`);
            if (seen.has(def.key)) throw new Error(`${lang}: "${def.key}" defined twice`);
            seen.add(def.key);
            tables.push(...definitionToTables(def, rule));
        }
    }
    return tables;
}

export const corpusLanguages = () =>
    fs.readdirSync(path.join(DATA_DIR, "narration"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
