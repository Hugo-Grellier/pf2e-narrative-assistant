/**
 * Builds one RollTable compendium per narration language.
 *   src/data/rules.json + src/data/narration/<lang>/**.json
 *     -> packs/_source/narration-<lang>/*.json -> packs/narration-<lang> (LevelDB)
 * IDs are derived from the language and the stable table key, so rebuilding never churns them.
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LANGUAGES } from "../src/languages.mjs";
import { corpusLanguages, loadSourceTables } from "./source.mjs";

const MODULE_ID = "pf2e-narrative-assistant";
const ROOT = path.resolve(import.meta.dirname, "..");
const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const idFor = (seed) =>
    [...createHash("sha256").update(seed).digest()].slice(0, 16).map((b) => ALPHANUM[b % ALPHANUM.length]).join("");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));

for (const lang of corpusLanguages()) {
    if (!LANGUAGES[lang]) throw new Error(`narration/${lang}: add the language to src/languages.mjs`);
    if (!manifest.packs.some((p) => p.name === `narration-${lang}`)) throw new Error(`module.json: missing pack narration-${lang}`);
    const SOURCE_OUT = path.join(ROOT, `packs/_source/narration-${lang}`);
    const PACK_OUT = path.join(ROOT, `packs/narration-${lang}`);
    const tables = loadSourceTables(lang);
    fs.rmSync(SOURCE_OUT, { recursive: true, force: true });
    fs.mkdirSync(SOURCE_OUT, { recursive: true });
    const write = (doc) => fs.writeFileSync(path.join(SOURCE_OUT, `${doc._id}.json`), JSON.stringify(doc, null, 2));

    // One folder per top-level label ("Frappes", "Compétences", ...)
    const folders = new Map();
    for (const label of new Set(tables.map((t) => t.label[0]))) {
        const _id = idFor(`${lang}:folder:${label}`);
        folders.set(label, _id);
        write({ _id, _key: `!folders!${_id}`, name: label, type: "RollTable", folder: null, sorting: "a", sort: 0, color: null, flags: {} });
    }

    for (const table of tables) {
        const _id = idFor(`${lang}:${table.key}`);
        const degrees = table.degrees?.map((d) => LANGUAGES[lang].degrees[d]).join(" + ");
        const name = [...table.label, degrees].filter(Boolean).join(" / ");
        let cursor = 1;
        const results = table.entries.map((entry, i) => {
            const range = [cursor, cursor + entry.weight - 1];
            cursor += entry.weight;
            const resultId = idFor(`${lang}:${table.key}#${i}`);
            return {
                _id: resultId,
                _key: `!tables.results!${_id}.${resultId}`,
                type: "text",
                name: "",
                img: "icons/svg/d20-black.svg",
                description: entry.text,
                documentUuid: null,
                weight: entry.weight,
                range,
                drawn: false,
                flags: entry.when ? { [MODULE_ID]: { when: entry.when } } : {},
            };
        });
        write({
            _id,
            _key: `!tables!${_id}`,
            name,
            img: "icons/svg/d20-grey.svg",
            description: "",
            results,
            formula: `1d${cursor - 1}`,
            replacement: true,
            displayRoll: false,
            folder: folders.get(table.label[0]),
            sort: 0,
            ownership: { default: 0 },
            flags: { [MODULE_ID]: { key: table.key, slot: table.slot, when: table.when, priority: table.priority, gmOnly: table.gmOnly, lang } },
        });
    }

    await compilePack(SOURCE_OUT, PACK_OUT);
    const entryCount = tables.reduce((n, t) => n + t.entries.length, 0);
    console.log(`${lang}: packed ${tables.length} tables, ${entryCount} entries into ${path.relative(ROOT, PACK_OUT)}`);
}
