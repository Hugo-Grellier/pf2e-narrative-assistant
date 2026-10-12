/**
 * Narrative engine: pure functions, no Foundry or PF2e dependency.
 *
 * A "table" is a plain object built from a RollTable (or straight from the source JSON in tests):
 *   { key, slot, when, priority, label, entries: [{ text, weight }] }
 *
 * `slot` is "narration" for the sentence itself, or a component name such as "bodyPart"
 * that templates reference as `{bodyPart}`.
 */

export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

const MAX_DEPTH = 3;

/**
 * Does a `when` predicate match the context?
 * For every key of `when`, compare against `context[key]`:
 * - context value is a list: every wanted value must be present (all-of);
 * - context value is a single value: it must equal the wanted value, or one of them if a list (any-of).
 * - `{ anyOf: [...] }`: at least one of the values is present / equal, whatever the context shape.
 * A key absent from the context never matches.
 */
export function matches(when = {}, context = {}) {
    return Object.entries(when).every(([key, wanted]) => {
        const actual = context[key];
        if (actual === undefined || actual === null) return false;
        if (wanted?.anyOf) return wanted.anyOf.some((w) => [actual].flat().includes(w));
        const wantedList = [wanted].flat();
        if (Array.isArray(actual)) return wantedList.every((w) => actual.includes(w));
        return wantedList.includes(actual);
    });
}

/** One point per condition key, plus the table's explicit priority. */
export function specificity(table) {
    return Object.keys(table.when ?? {}).length + (table.priority ?? 0);
}

/** Matching tables of a slot, most specific first. Empty tables are skipped so fallback continues. */
export function candidates(tables, slot, context) {
    return tables
        .filter((t) => (t.slot ?? "narration") === slot && t.entries?.length && matches(t.when, context))
        .sort((a, b) => specificity(b) - specificity(a) || a.key.localeCompare(b.key));
}

/**
 * Weighted random pick. `exclude` holds recently used texts; it is ignored when it would empty the pool.
 */
export function pickEntry(entries, { exclude = [], random = Math.random } = {}) {
    const fresh = entries.filter((e) => !exclude.includes(e.text));
    const pool = fresh.length ? fresh : entries;
    const total = pool.reduce((sum, e) => sum + (e.weight ?? 1), 0);
    let roll = random() * total;
    for (const entry of pool) {
        roll -= entry.weight ?? 1;
        if (roll < 0) return entry;
    }
    return pool.at(-1);
}

/**
 * Replace `{name}` placeholders. Lookup order:
 * 1. `context.vars[name]`
 * 2. a component table whose slot is `name` (its entry is interpolated too, up to MAX_DEPTH)
 * 3. `fallbacks[name]`
 * Unknown placeholders are dropped rather than shown raw. `fix` applies language grammar (see languages.mjs).
 */
export function interpolate(text, context, { tables = [], fallbacks = {}, fix = (t) => t, random, depth = 0 } = {}) {
    const result = text.replace(/\{(\w+)\}/g, (_match, name) => {
        const value = context.vars?.[name];
        if (value) return value;
        if (depth < MAX_DEPTH) {
            const table = candidates(tables, name, context)[0];
            if (table) {
                const entry = pickEntry(table.entries, { random });
                return interpolate(entry.text, context, { tables, fallbacks, fix, random, depth: depth + 1 });
            }
        }
        return fallbacks[name] ?? "";
    });
    return fix(result).replace(/ {2,}/g, " ").replace(/ ([,.])/g, "$1").trim();
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Full resolution: best narration table, pick an entry, interpolate.
 * `recent` maps a table key to recently used texts, avoided when possible.
 * Returns null when nothing matches (no table at all, not even generic).
 */
export function narrate(tables, context, { exclude = [], recent = new Map(), fallbacks = {}, fix, random } = {}) {
    const table = candidates(tables, "narration", context)[0];
    if (!table) return null;
    const entry = pickEntry(table.entries, { exclude: [...exclude, ...(recent.get(table.key) ?? [])], random });
    const text = capitalize(interpolate(entry.text, context, { tables, fallbacks, fix, random }));
    return { text, tableKey: table.key, rawText: entry.text, gmOnly: !!table.gmOnly };
}

/** Narration filters from settings. `settings` mirrors the module settings (see module.mjs). */
export function shouldNarrate(context, settings) {
    if (!settings.enabled || !context?.degreeOfSuccess) return false;
    if (!settings.events[context.eventType]) return false;
    if (!settings.degrees[context.degreeOfSuccess]) return false;
    if (context.actionSlug && settings.disabledActions.includes(context.actionSlug)) return false;
    const rank = DEGREES.indexOf(context.degreeOfSuccess);
    if (settings.frequency === "successes" && rank < 2) return false;
    if (settings.frequency === "criticals" && rank !== 0 && rank !== 3) return false;
    return true;
}

/** Remembers the last `size` ids; `has(id)` then `add(id)` lets a caller ignore repeats. */
export function createRecentSet(size = 200) {
    const ids = [];
    return {
        has: (id) => ids.includes(id),
        add(id) {
            ids.push(id);
            if (ids.length > size) ids.shift();
        },
    };
}
