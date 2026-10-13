// Runs src/module.mjs against a minimal fake of the Foundry/PF2e globals it touches.
// Not a substitute for a real Foundry session (see docs/MANUAL-TESTS.md), but it exercises the glue code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeTables } from "./fake-corpus.mjs";

const ID = "pf2e-narrative-assistant";
const handlers = new Map();
const on = (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]);
const fire = (name, ...args) => (handlers.get(name) ?? []).map((fn) => fn(...args));

const settings = new Map();
const onChange = new Map();
const created = [];
const gm = { id: "gm1", isGM: true, isActiveGM: true };

// Packs hold RollTables shaped like the build output: flags + results with a description. The text is a
// stand-in built from the rules (tests/fake-corpus.mjs); the shipped corpus has its own tests.
const docsFor = (lang) => fakeTables(lang).map((t) => ({
    flags: { [ID]: { key: t.key, slot: t.slot, when: t.when, priority: t.priority, gmOnly: t.gmOnly, lang } },
    results: { contents: t.entries.map((e) => ({ description: e.text, name: "", weight: e.weight, flags: e.when ? { [ID]: { when: e.when } } : {} })) },
}));

globalThis.Hooks = { on, once: on, off: () => {}, call: (name, ...args) => !fire(name, ...args).includes(false) };
globalThis.foundry = {
    utils: {
        escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
        getProperty: (object, path) => path.split(".").reduce((o, k) => o?.[k], object),
    },
};
globalThis.CONFIG = { PF2E: { saves: { reflex: "PF2E.SavesReflex" } }, queries: {} };
globalThis.fromUuidSync = () => null;
globalThis.ui = { notifications: { info: () => {} } };
globalThis.ChatMessage = {
    create: async (data) => {
        const message = { ...data, id: `m${created.length}`, author: game.user, update: async (u) => Object.assign(message, u) };
        created.push(message);
        return message;
    },
    getSpeaker: () => ({ alias: "GM" }),
};
globalThis.game = {
    system: { id: "pf2e" },
    user: gm,
    users: [gm, { id: "p1", isGM: false }],
    i18n: { lang: "fr", localize: (k) => k },
    settings: {
        register: (_ns, key, data) => {
            settings.set(key, data.default);
            if (data.onChange) onChange.set(key, data.onChange);
        },
        get: (_ns, key) => settings.get(key),
        set: async (_ns, key, value) => {
            settings.set(key, value);
            onChange.get(key)?.(value);
        },
    },
    modules: new Map([[ID, {}]]),
    packs: new Map(["en", "fr"].map((lang) => [`${ID}.narration-${lang}`, { getDocuments: async () => docsFor(lang) }])),
    tables: [],
    pf2e: { actions: new Map([["trip", { name: "PF2E.Actions.Trip.Title" }]]) },
};

// Foundry's chat log: a collection with `contents`, oldest first.
class Messages extends Map {
    get contents() {
        return [...this.values()];
    }
}
game.messages = new Messages();

await import("../src/module.mjs");
fire("init");
fire("ready");
settings.set("saveGroupDelay", 0); // grouping has its own test

const pf2eMessage = (id, context, extra = {}) => ({
    id,
    flags: { pf2e: { context: { options: [], traits: [], ...context } } },
    speaker: { alias: "Valeros" },
    whisper: [],
    blind: false,
    rolls: [],
    target: { token: { name: "Kobold" } },
    item: { name: "Épée longue" },
    ...extra,
});
const createAndWait = async (message) => {
    game.messages.set(message.id, message);
    return Promise.all(fire("createChatMessage", message));
};
const fireAndWait = async (name, ...args) => Promise.all(fire(name, ...args));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

globalThis.HTMLElement = class {};
/** Renders `card` and clicks the button carrying `dataset`. */
async function click(card, dataset) {
    const listeners = [];
    const button = { dataset, addEventListener: (_e, fn) => listeners.push(fn) };
    fire("renderChatMessageHTML", card, Object.assign(new HTMLElement(), { querySelectorAll: () => [button] }));
    await listeners[0]({ preventDefault() {} });
}

test("a Strike creates one GM-whispered suggestion with a stored context", async () => {
    created.length = 0;
    await createAndWait(pf2eMessage("s1", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "criticalSuccess", options: ["item:damage:type:slashing", "target:trait:humanoid"] }));
    assert.equal(created.length, 1);
    const [card] = created;
    assert.deepEqual(card.whisper, ["gm1"]);
    assert.match(card.content, /PF2E\.Check\.Result\.Degree\.Attack\.criticalSuccess · Épée longue/);
    const [line] = card.flags[ID].lines;
    assert.match(line.tableKey, /^strike\.melee\.slashing\.criticalSuccess$/);
    assert.ok(!/\{[\w']+\}/.test(line.text), line.text);
    assert.equal(line.sourceId, "s1");
    assert.match(card.content, /data-pf2e-na="source" data-message-id="s1"/);
    assert.match(card.content, /data-pf2e-na="publish"/);
});

test("the same message, damage rolls and our own cards are not narrated", async () => {
    created.length = 0;
    await createAndWait(pf2eMessage("s1", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "success" }));
    await createAndWait(pf2eMessage("d1", { type: "damage-roll", outcome: "success" }));
    await createAndWait({ ...pf2eMessage("o1", { type: "attack-roll", identifier: "a.b.melee", outcome: "success" }), flags: { [ID]: {}, pf2e: {} } });
    assert.equal(created.length, 0);
});

test("non-active GM clients do nothing", async () => {
    created.length = 0;
    gm.isActiveGM = false;
    await createAndWait(pf2eMessage("s2", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "success" }));
    gm.isActiveGM = true;
    assert.equal(created.length, 0);
});

test("public output stays private for secret rolls and GM-only prompts", async () => {
    settings.set("output", "public");
    created.length = 0;
    await createAndWait(pf2eMessage("rk1", { type: "skill-check", outcome: "success", options: ["action:recall-knowledge", "check:statistic:arcana"] }));
    await createAndWait(pf2eMessage("h1", { type: "skill-check", outcome: "success", options: ["action:hide"] }, { blind: true }));
    await createAndWait(pf2eMessage("t1", { type: "skill-check", outcome: "success", options: ["action:trip"] }));
    settings.set("output", "whisper");
    assert.deepEqual(created.map((m) => m.whisper.length > 0), [true, true, false]);
    assert.ok(!created[0].content.includes('data-pf2e-na="publish"'));
});

test("reroll replaces only the narration text", async () => {
    created.length = 0;
    await createAndWait(pf2eMessage("s3", { type: "saving-throw", outcome: "failure", options: ["check:statistic:reflex", "item:trait:fire"] }));
    const [card] = created;
    const before = card.flags[ID].lines[0].text;
    await click(card, { pf2eNa: "reroll" });
    assert.equal(created.length, 1, "no new message");
    const [line] = card[`flags.${ID}.lines`];
    assert.notEqual(line.text, before);
    assert.match(line.tableKey, /^save\.reflex\.fire\./);
});

test("narration language follows the setting, independently of the UI", async () => {
    const api = game.modules.get(ID).api;
    const context = { eventType: "recovery", degreeOfSuccess: "success", vars: { actor: "Seoni" } };
    const fr = new Set(fakeTables("fr").flatMap((t) => t.entries.map((e) => e.text)));
    const en = new Set(fakeTables("en").flatMap((t) => t.entries.map((e) => e.text)));
    const raw = async () => (await api.suggest(context)).rawText;

    assert.ok(fr.has(await raw()), "auto + French UI -> French");
    settings.set("language", "en");
    api.invalidateTables();
    assert.ok(en.has(await raw()), "forced English");
    settings.set("language", "auto");
    game.i18n.lang = "de";
    api.invalidateTables();
    assert.ok(en.has(await raw()), "unknown UI language -> English");
    game.i18n.lang = "fr";
    api.invalidateTables();
});

test("cards carrying our flag but written by a player are ignored", async () => {
    const forged = {
        author: { isGM: false },
        flags: { [ID]: { header: "<img src=x onerror=alert(1)>", text: "x", context: { eventType: "recovery", degreeOfSuccess: "success", vars: {} } } },
        update: async () => assert.fail("forged card must not be updated"),
    };
    const listeners = [];
    const button = { dataset: { pf2eNa: "reroll" }, addEventListener: (_e, fn) => listeners.push(fn) };
    fire("renderChatMessageHTML", forged, Object.assign(new HTMLElement(), { querySelectorAll: () => [button] }));
    assert.equal(listeners.length, 0);
});

test("saves against the same casting share one card, one line per creature", async () => {
    created.length = 0;
    settings.set("saveGroupDelay", 0.05);
    const save = (id, actor, outcome) =>
        pf2eMessage(id, { type: "saving-throw", outcome, options: ["check:statistic:reflex", "item:trait:fire"] }, {
            speaker: { alias: actor },
            flags: { pf2e: { context: { type: "saving-throw", outcome, options: ["check:statistic:reflex", "item:trait:fire"], traits: [] }, origin: { uuid: "Actor.ezren.Item.fireball", type: "spell", castRank: 3 } } },
        });
    await createAndWait(save("f1", "Valeros", "success"));
    await createAndWait(save("f2", "Kobold", "criticalFailure"));
    await createAndWait(save("f3", "Ezren", "failure"));
    assert.equal(created.length, 0, "waits for the group to settle");
    await wait(100);
    settings.set("saveGroupDelay", 0);
    assert.equal(created.length, 1);
    const [card] = created;
    assert.deepEqual(card.flags[ID].lines.map((l) => l.sourceId), ["f1", "f2", "f3"]);
    assert.match(card.content, /Kobold \(PF2E\.Check\.Result\.Degree\.Check\.criticalFailure\)/);
});

test("Never again hides a text for good and redraws that line", async () => {
    created.length = 0;
    await createAndWait(pf2eMessage("r1", { type: "flat-check", outcome: "success", options: ["check:statistic:dying-recovery"] }));
    const [card] = created;
    const banned = card.flags[ID].lines[0].rawText;
    await click(card, { pf2eNa: "ban", line: "0" });
    assert.deepEqual(settings.get("banned"), [banned]);
    assert.notEqual(card[`flags.${ID}.lines`][0].rawText, banned);
    const api = game.modules.get(ID).api;
    for (let i = 0; i < 50; i++) {
        assert.notEqual((await api.suggest({ eventType: "recovery", degreeOfSuccess: "success", vars: {} })).rawText, banned);
    }
    await api.unbanAll();
    assert.deepEqual(settings.get("banned"), []);
});

test("chance settings skip a share of rolls", async () => {
    created.length = 0;
    settings.set("chance.success", 0);
    await createAndWait(pf2eMessage("c1", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "success" }));
    settings.set("chance.success", 100);
    assert.equal(created.length, 0);
});

test("a spell cast without attack or save gets a card; a save spell does not", async () => {
    created.length = 0;
    const cast = (id, options) => ({
        ...pf2eMessage(id, {}),
        flags: { pf2e: { origin: { type: "spell", uuid: "Item.heal", rollOptions: ["origin:action:slug:cast-a-spell", ...options] }, casting: { tradition: "divine" } } },
        item: { name: "Guérison" },
    });
    await createAndWait(cast("c2", ["origin:item:trait:healing"]));
    await createAndWait(cast("c3", ["origin:item:defense:reflex"]));
    assert.equal(created.length, 1);
    assert.match(created[0].flags[ID].lines[0].tableKey, /^cast\.healing\./);
    assert.match(created[0].content, /— Guérison</);
});

test("streaks and target health reach the narration context", async () => {
    created.length = 0;
    const miss = (id) => pf2eMessage(id, { type: "attack-roll", identifier: "a.longsword.melee", outcome: "failure" }, { actor: { uuid: "Actor.valeros" } });
    for (const id of ["m1", "m2", "m3"]) await createAndWait(miss(id));
    assert.deepEqual(created.map((c) => c.flags[ID].lines[0].context.streak), [undefined, undefined, "misses"]);
    assert.match(created[2].flags[ID].lines[0].tableKey, /^strike\.streak\.misses\./);

    created.length = 0;
    await createAndWait(pf2eMessage("hp1", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "success" }, {
        target: { token: { name: "Kobold" }, actor: { uuid: "Actor.kobold", hitPoints: { value: 3, max: 20 } } },
    }));
    assert.equal(created[0].flags[ID].lines[0].context.targetHealth, "critical");
});

test("finishing blow: once when a creature drops to 0 HP in combat, naming the last attacker", async () => {
    created.length = 0;
    game.combat = { id: "c1", started: true };
    const kobold = { uuid: "Actor.kobold2", type: "npc", name: "Kobold", traits: new Set(["humanoid"]), token: { name: "the kobold", hidden: false } };
    await createAndWait(pf2eMessage("k1", { type: "attack-roll", identifier: "a.longbow.ranged", outcome: "success" }, {
        speaker: { alias: "Kyra" },
        target: { token: { name: "the kobold" }, actor: { ...kobold, hitPoints: { value: 4, max: 20 } } },
    }));
    created.length = 0;
    const update = (actor, changes) => Promise.all(fire("updateActor", actor, changes));
    await update(kobold, { system: { attributes: { hp: { value: 0 } } } });
    await update(kobold, { name: "Dead kobold" }); // HP unchanged: not narrated again
    await update(kobold, { system: { attributes: { hp: { value: 5 } } } });
    game.combat = { id: "c1", started: false };
    await update(kobold, { system: { attributes: { hp: { value: 0 } } } }); // out of combat
    game.combat = null;
    assert.equal(created.length, 1);
    const [line] = created[0].flags[ID].lines;
    assert.match(line.tableKey, /^finish\.npc\.ranged\./);
    assert.equal(line.context.vars.attacker, "Kyra");
    assert.equal(line.sourceId, "k1");
    assert.match(created[0].content, /— PF2E_NA\.Event\.finish · the kobold</);
});

test("a finishing blow after a secret roll stays whispered even with public output", async () => {
    settings.set("output", "public");
    game.combat = { id: "c2", started: true };
    const ogre = { uuid: "Actor.ogre", type: "npc", name: "Ogre", traits: new Set(), token: { name: "the ogre", hidden: false } };
    await createAndWait(pf2eMessage("b1", { type: "attack-roll", identifier: "a.dagger.melee", outcome: "success" }, {
        blind: true,
        speaker: { alias: "Hidden assassin" },
        target: { token: { name: "the ogre" }, actor: { ...ogre, hitPoints: { value: 2, max: 50 } } },
    }));
    created.length = 0;
    await Promise.all(fire("updateActor", ogre, { system: { attributes: { hp: { value: 0 } } } }));
    settings.set("output", "whisper");
    game.combat = null;
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].whisper, ["gm1"]);
});

test("forged outcomes never reach the card", async () => {
    created.length = 0;
    await createAndWait(pf2eMessage("x1", { type: "skill-check", outcome: "<img src=x onerror=alert(1)>", options: ["action:trip"] }));
    assert.equal(created.length, 0);
});

test("PF2e Toolbelt saves: handled by the active GM, forwarded by other clients", async () => {
    created.length = 0;
    const kobold = { uuid: "Scene.s.Token.k", id: "k", documentName: "Token", name: "the kobold", actor: { uuid: "Actor.k" } };
    const ezren = { uuid: "Scene.s.Token.e", id: "e", documentName: "Token", name: "Ezren", actor: { uuid: "Actor.e", hasPlayerOwner: true } };
    const lich = { uuid: "Scene.s.Token.l", id: "l", documentName: "Token", name: "The Lich", hidden: true, actor: { uuid: "Actor.l", hasPlayerOwner: false } };
    globalThis.fromUuidSync = (uuid) => ({ [kobold.uuid]: kobold, [ezren.uuid]: ezren, [lich.uuid]: lich })[uuid] ?? null;
    game.messages = new Messages([
        ["card1", { id: "card1", flags: {}, item: { name: "Fireball" }, whisper: [], blind: false, speaker: {} }],
        ["secret", { id: "secret", flags: {}, item: { name: "Fireball" }, whisper: ["gm1"], blind: false, speaker: {} }],
    ]);
    const rollSave = (target, outcome) => ({
        message: { id: "card1" },
        target,
        rollMessage: {
            whisper: [],
            blind: false,
            flags: { pf2e: { context: { type: "saving-throw", outcome, options: ["check:statistic:reflex", "item:trait:fire"], traits: [] }, origin: { uuid: "Item.fireball" } } },
        },
    });

    await fireAndWait("pf2e-toolbelt.rollSave", rollSave(kobold, "failure"));
    await fireAndWait("pf2e-toolbelt.rollSave", rollSave(kobold, "failure")); // same target twice: once
    assert.equal(created.length, 1);
    const [line] = created[0].flags[ID].lines;
    assert.match(line.tableKey, /^save\.reflex\.fire\./);
    assert.equal(line.sourceId, "card1");
    assert.equal(line.context.vars.actor, "the kobold");

    // A player's client forwards the save to the active GM.
    created.length = 0;
    const player = { id: "p1", isGM: false, isActiveGM: false };
    const queries = [];
    // Foundry runs the query handler on the GM's client; JSON round trip like the socket.
    game.users.activeGM = { query: async (name, payload) => queries.push({ name, payload: JSON.parse(JSON.stringify(payload)) }) };
    game.user = player;
    await fireAndWait("pf2e-toolbelt.rollSave", rollSave(ezren, "success"));
    game.user = gm;
    assert.equal(created.length, 0, "the player's client narrates nothing itself");
    // The GM waits for Toolbelt's own record on the card; its degree wins over the forwarded one.
    const card1 = game.messages.get("card1");
    const pending = Promise.all(queries.map(({ name, payload }) => CONFIG.queries[name](payload)));
    card1.flags = { "pf2e-toolbelt": { targetHelper: { saveVariants: { null: { saves: { e: { success: "criticalSuccess", statistic: "reflex", private: false } } } } } } };
    await Promise.all(fire("updateChatMessage", card1));
    await pending;
    assert.equal(created.length, 1);
    const [forwarded] = created[0].flags[ID].lines;
    assert.equal(forwarded.context.vars.actor, "Ezren");
    assert.equal(forwarded.context.degreeOfSuccess, "criticalSuccess");

    // Forged payloads from a client: unknown token, an NPC the players do not own (a hidden lich), or a
    // player-owned token Toolbelt never rolled for (the record never comes: dropped after the timeout).
    created.length = 0;
    const forged = (token) => ({ context: { type: "saving-throw", outcome: "success", options: ["check:statistic:will"] }, token, card: "card1" });
    await CONFIG.queries["pf2e-narrative-assistant.toolbeltSave"](forged("Scene.s.Token.nope"));
    await CONFIG.queries["pf2e-narrative-assistant.toolbeltSave"](forged(lich.uuid));
    const valeros = { uuid: "Scene.s.Token.v", id: "v", documentName: "Token", name: "Valeros", actor: { uuid: "Actor.v", hasPlayerOwner: true } };
    const lookup = globalThis.fromUuidSync;
    globalThis.fromUuidSync = (uuid) => (uuid === valeros.uuid ? valeros : lookup(uuid));
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // skip the 10 s wait
    await CONFIG.queries["pf2e-narrative-assistant.toolbeltSave"](forged(valeros.uuid));
    globalThis.setTimeout = realSetTimeout;
    assert.equal(created.length, 0);

    // A save against a whispered spell card stays whispered even with public output.
    settings.set("output", "public");
    await fireAndWait("pf2e-toolbelt.rollSave", { ...rollSave(kobold, "success"), message: { id: "secret" } });
    settings.set("output", "whisper");
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].whisper, ["gm1"]);
    globalThis.fromUuidSync = () => null;
});

test("monsters never renamed get a generic name; renamed tokens and PCs keep theirs", async () => {
    created.length = 0;
    const rat = (name) => ({ name, actor: { type: "npc", name: "Giant Rat", _stats: { compendiumSource: "Compendium.pf2e.pathfinder-monster-core.Actor.x" } } });
    const strike = (id, target) =>
        pf2eMessage(id, { type: "attack-roll", identifier: "a.scimitar.melee", outcome: "success", options: ["item:damage:type:slashing", "target:trait:animal"] }, {
            speaker: { alias: "Kyra" },
            token: { name: "Kyra", actor: { type: "character", name: "Kyra" } },
            target: { token: target, actor: target.actor },
        });
    await createAndWait(strike("n1", rat("Giant Rat 2")));
    await createAndWait(strike("n2", rat("Couinette")));
    const vars = created.map((c) => c.flags[ID].lines[0].context.vars);
    assert.equal(vars[0].target, "le giant rat", "French: always « le », the gender is unknown");
    assert.equal(vars[1].target, "Couinette");
    assert.equal(vars[0].actor, "Kyra");
    assert.ok(!/Giant Rat/.test(created[0].flags[ID].lines[0].text));
    assert.ok(!/\b(de|à) le\b/.test(created[0].flags[ID].lines[0].text), "contracted: du / au");

    settings.set("language", "en");
    game.modules.get(ID).api.invalidateTables();
    await createAndWait(strike("n3", rat("Giant Rat")));
    settings.set("language", "auto");
    game.modules.get(ID).api.invalidateTables();
    assert.equal(created[2].flags[ID].lines[0].context.vars.target, "the giant rat");
});

test("finishing blow after a reload: the last hit comes from the chat log", async () => {
    created.length = 0;
    game.combat = { id: "c3", started: true };
    const troll = { uuid: "Actor.troll", type: "npc", name: "Troll", traits: new Set(["giant"]), token: { name: "the troll", hidden: false } };
    // In the log, but never seen by this client's hooks (it was created before the reload).
    game.messages.set("old1", pf2eMessage("old1", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "criticalSuccess" }, {
        speaker: { alias: "Amiri" },
        target: { token: { name: "the troll" }, actor: { uuid: troll.uuid } },
    }));
    await Promise.all(fire("updateActor", troll, { system: { attributes: { hp: { value: 0 } } } }));
    game.combat = null;
    const [line] = created[0].flags[ID].lines;
    assert.equal(line.context.vars.attacker, "Amiri");
    assert.equal(line.sourceId, "old1");
});

test("the 🎭 button narrates a PF2e roll on demand, whatever the chance", async () => {
    created.length = 0;
    settings.set("chance.success", 0);
    const message = pf2eMessage("ask1", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "success" });
    await createAndWait(message);
    assert.equal(created.length, 0);

    let ask;
    globalThis.document = { createElement: () => (ask = { dataset: {}, setAttribute() {}, addEventListener: (_e, fn) => (ask.click = fn) }) };
    const anchor = { prepend: (element) => assert.equal(element, ask) };
    fire("renderChatMessageHTML", message, Object.assign(new HTMLElement(), { querySelector: () => anchor, querySelectorAll: () => [] }));
    await ask.click({ preventDefault() {} });
    await wait(10);
    settings.set("chance.success", 100);
    assert.equal(created.length, 1);
    assert.equal(created[0].flags[ID].lines[0].sourceId, "ask1");

    // No button on rolls that cannot be narrated (damage).
    ask = null;
    fire("renderChatMessageHTML", pf2eMessage("ask2", { type: "damage-roll", outcome: "success" }), Object.assign(new HTMLElement(), { querySelector: () => anchor }));
    assert.equal(ask, null);
});

test("a PC losing Dying above 0 HP gets a back-on-their-feet card", async () => {
    created.length = 0;
    const seoni = { uuid: "Actor.seoni", type: "character", name: "Seoni", token: { name: "Seoni", hidden: false }, hitPoints: { value: 0, max: 30 } };
    const remove = (slug, actor = seoni) => Promise.all(fire("deleteItem", { type: "condition", slug, actor }));
    await remove("dying"); // stabilised at 0 HP: still down
    seoni.hitPoints.value = 6;
    await remove("frightened");
    await remove("dying");
    await remove("dying", { ...seoni, type: "npc" });
    assert.equal(created.length, 1);
    assert.match(created[0].flags[ID].lines[0].tableKey, /^revive\./);
    assert.match(created[0].content, /PF2E_NA\.Event\.revive · Seoni/);
});

test("combat start and end get one scene-setting card each", async () => {
    created.length = 0;
    await Promise.all(fire("combatStart", { started: true }));
    await Promise.all(fire("deleteCombat", { started: true }));
    await Promise.all(fire("deleteCombat", { started: false })); // never started: nothing
    assert.deepEqual(created.map((c) => c.flags[ID].lines[0].tableKey), ["combat.start.success", "combat.end.success"]);
});

test("panel output: cards sit above the chat log, with working buttons, and nothing goes to the chat", async () => {
    created.length = 0;
    settings.set("output", "panel");
    // Minimal DOM: elements whose buttons are parsed back from their innerHTML.
    const element = () => {
        const el = { dataset: {}, children: [], listeners: [] };
        el.querySelectorAll = (selector) => {
            if (selector === "[data-pf2e-na-card]") {
                return (el.entries ??= [...el.innerHTML.matchAll(/<div data-pf2e-na-card="(\d+)">([\s\S]*?<\/div>)<\/div>/g)].map(([, id, html]) => Object.assign(element(), { innerHTML: html, dataset: { pf2eNaCard: id } })));
            }
            return [...el.innerHTML.matchAll(/data-pf2e-na="(\w+)"(?: data-line="(\d+)")?/g)].map(([, action, line]) => {
                const button = { dataset: { pf2eNa: action, line }, addEventListener: (_e, fn) => (button.click = fn) };
                el.children.push(button);
                return button;
            });
        };
        return el;
    };
    globalThis.document = { createElement: element };
    let panel = null;
    globalThis.ui.chat = { element: { querySelector: () => panel && { remove: () => (panel = null) }, prepend: (el) => (panel = el) } };
    const strike = (id) => pf2eMessage(id, { type: "attack-roll", identifier: "a.longsword.melee", outcome: "success" });

    for (const id of ["p1", "p2", "p3", "p4"]) await createAndWait(strike(id));
    assert.equal(created.length, 0);
    assert.equal(panel.innerHTML.match(/data-pf2e-na-card=/g).length, 3, "the last three cards");
    assert.match(panel.innerHTML, /data-message-id="p4"[\s\S]*data-message-id="p2"/);

    // Buttons bound by the module when it drew the panel.
    const [newest] = panel.entries;
    const before = panel.innerHTML;
    await newest.children.find((b) => b.dataset.pf2eNa === "reroll").click({ preventDefault() {} });
    assert.notEqual(panel.innerHTML, before);
    await newest.children.find((b) => b.dataset.pf2eNa === "publish").click({ preventDefault() {} });
    assert.equal(created.length, 1, "Send to chat posts the text");
    const [again] = panel.entries;
    await again.children.find((b) => b.dataset.pf2eNa === "close").click({ preventDefault() {} });
    assert.equal(panel.innerHTML.match(/data-pf2e-na-card=/g).length, 2);
    settings.set("output", "whisper");
});
