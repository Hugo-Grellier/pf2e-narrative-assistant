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

import { DEGREES } from "./engine.mjs";

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
    // Spell cards and checks without a DC have no outcome. Damage rolls carry the outcome of their attack
    // ("success" after a hit) but are not narrated. An outcome that is not a known degree is not PF2e data
    // (any user can put flags on a chat message) and must not reach the card header.
    if (!flag?.type || flag.type === "damage-roll" || !DEGREES.includes(flag.outcome)) return null;
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
    // ConditionPF2e#rollRecovery: the flat check to end persistent damage, with the condition's damage type.
    if (flag.type === "flat-check" && statistic === "pd-recovery") {
        return { ...context, eventType: "persistent" };
    }

    if (flag.type === "skill-check" || flag.type === "perception-check") {
        return { ...context, eventType: "other", skill: statistic };
    }
    return null; // initiative, counteract, other flat checks
}

/** Health band from PF2e hit points: "critical" at a quarter or less, "bloodied" at half or less, else "fresh". */
export function healthState(hp) {
    if (!hp?.max) return undefined;
    const ratio = hp.value / hp.max;
    if (ratio <= 0.25) return "critical";
    return ratio <= 0.5 ? "bloodied" : "fresh";
}

const CAST_A_SPELL = "origin:action:slug:cast-a-spell";

/**
 * A spell actually cast (not just posted to chat) that has no attack roll and no save, e.g. Heal on an
 * ally or Haste. Spells with a defense are narrated on their attack or save roll instead.
 * PF2e writes `flags.pf2e.origin.rollOptions` ("origin:item:trait:healing", "origin:item:defense:reflex"...)
 * and `flags.pf2e.casting.tradition` on the cast message.
 */
export function extractCastContext(systemFlags, names = {}) {
    const origin = systemFlags?.origin;
    const options = origin?.rollOptions ?? [];
    if (origin?.type !== "spell" || !options.includes(CAST_A_SPELL)) return null;
    if (options.some((o) => o.startsWith("origin:item:defense:"))) return null;
    const traits = simpleSuffixes(options, "origin:item:trait:");
    const tradition = systemFlags.casting?.tradition;
    return {
        eventType: "cast",
        degreeOfSuccess: "success", // a cast has no degree; tables are written for "success"
        rolled: false,
        traits: [...new Set(tradition ? [...traits, tradition] : traits)],
        damageTypes: [],
        targetTraits: [],
        actorConditions: [],
        targetConditions: [],
        rollOptions: options,
        isReroll: false,
        vars: { actor: names.actor, attacker: names.actor, target: names.target, weapon: names.item },
    };
}

/**
 * A creature just dropped to 0 HP. `victim` is "character" (a PC, now dying) or "npc"; `lastHit` is the
 * context of the last roll that hurt it (a hit, a spell attack or a failed save), if the module saw one.
 */
export function finishContext(victim, lastHit, names = {}) {
    const byMagic = lastHit && ["spell", "saving-throw"].includes(lastHit.eventType);
    // The one who dealt the blow: the attacker of a hit, the creature behind a save.
    const attacker = lastHit?.eventType === "saving-throw" ? lastHit.vars?.origin : lastHit?.vars?.attacker;
    return {
        eventType: "finish",
        degreeOfSuccess: "success", // not a roll; tables are written for "success"
        rolled: false,
        victim,
        cause: byMagic ? "magic" : lastHit ? "strike" : undefined,
        range: lastHit?.eventType === "strike" ? lastHit.range : undefined,
        damageTypes: lastHit?.damageTypes ?? [],
        traits: [],
        targetTraits: names.targetTraits ?? [],
        actorConditions: [],
        targetConditions: [],
        rollOptions: [],
        isReroll: false,
        vars: { actor: attacker, attacker, target: names.target, weapon: lastHit?.vars?.weapon },
    };
}

/** An event that is not a roll: a PC back on their feet ("revive"), a combat starting or ending ("combat"). */
export function eventContext(eventType, fields = {}, vars = {}) {
    return {
        eventType,
        degreeOfSuccess: "success", // not a roll; tables are written for "success"
        rolled: false,
        traits: [],
        damageTypes: [],
        targetTraits: [],
        actorConditions: [],
        targetConditions: [],
        rollOptions: [],
        isReroll: false,
        ...fields,
        vars,
    };
}
