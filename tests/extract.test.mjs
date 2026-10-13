import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCastContext, extractContext, finishContext, healthState } from "../src/extract.mjs";

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

test("conditions of the roller and the target, without their values", () => {
    const ctx = extractContext(flags({
        type: "attack-roll",
        identifier: "x.longsword.melee",
        outcome: "success",
        options: ["self:condition:frightened", "self:condition:frightened:2", "target:condition:prone", "target:condition:off-guard"],
    }));
    assert.deepEqual(ctx.actorConditions, ["frightened"]);
    assert.deepEqual(ctx.targetConditions, ["prone", "off-guard"]);
});

test("health bands", () => {
    assert.equal(healthState({ value: 30, max: 30 }), "fresh");
    assert.equal(healthState({ value: 15, max: 30 }), "bloodied");
    assert.equal(healthState({ value: 7, max: 30 }), "critical");
    assert.equal(healthState(null), undefined);
    assert.equal(healthState({ value: 0, max: 0 }), undefined);
});

test("spell casts: only real casts without an attack or a save", () => {
    const cast = (options, tradition = "divine") => ({
        origin: { type: "spell", uuid: "x", rollOptions: ["origin:action:slug:cast-a-spell", ...options] },
        casting: { id: "e", tradition },
    });
    const heal = extractCastContext(cast(["origin:item:trait:healing", "origin:item:trait:vitality"]), { actor: "Kyra", item: "Heal" });
    assert.equal(heal.eventType, "cast");
    assert.equal(heal.rolled, false);
    assert.deepEqual(heal.traits.sort(), ["divine", "healing", "vitality"]);
    assert.equal(heal.vars.weapon, "Heal");
    assert.equal(extractCastContext(cast(["origin:item:defense:reflex"])), null, "save spells narrate on the save");
    assert.equal(extractCastContext(cast(["origin:item:defense:ac"])), null, "attack spells narrate on the attack");
    assert.equal(extractCastContext({ origin: { type: "spell", rollOptions: [] } }), null, "posted to chat, not cast");
    assert.equal(extractCastContext({ origin: { type: "weapon", rollOptions: ["origin:action:slug:cast-a-spell"] } }), null);
});

test("finishing blow context names who dealt it", () => {
    const strike = { eventType: "strike", range: "ranged", damageTypes: ["piercing"], vars: { attacker: "Kyra", weapon: "Shortbow" } };
    const byArrow = finishContext("npc", strike, { target: "the goblin" });
    assert.deepEqual([byArrow.victim, byArrow.cause, byArrow.range, byArrow.vars.attacker], ["npc", "strike", "ranged", "Kyra"]);
    const bySave = finishContext("character", { eventType: "saving-throw", vars: { actor: "Valeros", origin: "the dragon" } }, { target: "Valeros" });
    assert.deepEqual([bySave.cause, bySave.vars.attacker], ["magic", "the dragon"]);
    assert.equal(finishContext("npc", undefined, {}).cause, undefined);
});

test("persistent damage flat check carries the damage type", () => {
    const context = extractContext({ context: { type: "flat-check", outcome: "failure", options: ["check:statistic:pd-recovery", "item:damage:type:fire", "item:slug:persistent-damage"] } });
    assert.equal(context.eventType, "persistent");
    assert.deepEqual(context.damageTypes, ["fire"]);
});
