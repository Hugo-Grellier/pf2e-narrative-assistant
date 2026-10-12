import assert from "node:assert/strict";
import { test } from "node:test";
import { extractContext } from "../src/extract.mjs";

// Shapes mirror `flags.pf2e.context` as written by PF2e 8.6 Check.roll.
const flags = (context) => ({ context: { options: [], traits: [], domains: [], ...context } });

test("melee Strike: degree, range, damage type, group, target traits", () => {
    const ctx = extractContext(
        flags({
            type: "attack-roll",
            identifier: "abc123.longsword.melee",
            outcome: "criticalSuccess",
            traits: ["attack"],
            options: [
                "action:strike",
                "item:damage:type:slashing",
                "item:group:sword",
                "item:category:martial",
                "item:trait:versatile-p",
                "target:trait:humanoid",
            ],
        }),
        { actor: "Valeros", target: "Kobold", item: "Épée longue" },
    );
    assert.equal(ctx.eventType, "strike");
    assert.equal(ctx.degreeOfSuccess, "criticalSuccess");
    assert.equal(ctx.range, "melee");
    assert.deepEqual(ctx.damageTypes, ["slashing"]);
    assert.equal(ctx.weaponGroup, "sword");
    assert.equal(ctx.weaponCategory, "martial");
    assert.deepEqual(ctx.targetTraits, ["humanoid"]);
    assert.ok(ctx.traits.includes("attack") && ctx.traits.includes("versatile-p"));
    assert.equal(ctx.vars.attacker, "Valeros");
    assert.equal(ctx.vars.weapon, "Épée longue");
});

test("thrown Strike is ranged + thrown", () => {
    const ctx = extractContext(flags({ type: "attack-roll", identifier: "x.dagger.ranged", outcome: "success", altUsage: "thrown" }));
    assert.equal(ctx.range, "ranged");
    assert.equal(ctx.thrown, true);
    const bow = extractContext(flags({ type: "attack-roll", identifier: "x.longbow.ranged", outcome: "failure" }));
    assert.equal(bow.thrown, false);
});

test("no outcome (no target / no DC) and damage rolls are ignored", () => {
    assert.equal(extractContext(flags({ type: "attack-roll", identifier: "x.y.melee", outcome: null })), null);
    assert.equal(extractContext(flags({ type: "damage-roll", outcome: "success" })), null);
    assert.equal(extractContext({}), null);
    assert.equal(extractContext(undefined), null);
});

test("skill actions use the action roll option, not names", () => {
    const trip = extractContext(flags({ type: "skill-check", outcome: "success", options: ["action:trip", "check:statistic:athletics", "inflicts:prone"] }));
    assert.equal(trip.eventType, "skill-check");
    assert.equal(trip.actionSlug, "trip");
    assert.equal(trip.skill, "athletics");

    const rk = extractContext(flags({ type: "skill-check", outcome: "criticalSuccess", options: ["action:recall-knowledge", "action:recall-knowledge:arcana", "check:statistic:arcana"] }));
    assert.equal(rk.actionSlug, "recall-knowledge");

    const seek = extractContext(flags({ type: "perception-check", outcome: "failure", options: ["action:seek", "check:statistic:perception"] }));
    assert.equal(seek.actionSlug, "seek");
});

test("Escape rolled with an unarmed attack is still Escape, not a Strike", () => {
    const ctx = extractContext(flags({ type: "attack-roll", identifier: "x.fist.melee", outcome: "success", options: ["action:escape", "action:strike"] }));
    assert.equal(ctx.eventType, "skill-check");
    assert.equal(ctx.actionSlug, "escape");
});

test("saving throws carry save and origin traits", () => {
    const ctx = extractContext(flags({ type: "saving-throw", outcome: "failure", options: ["check:statistic:reflex", "item:trait:fire", "item:damage:type:fire", "item:trait:arcane"] }));
    assert.equal(ctx.eventType, "saving-throw");
    assert.equal(ctx.save, "reflex");
    assert.ok(ctx.traits.includes("fire"));
    assert.deepEqual(ctx.damageTypes, ["fire"]);
});

test("recovery check", () => {
    const ctx = extractContext(flags({ type: "flat-check", outcome: "criticalSuccess", options: ["check:statistic:dying-recovery"] }));
    assert.equal(ctx.eventType, "recovery");
    assert.equal(extractContext(flags({ type: "flat-check", outcome: "success", options: ["check:statistic:flat"] })), null);
});

test("plain skill checks without an action are 'other'; spell attacks are 'spell'; initiative ignored", () => {
    assert.equal(extractContext(flags({ type: "skill-check", outcome: "success", options: ["check:statistic:society"] })).eventType, "other");
    assert.equal(extractContext(flags({ type: "attack-roll", identifier: null, outcome: "success" })).eventType, "spell");
    assert.equal(extractContext(flags({ type: "initiative", outcome: "success" })), null);
});

test("ignores nested trait options and object-shaped action traits", () => {
    const ctx = extractContext(flags({ type: "saving-throw", outcome: "success", traits: [{ name: "mental" }], options: ["check:statistic:will", "item:trait:fear", "item:trait:x:y"] }));
    assert.deepEqual(ctx.traits.sort(), ["fear", "mental"]);
});
