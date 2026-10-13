import assert from "node:assert/strict";
import { test } from "node:test";
import { contractFrench } from "../src/languages.mjs";
import { candidates, createRecentSet, interpolate, matches, narrate, pickEntry, shouldNarrate, specificity } from "../src/engine.mjs";

const t = (key, when, texts, extra = {}) => ({ key, slot: "narration", when, entries: texts.map((text) => ({ text, weight: 1 })), ...extra });

const tables = [
    t("generic.success", { degreeOfSuccess: "success" }, ["generic"]),
    t("strike.success", { eventType: "strike", degreeOfSuccess: "success" }, ["strike"]),
    t("strike.melee.success", { eventType: "strike", range: "melee", degreeOfSuccess: "success" }, ["melee"]),
    t("strike.melee.slashing.success", { eventType: "strike", range: "melee", damageTypes: ["slashing"], degreeOfSuccess: "success" }, ["slashing"]),
    t("strike.melee.piercing.success", { eventType: "strike", range: "melee", damageTypes: ["piercing"], degreeOfSuccess: "success" }, []),
];
const strike = (extra = {}) => ({ eventType: "strike", degreeOfSuccess: "success", range: "melee", damageTypes: ["slashing"], vars: {}, ...extra });
const first = (ctx, list = tables) => narrate(list, ctx, { random: () => 0 })?.text;

test("matches: scalar equality, any-of lists, all-of on list fields, missing fields", () => {
    assert.ok(matches({ eventType: "strike" }, { eventType: "strike" }));
    assert.ok(matches({ save: ["reflex", "will"] }, { save: "will" }));
    assert.ok(matches({ traits: ["fire"] }, { traits: ["fire", "evocation"] }));
    assert.ok(!matches({ traits: ["fire", "cold"] }, { traits: ["fire"] }));
    assert.ok(!matches({ save: "reflex" }, {}));
    assert.ok(matches({ damageTypes: { anyOf: ["bludgeoning", "sonic"] } }, { damageTypes: ["sonic"] }));
    assert.ok(!matches({ damageTypes: { anyOf: ["bludgeoning"] } }, { damageTypes: ["fire"] }));
    assert.ok(matches({}, {}));
});

test("thrown attacks match both ranged and thrown tables; thrown is more specific", () => {
    const ctx = { eventType: "strike", range: "ranged", thrown: true, degreeOfSuccess: "success", vars: {} };
    const list = [
        t("strike.ranged.success", { eventType: "strike", range: "ranged", degreeOfSuccess: "success" }, ["ranged"]),
        t("strike.ranged.thrown.success", { eventType: "strike", range: "ranged", thrown: true, degreeOfSuccess: "success" }, ["thrown"]),
    ];
    assert.equal(first(ctx, list), "Thrown");
    assert.equal(first({ ...ctx, thrown: false }, list), "Ranged");
});

test("any-of degree lists are not over-ranked", () => {
    const list = [
        t("a", { eventType: "skill-check", actionSlug: "tumble-through", degreeOfSuccess: ["success", "criticalSuccess"] }, ["tumble"]),
        t("b", { eventType: "skill-check", degreeOfSuccess: "criticalSuccess" }, ["skill"]),
    ];
    assert.equal(first({ eventType: "skill-check", actionSlug: "tumble-through", degreeOfSuccess: "criticalSuccess", vars: {} }, list), "Tumble");
});

test("most specific table wins", () => {
    assert.equal(first(strike()), "Slashing");
});

test("fallback chain: missing or empty specialised tables fall back without error", () => {
    assert.equal(first(strike({ damageTypes: ["piercing"] })), "Melee"); // piercing table is empty
    assert.equal(first(strike({ damageTypes: ["fire"] })), "Melee");
    assert.equal(first(strike({ range: "ranged", damageTypes: [] })), "Strike");
    assert.equal(first({ eventType: "saving-throw", degreeOfSuccess: "success", vars: {} }), "Generic");
    assert.equal(first(strike({ degreeOfSuccess: "criticalFailure" })), undefined); // nothing at all: null, no throw
});

test("priority breaks specificity", () => {
    const list = [...tables, t("strike.custom", { eventType: "strike" }, ["custom"], { priority: 10 })];
    assert.equal(first(strike(), list), "Custom");
});

test("interpolation: vars, component tables, fallbacks, unknown placeholders", () => {
    const parts = [
        { key: "bp.generic", slot: "bodyPart", when: {}, entries: [{ text: "le flanc" }] },
        { key: "bp.humanoid", slot: "bodyPart", when: { targetTraits: ["humanoid"] }, entries: [{ text: "l'épaule" }] },
    ];
    const ctx = { vars: { attacker: "Valeros" }, targetTraits: ["humanoid"] };
    assert.equal(
        interpolate("{attacker} frappe {target} sur {bodyPart}{nope}.", ctx, { tables: parts, fallbacks: { target: "son adversaire" } }),
        "Valeros frappe son adversaire sur l'épaule.",
    );
    assert.equal(interpolate("Sur {bodyPart}.", { vars: {} }, { tables: parts }), "Sur le flanc.");
});

test("French elision and contraction around inserted names", () => {
    const fix = contractFrench;
    assert.equal(interpolate("La garde de {target} cède.", { vars: { target: "Arwyn" } }, { fix }), "La garde d'Arwyn cède.");
    assert.equal(interpolate("Il faut que {target} recule.", { vars: { target: "Ezren" } }, { fix }), "Il faut qu'Ezren recule.");
    assert.equal(interpolate("La garde de {target} cède.", { vars: {} }, { fix, fallbacks: { target: "le personnage" } }), "La garde du personnage cède.");
    assert.equal(interpolate("La garde de {target} cède.", { vars: { target: "Valeros" } }, { fix }), "La garde de Valeros cède.");
    assert.equal(interpolate("Valeros strikes {target}.", { vars: { target: "Arwyn" } }), "Valeros strikes Arwyn."); // no French rules by default
});

test("interpolation stops on self-referencing components", () => {
    const loop = [{ key: "x", slot: "x", when: {}, entries: [{ text: "a{x}" }] }];
    assert.equal(interpolate("{x}", { vars: {} }, { tables: loop }), "aaa");
});

test("narrate capitalises and avoids recent texts", () => {
    const list = [t("g", {}, ["{target} recule.", "autre"])];
    assert.equal(narrate(list, { vars: { target: "le kobold" } }, { random: () => 0 }).text, "Le kobold recule.");
    const two = [t("g", {}, ["Un cri. {target} recule."])];
    assert.equal(narrate(two, { vars: { target: "le kobold" } }, { random: () => 0 }).text, "Un cri. Le kobold recule.");
    const recent = new Map([["g", ["{target} recule."]]]);
    assert.equal(narrate(list, { vars: {} }, { recent, random: () => 0 }).text, "Autre");
});

test("pickEntry respects weights and never empties the pool", () => {
    const entries = [{ text: "a", weight: 1 }, { text: "b", weight: 3 }];
    assert.equal(pickEntry(entries, { random: () => 0.5 }).text, "b");
    assert.equal(pickEntry(entries, { exclude: ["a", "b"], random: () => 0 }).text, "a");
});

test("shouldNarrate filters", () => {
    const settings = {
        enabled: true,
        events: { strike: true, "skill-check": false },
        chances: { criticalSuccess: 100, success: 30, failure: 100, criticalFailure: 0 },
        disabledActions: ["seek"],
    };
    const roll = (random) => (ctx) => shouldNarrate(ctx, settings, () => random);
    assert.ok(roll(0.99)(strike({ degreeOfSuccess: "criticalSuccess" })));
    assert.ok(!roll(0)(strike({ degreeOfSuccess: "criticalFailure" })), "0% never narrates");
    assert.ok(roll(0.29)(strike()), "30%: a low draw narrates");
    assert.ok(!roll(0.3)(strike()), "30%: a high draw does not");
    assert.ok(!roll(0)({ eventType: "skill-check", degreeOfSuccess: "success" }));
    assert.ok(!roll(0)({ ...strike(), actionSlug: "seek" }));
    assert.ok(!roll(0)(strike({ degreeOfSuccess: null })));
    assert.ok(!shouldNarrate(strike(), { ...settings, enabled: false }, () => 0));
});

test("specificity: named actions, creature types and conditions outrank damage types", () => {
    const s = (when, priority) => specificity({ when, priority });
    const slashing = s({ eventType: "strike", range: "melee", damageTypes: ["slashing"], degreeOfSuccess: "success" });
    assert.equal(slashing, 5);
    assert.ok(s({ eventType: "strike", range: "melee", weaponGroup: "brawling", degreeOfSuccess: "success" }) > slashing);
    assert.ok(s({ eventType: "strike", targetConditions: { anyOf: ["prone"] }, degreeOfSuccess: "success" }) > slashing);
    assert.ok(s({ eventType: "skill-check", actionSlug: "trip", degreeOfSuccess: "success" }) > s({ eventType: "skill-check", degreeOfSuccess: "success" }));
    assert.equal(s({ eventType: "strike" }, 2), 3);
});

test("possessive placeholders", () => {
    const text = "{target's} guard gives way before {attacker's} blade.";
    assert.equal(interpolate(text, { vars: { target: "the kobold", attacker: "Valeros" } }), "the kobold's guard gives way before Valeros' blade.");
    assert.equal(interpolate("{target's} guard.", { vars: {} }, { fallbacks: { target: "their opponent" } }), "their opponent's guard.");
    assert.equal(interpolate("{nope's} guard.", { vars: {} }), "guard.");
});

test("recent set ignores repeats and forgets old ids", () => {
    const set = createRecentSet(2);
    set.add("a");
    set.add("b");
    assert.ok(set.has("a"));
    set.add("c");
    assert.ok(!set.has("a"));
});

test("candidates skips other slots", () => {
    assert.equal(candidates(tables, "bodyPart", strike()).length, 0);
});

test("resolveLanguage: auto follows the UI, unknown falls back to English", async () => {
    const { resolveLanguage } = await import("../src/languages.mjs");
    assert.equal(resolveLanguage("auto", "fr"), "fr");
    assert.equal(resolveLanguage("auto", "de"), "en");
    assert.equal(resolveLanguage("fr", "en"), "fr");
});
