// Runs src/module.mjs against a minimal fake of the Foundry/PF2e globals it touches.
// Not a substitute for a real Foundry session (see docs/MANUAL-TESTS.md), but it exercises the glue code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSourceTables } from "../tools/source.mjs";

const ID = "pf2e-narrative-assistant";
const handlers = new Map();
const on = (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]);
const fire = (name, ...args) => (handlers.get(name) ?? []).map((fn) => fn(...args));

const settings = new Map();
const created = [];
const gm = { id: "gm1", isGM: true, isActiveGM: true };

// Packs hold RollTables shaped like the build output: flags + results with a description.
const docsFor = (lang) => loadSourceTables(lang).map((t) => ({
    flags: { [ID]: { key: t.key, slot: t.slot, when: t.when, priority: t.priority, gmOnly: t.gmOnly, lang } },
    results: { contents: t.entries.map((e) => ({ description: e.text, name: "", weight: e.weight })) },
}));

globalThis.Hooks = { on, once: on, off: () => {}, call: (name, ...args) => !fire(name, ...args).includes(false) };
globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") } };
globalThis.CONFIG = { PF2E: { saves: { reflex: "PF2E.SavesReflex" } } };
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
        register: (_ns, key, data) => settings.set(key, data.default),
        get: (_ns, key) => settings.get(key),
    },
    modules: new Map([[ID, {}]]),
    packs: new Map(["en", "fr"].map((lang) => [`${ID}.narration-${lang}`, { getDocuments: async () => docsFor(lang) }])),
    tables: [],
    pf2e: { actions: new Map([["trip", { name: "PF2E.Actions.Trip.Title" }]]) },
};

await import("../src/module.mjs");
fire("init");
fire("ready");

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
const createAndWait = async (message) => Promise.all(fire("createChatMessage", message));

test("a Strike creates one GM-whispered suggestion with a stored context", async () => {
    created.length = 0;
    await createAndWait(pf2eMessage("s1", { type: "attack-roll", identifier: "a.longsword.melee", outcome: "criticalSuccess", options: ["item:damage:type:slashing", "target:trait:humanoid"] }));
    assert.equal(created.length, 1);
    const [card] = created;
    assert.deepEqual(card.whisper, ["gm1"]);
    assert.match(card.content, /PF2E\.Check\.Result\.Degree\.Attack\.criticalSuccess · Épée longue/);
    assert.match(card.flags[ID].tableKey, /^strike\.melee\.slashing\.criticalSuccess$/);
    assert.ok(!/\{\w+\}/.test(card.flags[ID].text), card.flags[ID].text);
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
    const before = card.flags[ID].text;
    const listeners = [];
    const button = { dataset: { pf2eNa: "reroll" }, addEventListener: (_e, fn) => listeners.push(fn) };
    globalThis.HTMLElement = class {};
    const html = Object.assign(new HTMLElement(), { querySelectorAll: () => [button] });
    fire("renderChatMessageHTML", card, html);
    await listeners[0]({ preventDefault() {} });
    assert.equal(created.length, 1, "no new message");
    assert.notEqual(card[`flags.${ID}`].text, before);
    assert.match(card[`flags.${ID}`].tableKey, /^save\.reflex\.fire\./);
});

test("narration language follows the setting, independently of the UI", async () => {
    const api = game.modules.get(ID).api;
    const context = { eventType: "recovery", degreeOfSuccess: "success", vars: { actor: "Seoni" } };
    const fr = new Set(loadSourceTables("fr").flatMap((t) => t.entries.map((e) => e.text)));
    const en = new Set(loadSourceTables("en").flatMap((t) => t.entries.map((e) => e.text)));
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
