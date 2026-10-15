/**
 * Lists, per language, the outcomes and components that have no text yet.
 *
 *   npm run coverage            all languages
 *   npm run coverage -- fr      one language
 */
import { corpusLanguages, emptySlots, loadSourceTables } from "./source.mjs";

for (const lang of process.argv[2] ? [process.argv[2]] : corpusLanguages()) {
    const missing = emptySlots(lang);
    const entries = loadSourceTables(lang).reduce((n, t) => n + t.entries.length, 0);
    console.log(`${lang}: ${entries} entries, ${missing.length} outcomes without text`);
    for (const key of missing) console.log(`  ${key}`);
}
