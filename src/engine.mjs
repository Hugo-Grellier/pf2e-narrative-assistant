/**
 * Narrative engine: pure functions, no Foundry or PF2e dependency.
 *
 * A "table" is a plain object built from a RollTable (or straight from the source JSON in tests):
 *   { key, slot, when, priority, label, entries: [{ text, weight, when? }] }
 * An entry's own `when` restricts it further (a text about the target's guard needs a target with one).
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

/**
 * How much each condition key narrows a match. Broad keys (event, range, degree) count 1; a named action,
 * a weapon group, a creature type or a condition says much more about the scene, so it outranks a damage type.
 * Unlisted keys count 1.
 */
export const KEY_WEIGHTS = {
    damageTypes: 2,
    traits: 2,
    thrown: 2,
    weaponGroup: 3,
    targetTraits: 3,
    targetHealth: 3,
    actionSlug: 4,
    streak: 4,
    targetConditions: 4,
    actorConditions: 4,
};

/** Sum of the weights of the `when` keys, plus the table's explicit priority. */
export function specificity(table) {
    return Object.keys(table.when ?? {}).reduce((sum, key) => sum + (KEY_WEIGHTS[key] ?? 1), 0) + (table.priority ?? 0);
}

/** Entries of a table usable in this context. */
export const usableEntries = (table, context) => (table.entries ?? []).filter((e) => !e.when || matches(e.when, context));

/** Matching tables of a slot, most specific first. Tables with no usable entry are skipped so fallback continues. */
export function candidates(tables, slot, context) {
    return tables
        .filter((t) => (t.slot ?? "narration") === slot && matches(t.when, context) && usableEntries(t, context).length)
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

/** English possessive: "Valeros" -> "Valeros'", "the kobold" -> "the kobold's". */
export const englishPossessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * Replace `{name}` placeholders. Lookup order:
 * 1. `context.vars[name]`
 * 2. a component table whose slot is `name` (its entry is interpolated too, up to MAX_DEPTH)
 * 3. `fallbacks[name]`
 * `{name's}` inserts the possessive form of the value (see `possessive`).
 * Unknown placeholders are dropped rather than shown raw. `fix` applies language grammar (see languages.mjs).
 */
export function interpolate(text, context, { tables = [], fallbacks = {}, fix = (t) => t, possessive = englishPossessive, random, depth = 0 } = {}) {
    const options = { tables, fallbacks, fix, possessive, random, depth: depth + 1 };
    const result = text.replace(/\{(\w+)('s)?\}/g, (_match, name, owner) => {
        const value = resolve(name);
        return owner && value ? possessive(value) : value;
    });
    function resolve(name) {
        const value = context.vars?.[name];
        if (value) return value;
        if (depth < MAX_DEPTH) {
            const table = candidates(tables, name, context)[0];
            if (table) return interpolate(pickEntry(usableEntries(table, context), { random }).text, context, options);
        }
        return fallbacks[name] ?? "";
    }
    return fix(result).replace(/ {2,}/g, " ").replace(/ ([,.])/g, "$1").trim();
}

/** Capitalise every sentence start: a name such as "the kobold" may open one. */
const capitalize = (s) => s.replace(/(^|[.!?…] )(\p{Ll})/gu, (_m, before, letter) => before + letter.toUpperCase());

/**
 * Full resolution: best narration table, pick an entry, interpolate.
 * `recent` maps a table key to recently used texts, avoided when possible.
 * Returns null when nothing matches (no table at all, not even generic).
 */
export function narrate(tables, context, { exclude = [], recent = new Map(), fallbacks = {}, fix, possessive, random } = {}) {
    const table = candidates(tables, "narration", context)[0];
    if (!table) return null;
    const entry = pickEntry(usableEntries(table, context), { exclude: [...exclude, ...(recent.get(table.key) ?? [])], random });
    const text = capitalize(interpolate(entry.text, context, { tables, fallbacks, fix, possessive, random }));
    return { text, tableKey: table.key, rawText: entry.text, gmOnly: !!table.gmOnly };
}

/**
 * Narration filters from settings. `settings` mirrors the module settings (see module.mjs);
 * `settings.chances[degree]` is the percentage of rolls of that degree that get a narration. Events that
 * are not rolls (`rolled: false`: spell casts, finishing blows) only follow their event setting.
 */
export function shouldNarrate(context, settings, random = Math.random) {
    if (!settings.enabled || !context?.degreeOfSuccess) return false;
    if (!settings.events[context.eventType]) return false;
    if (context.actionSlug && settings.disabledActions.includes(context.actionSlug)) return false;
    if (context.rolled === false) return true;
    return random() * 100 < (settings.chances[context.degreeOfSuccess] ?? 100);
}

const isHit = (degree) => degree === "success" || degree === "criticalSuccess";

/**
 * Strike streak from one attacker's recent outcomes, oldest first: "comeback" for a critical success right
 * after a critical failure, "hits" / "misses" on every third hit / miss in a row (3rd, 6th...), else undefined.
 */
export function streakOf(degrees) {
    const last = degrees.at(-1);
    if (!last) return undefined;
    if (last === "criticalSuccess" && degrees.at(-2) === "criticalFailure") return "comeback";
    let run = 0;
    for (let i = degrees.length - 1; i >= 0 && isHit(degrees[i]) === isHit(last); i--) run++;
    if (run < 3 || run % 3 !== 0) return undefined;
    return isHit(last) ? "hits" : "misses";
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
