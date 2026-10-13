/**
 * PF2e context extraction: turns `message.flags.pf2e` into a plain NarrativeContext.
 * Pure function over the flag data so it can be tested outside Foundry; document lookups
 * (names) are passed in by the caller.
 *
 * Everything relies on `flags.pf2e.context`, written by PF2e's `Check.roll` (src/module/system/check/check.ts):
 *   type      "attack-roll" | "skill-check" | "perception-check" | "saving-throw" | "flat-check" | ...
 *   outcome   degree of success after adjustments, null when there was no DC
 *   options   the roll options: "action:trip", "item:damage:type:slashing", "target:trait:humanoid", ...
 *   identifier for strikes: "<itemId>.<slug>.<melee|ranged>"
 * Spells add their tradition as a trait ("item:trait:arcane") and their damage types ("item:damage:type:fire").
 */

const SAVES = ["fortitude", "reflex", "will"];

/** Values of every roll option starting with `prefix`, e.g. suffixes(o, "item:trait:") -> ["fire", ...] */
const suffixes = (options, prefix) =>
    options.filter((o) => o.startsWith(prefix)).map((o) => o.slice(prefix.length));

/** Only single-segment values: "item:trait:fire" but not "item:trait:foo:bar". */
const simpleSuffixes = (options, prefix) => suffixes(options, prefix).filter((s) => !s.includes(":"));

/**
 * @param {object} systemFlags  `message.flags.pf2e`
 * @param {object} [names]      { actor, target, item, origin } display names resolved by the caller
 * @returns {object|null} NarrativeContext, or null when the message is not a narratable check
 */
export function extractContext(systemFlags, names = {}) {
    const flag = systemFlags?.context;
    if (!flag?.type || !flag.outcome) return null; // damage rolls, spell cards, checks without a DC
    const options = flag.options ?? [];

    const actionTraits = (flag.traits ?? []).map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean);
    const context = {
        eventType: null,
        degreeOfSuccess: flag.outcome,
        traits: [...new Set([...simpleSuffixes(options, "item:trait:"), ...actionTraits])],
        damageTypes: simpleSuffixes(options, "item:damage:type:"),
        targetTraits: simpleSuffixes(options, "target:trait:"),
        // Conditions already applied by PF2e: "self:condition:frightened", "target:condition:prone".
        actorConditions: simpleSuffixes(options, "self:condition:"),
        targetConditions: simpleSuffixes(options, "target:condition:"),
        rollOptions: options,
        isReroll: !!flag.isReroll,
        vars: {
            actor: names.actor,
            attacker: names.actor,
            target: names.target,
            weapon: names.item,
            origin: names.origin,
        },
    };

    const statistic = simpleSuffixes(options, "check:statistic:")[0];
    const actionSlug = options
        .map((o) => /^action:([a-z0-9-]+)$/.exec(o)?.[1])
        .find((slug) => slug && slug !== "strike");

    if (actionSlug && ["skill-check", "perception-check", "check", "attack-roll"].includes(flag.type)) {
        return { ...context, eventType: "skill-check", actionSlug, skill: statistic };
    }

    if (flag.type === "attack-roll") {
        // Strikes always carry a "<itemId>.<slug>.<melee|ranged>" identifier; spell attacks do not.
        const usage = (flag.identifier ?? "").split(".")[2];
        if (!["melee", "ranged"].includes(usage)) return { ...context, eventType: "spell" };
        const thrown = usage === "ranged" && (flag.altUsage === "thrown" || options.includes("item:thrown"));
        return {
            ...context,
            eventType: "strike",
            range: usage,
            thrown,
            weaponGroup: simpleSuffixes(options, "item:group:")[0],
            weaponCategory: simpleSuffixes(options, "item:category:")[0],
        };
    }

    if (flag.type === "saving-throw" && SAVES.includes(statistic)) {
        return { ...context, eventType: "saving-throw", save: statistic };
    }

    const isRecovery = statistic === "dying-recovery" || (flag.domains ?? []).includes("dying-recovery");
    if (flag.type === "flat-check" && isRecovery) {
        return { ...context, eventType: "recovery" };
    }

    if (flag.type === "skill-check" || flag.type === "perception-check") {
        return { ...context, eventType: "other", skill: statistic };
    }
    return null; // initiative, counteract, other flat checks
}
