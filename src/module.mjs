/**
 * Foundry glue: settings, chat hook, table loading, output and chat buttons.
 * Read-only towards PF2e: it never updates PF2e messages, actors or rolls.
 */
import { createRecentSet, narrate, shouldNarrate, streakOf } from "./engine.mjs";
import { extractCastContext, extractContext, finishContext, healthState } from "./extract.mjs";
import { LANGUAGES, resolveLanguage } from "./languages.mjs";

const ID = "pf2e-narrative-assistant";
const loc = (key) => game.i18n.localize(`PF2E_NA.${key}`);

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

const EVENT_SETTINGS = {
    strike: ["strike"],
    skill: ["skill-check"],
    save: ["saving-throw"],
    recovery: ["recovery"],
    spell: ["spell"],
    cast: ["cast"],
    finish: ["finish"],
    other: ["other"],
};
const DEGREE_KEYS = ["criticalSuccess", "success", "failure", "criticalFailure"];

function registerSettings() {
    const choices = (name, keys) => Object.fromEntries(keys.map((k) => [k, `PF2E_NA.Settings.${name}.${k}`]));
    const register = (key, data) =>
        game.settings.register(ID, key, {
            name: `PF2E_NA.Settings.${key}.Name`,
            hint: `PF2E_NA.Settings.${key}.Hint`,
            scope: "world",
            config: true,
            ...data,
        });
    const dropTables = () => (tableCache = null);

    register("enabled", { type: Boolean, default: true });
    register("output", { type: String, default: "whisper", choices: choices("output", ["whisper", "public", "notification"]) });
    register("language", {
        type: String,
        default: "auto",
        choices: { auto: "PF2E_NA.Settings.language.auto", ...Object.fromEntries(Object.entries(LANGUAGES).map(([k, l]) => [k, l.label])) },
        onChange: dropTables,
    });
    register("source", { type: String, default: "module", choices: choices("source", ["module", "world"]), onChange: dropTables });
    for (const key of Object.keys(EVENT_SETTINGS)) {
        register(`event.${key}`, { type: Boolean, default: key !== "other" });
    }
    for (const key of DEGREE_KEYS) {
        register(`chance.${key}`, { type: Number, default: 100, range: { min: 0, max: 100, step: 5 } });
    }
    register("saveGroupDelay", { type: Number, default: 2, range: { min: 0, max: 10, step: 0.5 } });
    register("disabledActions", { type: String, default: "" });
    // Texts the GM chose never to see again ("Never again" button). Not shown in the settings form.
    register("banned", { type: Array, default: [], config: false, onChange: dropTables });
}

function readSettings() {
    const get = (key) => game.settings.get(ID, key);
    const events = {};
    for (const [key, eventTypes] of Object.entries(EVENT_SETTINGS)) {
        for (const type of eventTypes) events[type] = get(`event.${key}`);
    }
    return {
        enabled: get("enabled"),
        output: get("output"),
        events,
        chances: Object.fromEntries(DEGREE_KEYS.map((d) => [d, get(`chance.${d}`)])),
        saveGroupDelay: get("saveGroupDelay"),
        disabledActions: get("disabledActions").split(",").map((s) => s.trim()).filter(Boolean),
    };
}

/* -------------------------------------------- */
/*  Tables                                      */
/* -------------------------------------------- */

let tableCache = null;

const narrationLanguage = () => resolveLanguage(game.settings.get(ID, "language"), game.i18n.lang);

/** RollTable document -> plain engine table, or null if it is not one of ours. Banned texts are left out. */
function toEngineTable(rollTable, banned) {
    const flag = rollTable.flags?.[ID];
    if (!flag?.key) return null;
    const entries = rollTable.results.contents
        // GM edits go through a rich-text editor, which wraps the text in a paragraph.
        .map((r) => ({
            text: (r.description || r.name || "").trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1"),
            weight: r.weight ?? 1,
            when: r.flags?.[ID]?.when,
        }))
        .filter((e) => e.text && !banned.has(e.text));
    return { key: flag.key, slot: flag.slot ?? "narration", when: flag.when ?? {}, priority: flag.priority ?? 0, gmOnly: !!flag.gmOnly, entries };
}

/**
 * Module tables of the narration language, overlaid by world tables carrying the same flag key when the
 * source setting is "world". World tables of another language are ignored; untagged ones apply to all.
 */
async function getTables() {
    if (tableCache) return tableCache;
    const lang = narrationLanguage();
    const pack = game.packs.get(`${ID}.narration-${lang}`);
    const banned = new Set(game.settings.get(ID, "banned"));
    const byKey = new Map();
    for (const doc of (await pack?.getDocuments()) ?? []) {
        const table = toEngineTable(doc, banned);
        if (table) byKey.set(table.key, table);
    }
    if (game.settings.get(ID, "source") === "world") {
        for (const doc of game.tables) {
            const table = toEngineTable(doc, banned);
            const tableLang = doc.flags[ID]?.lang;
            if (table && (!tableLang || tableLang === lang)) byKey.set(table.key, table);
        }
    }
    tableCache = [...byKey.values()];
    return tableCache;
}

/* -------------------------------------------- */
/*  Narration                                   */
/* -------------------------------------------- */

const recentTexts = new Map(); // tableKey -> last few texts, to avoid immediate repeats
const remember = (key, text) => {
    const list = recentTexts.get(key) ?? [];
    recentTexts.set(key, [...list, text].slice(-5));
};

async function suggest(context, { exclude = [] } = {}) {
    const tables = await getTables();
    const { fallbacks, fix, possessive } = LANGUAGES[narrationLanguage()];
    const result = narrate(tables, context, { exclude, recent: recentTexts, fallbacks, fix, possessive });
    if (result) remember(result.tableKey, result.rawText);
    return result;
}

/** Header subject: weapon, action, save or event name. */
function subjectLabel(context) {
    switch (context.eventType) {
        case "strike":
            return context.vars.weapon ?? loc("Event.strike");
        case "skill-check": {
            const action = game.pf2e.actions.get(context.actionSlug);
            return action ? game.i18n.localize(action.name) : context.actionSlug;
        }
        case "saving-throw":
            return game.i18n.localize(CONFIG.PF2E.saves[context.save]);
        case "spell":
        case "cast":
            return context.vars.weapon ?? loc(`Event.${context.eventType}`);
        case "finish":
            return [loc("Event.finish"), context.vars.target].filter(Boolean).join(" · ");
        default:
            return loc(`Event.${context.eventType}`);
    }
}

function degreeLabel(context) {
    const group = ["strike", "spell"].includes(context.eventType) ? "Attack" : "Check";
    return game.i18n.localize(`PF2E.Check.Result.Degree.${group}.${context.degreeOfSuccess}`);
}

/** "Inspiration — Critical Hit · Longsword"; a group of saves: "Inspiration — Reflex · Fireball". */
function header(contexts) {
    const [context] = contexts;
    if (context.rolled === false) return `${loc("Title")} — ${subjectLabel(context)}`;
    if (contexts.length === 1) return `${loc("Title")} — ${degreeLabel(context)} · ${subjectLabel(context)}`;
    return `${loc("Title")} — ${[subjectLabel(context), context.vars.weapon].filter(Boolean).join(" · ")}`;
}

const button = (action, icon, label, data = "") =>
    `<button type="button" data-pf2e-na="${action}" ${data} title="${label}"><i class="fa-solid ${icon}"></i></button>`;

/**
 * A card holds one line per narrated roll: one for a single roll, several for a group of saves.
 * `lines` items: { context, text, rawText, tableKey, sourceId }. GM cards get per-line buttons (jump to the
 * PF2e message, never again) and card buttons (another suggestion, send to chat).
 */
function cardHTML(head, lines, { buttons = true } = {}) {
    const grouped = lines.length > 1;
    const body = lines
        .map((line, index) => {
            const label = grouped && line.context.rolled !== false ? `<strong>${line.context.vars.actor ?? ""} (${degreeLabel(line.context)})</strong> ` : "";
            const tools = buttons
                ? `<span class="pf2e-na-line-tools">${line.sourceId ? button("source", "fa-arrow-turn-up", loc("Source"), `data-message-id="${line.sourceId}"`) : ""}${button("ban", "fa-ban", loc("Ban"), `data-line="${index}"`)}</span>`
                : "";
            return `<p class="pf2e-na-text">${label}${line.text}${tools}</p>`;
        })
        .join("");
    const publish = lines.some((l) => l.gmOnly)
        ? ""
        : `<button type="button" data-pf2e-na="publish"><i class="fa-solid fa-comment"></i> ${loc("Publish")}</button>`;
    const actions = buttons
        ? `<footer class="pf2e-na-actions">
            <button type="button" data-pf2e-na="reroll"><i class="fa-solid fa-dice"></i> ${loc("Reroll")}</button>
            ${publish}
        </footer>`
        : "";
    // `head` is built from localized strings and already-escaped names.
    return `<div class="pf2e-na-card"><header>🎭 ${head}</header>${body}${actions}</div>`;
}

const escape = (value) => (value ? foundry.utils.escapeHTML(value) : value);

const withoutNumber = (name) => name.replace(/\s*\(?\d+\)?$/, "").trim();

/**
 * Name of a token for narration. A monster placed from a compendium and never renamed ("Giant Rat", "Giant
 * Rat 2") is not a name: the language gives it an article ("the giant rat", « le rat géant »). Renamed
 * tokens, PCs and home-made NPCs keep their name.
 */
function tokenName(token) {
    const name = token?.name;
    const actor = token?.actor;
    if (!name || actor?.type !== "npc") return name ?? null;
    const fromCompendium = !!(actor._stats?.compendiumSource ?? actor.sourceId);
    if (!fromCompendium || withoutNumber(name) !== withoutNumber(actor.name ?? "")) return name;
    return LANGUAGES[narrationLanguage()].npcName(withoutNumber(name));
}

/** Display names, HTML-escaped since they end up in chat. Token names first: GMs often mask NPC identities there. */
function namesFor(message) {
    let target = null;
    let item = null;
    let origin = null;
    try {
        target = message.target?.token ? tokenName(message.target.token) : (message.target?.actor?.name ?? null);
        item = message.item?.name ?? null;
        const originFlag = message.flags.pf2e?.context?.origin;
        const originUuid = originFlag?.token ?? originFlag?.actor;
        const originDoc = originUuid ? fromUuidSync(originUuid) : null;
        origin = originDoc?.documentName === "Token" ? tokenName(originDoc) : (originDoc?.name ?? null);
    } catch (error) {
        console.warn(`${ID} | could not resolve names`, error);
    }
    const actor = message.token ? tokenName(message.token) : (message.speaker?.alias ?? message.actor?.name);
    return { actor: escape(actor), target: escape(target), item: escape(item), origin: escape(origin) };
}

/** Wait for Dice So Nice to finish animating so a public narration doesn't spoil the result. */
function afterDice(message) {
    if (!game.modules.get("dice-so-nice")?.active || !message?.rolls.length) return Promise.resolve();
    return new Promise((resolve) => {
        const hookId = Hooks.on("diceSoNiceRollComplete", (id) => {
            if (id !== message.id) return;
            Hooks.off("diceSoNiceRollComplete", hookId);
            resolve();
        });
        setTimeout(() => {
            Hooks.off("diceSoNiceRollComplete", hookId);
            resolve();
        }, 8000);
    });
}

const seenMessages = createRecentSet();

/**
 * Saves against the same item (PF2e's `flags.pf2e.origin`: the spell, the poison...) and the same save
 * that arrive within `saveGroupDelay` seconds of each other share one card. Each new save restarts the wait.
 */
const pendingGroups = new Map();

function groupKey(message, context) {
    const origin = message.flags.pf2e?.origin?.uuid;
    return context.eventType === "saving-throw" && origin ? `${origin}.${context.save}` : null;
}

/* Combat memory, active GM only, lost on reload. */
const MEMORY = 100;
const lastHits = new Map(); // victim actor uuid -> { context, messageId, secret } of the last roll that hurt it
const strikeHistory = new Map(); // "<combat>.<attacker>" -> degrees of that attacker's recent Strikes
const keep = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > MEMORY) map.delete(map.keys().next().value);
};

/** Records who last hurt whom (for finishing blows) and the attacker's Strike streak. */
function trackCombat(context, message) {
    // A whispered or blind roll stays secret in whatever is narrated from it later (finishing blow).
    const hit = { context, messageId: message.id, secret: message.whisper.length > 0 || !!message.blind };
    const hurts = ["success", "criticalSuccess"].includes(context.degreeOfSuccess);
    if (["strike", "spell"].includes(context.eventType) && hurts) {
        const victim = message.target?.actor?.uuid;
        if (victim) keep(lastHits, victim, hit);
    }
    // Basic saves deal damage on a success too, so any save counts.
    if (context.eventType === "saving-throw" && message.actor?.uuid) {
        keep(lastHits, message.actor.uuid, hit);
    }
    if (context.eventType === "strike") {
        const key = `${game.combat?.id ?? ""}.${message.actor?.uuid ?? context.vars.actor}`;
        const degrees = strikeHistory.get(key) ?? [];
        // A Hero Point reroll replaces the previous result rather than adding one.
        const next = [...(context.isReroll ? degrees.slice(0, -1) : degrees), context.degreeOfSuccess].slice(-10);
        keep(strikeHistory, key, next);
        context.streak = streakOf(next);
    }
}

function onCreateChatMessage(message) {
    // A single client handles each message: the active GM. Hooks for messages loaded at startup never fire.
    if (!game.user.isActiveGM || message.flags[ID]) return; // our own cards
    return handleRoll(message, message.id);
}

/** `message`: a PF2e chat message, or a message-like object (Toolbelt saves); `rollId`: dedupe key. */
async function handleRoll(message, rollId) {
    if (seenMessages.has(rollId)) return;
    seenMessages.add(rollId);

    const settings = readSettings();
    if (!settings.enabled) return;

    const names = namesFor(message);
    const context = extractContext(message.flags.pf2e, names) ?? extractCastContext(message.flags.pf2e, names);
    if (!context) return;
    context.targetHealth = healthState(message.target?.actor?.hitPoints);
    trackCombat(context, message);
    // Other modules may enrich the context or cancel narration by returning false.
    if (Hooks.call(`${ID}.context`, context, message) === false) return;
    if (!shouldNarrate(context, settings)) return;

    const key = settings.saveGroupDelay > 0 ? groupKey(message, context) : null;
    if (!key) return narrateRolls([{ context, message }], settings);

    const group = pendingGroups.get(key) ?? { rolls: [] };
    group.rolls.push({ context, message });
    clearTimeout(group.timer);
    group.timer = setTimeout(() => {
        pendingGroups.delete(key);
        narrateRolls(group.rolls, settings).catch((error) => console.error(`${ID} |`, error));
    }, settings.saveGroupDelay * 1000);
    pendingGroups.set(key, group);
}

/* -------------------------------------------- */
/*  PF2e Toolbelt                               */
/* -------------------------------------------- */

/*
 * Toolbelt's target helper rolls saves from a spell card without creating chat messages
 * (`createMessage: false`) and stores them on the card. Its public hook `pf2e-toolbelt.rollSave` fires on
 * the client that rolled, with the unsaved PF2e roll message: the active GM handles it directly, other
 * clients forward it to the active GM with a Foundry query.
 */
const TOOLBELT_QUERY = `${ID}.toolbeltSave`;

function onToolbeltRollSave({ rollMessage, message, target }) {
    const context = rollMessage?.flags?.pf2e?.context;
    if (!context || !message?.id || !target?.uuid) return;
    const { type, outcome, options, identifier, traits, domains, isReroll } = context;
    const payload = {
        context: { type, outcome, options, identifier, traits, domains, isReroll },
        origin: rollMessage.flags.pf2e.origin?.uuid ?? null,
        token: target.uuid,
        card: message.id,
        secret: rollMessage.whisper.length > 0 || !!rollMessage.blind,
    };
    if (game.user.isActiveGM) return onToolbeltSave(payload);
    game.users.activeGM?.query(TOOLBELT_QUERY, payload).catch((error) => console.warn(`${ID} |`, error));
}

/** Toolbelt's own record of a token's save on the spell card (Toolbelt writes it through the GM), if any. */
function toolbeltRecord(card, tokenId) {
    const variants = card.flags?.["pf2e-toolbelt"]?.targetHelper?.saveVariants ?? {};
    return Object.values(variants).map((variant) => variant?.saves?.[tokenId]).find(Boolean) ?? null;
}

/** Resolves with Toolbelt's record once the card carries it (Toolbelt updates the card shortly after the roll). */
function awaitToolbeltRecord(card, tokenId, timeout = 10_000) {
    const record = toolbeltRecord(card, tokenId);
    if (record) return Promise.resolve(record);
    return new Promise((resolve) => {
        const done = (value) => {
            Hooks.off("updateChatMessage", hookId);
            clearTimeout(timer);
            resolve(value);
        };
        const hookId = Hooks.on("updateChatMessage", (message) => {
            if (message.id !== card.id) return;
            const found = toolbeltRecord(message, tokenId);
            if (found) done(found);
        });
        const timer = setTimeout(() => done(null), timeout);
    });
}

/**
 * Active GM side. A `remote` payload comes from another client, possibly a player, and is untrusted. Foundry
 * does not tell the GM who sent a query, so the payload is only accepted once Toolbelt itself has recorded
 * that token's save on the card, and the degree and secrecy come from that record. The token must also be
 * visible and player-owned. Every name comes from documents the GM resolves itself: the token, and the
 * spell card's speaker as the origin.
 */
async function onToolbeltSave({ context, origin, token: tokenUuid, card: cardId, secret } = {}, { remote = false } = {}) {
    if (!game.user.isActiveGM || context?.type !== "saving-throw" || typeof tokenUuid !== "string") return;
    const token = fromUuidSync(tokenUuid);
    const card = game.messages.get(cardId);
    if (token?.documentName !== "Token" || !card) return;
    if (remote) {
        if (token.hidden || !token.actor?.hasPlayerOwner) return;
        const record = await awaitToolbeltRecord(card, token.id);
        if (!record) return;
        context = { ...context, outcome: record.success, options: [...(context.options ?? []).filter((o) => !o.startsWith("check:statistic:")), `check:statistic:${record.statistic}`] };
        secret = !!record.private;
    }
    const caster = card.speaker ?? {};
    const message = {
        id: card.id, // ↰ jumps to the spell card, where Toolbelt shows the saves
        flags: {
            pf2e: {
                context: { ...context, origin: { actor: caster.actor ? `Actor.${caster.actor}` : null, token: card.token?.uuid ?? null } },
                origin: typeof origin === "string" ? { uuid: origin } : null,
            },
        },
        // A save rolled from a secret spell card is as secret as the card.
        whisper: secret || card.whisper?.length || card.blind ? [game.user.id] : [],
        blind: false,
        rolls: [],
        token,
        actor: token.actor,
        speaker: { alias: token.name },
        item: card.item,
        target: null,
    };
    await handleRoll(message, `toolbelt.${card.id}.${token.id}`);
}

/**
 * Finishing blow: a PC or NPC in a started combat drops to 0 HP. `changes` only holds what changed, so a
 * creature already at 0 is not narrated again. Damage applied by a player reaches the GM as an update too.
 */
async function onUpdateActor(actor, changes) {
    if (!game.user.isActiveGM || !game.combat?.started) return;
    const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    if (hp === undefined || hp > 0 || !["character", "npc"].includes(actor.type)) return;

    const settings = readSettings();
    const token = actor.token ?? actor.getActiveTokens(false, true)[0];
    const last = lastHits.get(actor.uuid);
    lastHits.delete(actor.uuid);
    const context = finishContext(actor.type, last?.context, {
        target: escape(token ? tokenName(token) : actor.name),
        targetTraits: [...(actor.traits ?? [])],
    });
    if (Hooks.call(`${ID}.context`, context, null) === false) return;
    if (!shouldNarrate(context, settings)) return;

    const result = await suggest(context);
    if (!result) return;
    // Never narrate publicly the fall of a hidden token, nor a blow whose roll was secret (it names the attacker).
    await output([toLine(context, result, last?.messageId)], settings, { keepPrivate: !!token?.hidden || !!last?.secret });
}

async function narrateRolls(rolls, settings) {
    const lines = [];
    for (const { context, message } of rolls) {
        const result = await suggest(context);
        if (result) lines.push(toLine(context, result, message.id));
    }
    const messages = rolls.map((r) => r.message);
    const keepPrivate = messages.some((m) => m.whisper.length > 0 || m.blind);
    if (lines.length) await output(lines, settings, { keepPrivate, waitFor: messages.at(-1) });
}

// Stored so Reroll can resolve again; roll options are dropped, the engine never needs them.
const toLine = (context, result, sourceId) => ({
    context: { ...context, rollOptions: [] },
    text: result.text,
    rawText: result.rawText,
    tableKey: result.tableKey,
    gmOnly: result.gmOnly,
    sourceId: sourceId ?? null,
});

/** `keepPrivate`: the source is secret (whispered/blind roll, hidden token); `waitFor`: message whose dice to wait for. */
async function output(lines, settings, { keepPrivate = false, waitFor } = {}) {
    const head = header(lines.map((l) => l.context));
    // Never go public with a narration about a secret roll, nor with GM-only prompts (Recall Knowledge).
    const mode = settings.output === "public" && (keepPrivate || lines.some((l) => l.gmOnly)) ? "whisper" : settings.output;

    if (mode === "notification") {
        for (const line of lines) ui.notifications.info(`${head} : ${line.text}`);
        return;
    }
    if (mode === "public") await afterDice(waitFor);
    await ChatMessage.create({
        content: cardHTML(head, lines, { buttons: mode === "whisper" }),
        speaker: { alias: loc("Title") },
        whisper: mode === "whisper" ? game.users.filter((u) => u.isGM).map((u) => u.id) : [],
        flags: { [ID]: { header: head, lines } },
    });
}

/* -------------------------------------------- */
/*  Chat buttons                                */
/* -------------------------------------------- */

/**
 * Our cards are only ever created by the active GM. Anyone can put our flag on a message, so a card
 * written by a player is ignored: its flags would otherwise be re-rendered as HTML by the GM's client.
 */
const isOurCard = (message) => Array.isArray(message.flags[ID]?.lines) && !!message.author?.isGM;

/** Draws other narrations for the given lines (all by default); the PF2e rolls are untouched. */
async function redraw(message, indexes) {
    const { header: head, lines } = message.flags[ID];
    const next = [];
    for (const [index, line] of lines.entries()) {
        const result = indexes && !indexes.includes(index) ? null : await suggest(line.context, { exclude: [line.text] });
        next.push(result ? toLine(line.context, result, line.sourceId) : line);
    }
    await message.update({ content: cardHTML(head, next), [`flags.${ID}.lines`]: next });
}

/** Scroll the chat log to the PF2e message a line narrates. */
function showSource(messageId) {
    const element = ui.chat?.element?.querySelector(`.chat-message[data-message-id="${CSS.escape(messageId)}"]`);
    if (!element) return ui.notifications.warn(loc("SourceMissing"));
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("pf2e-na-highlight");
    setTimeout(() => element.classList.remove("pf2e-na-highlight"), 2000);
}

async function onButton(message, dataset) {
    if (!isOurCard(message)) return;
    const { lines } = message.flags[ID];
    switch (dataset.pf2eNa) {
        case "reroll":
            return redraw(message);
        case "ban": {
            const index = Number(dataset.line);
            const banned = game.settings.get(ID, "banned");
            await game.settings.set(ID, "banned", [...new Set([...banned, lines[index].rawText])]);
            return redraw(message, [index]);
        }
        case "source":
            return showSource(dataset.messageId);
        case "publish":
            return ChatMessage.create({
                content: `<div class="pf2e-na-card pf2e-na-public">${lines.map((l) => `<p class="pf2e-na-text">${l.text}</p>`).join("")}</div>`,
                speaker: ChatMessage.getSpeaker(),
            });
    }
}

function onRenderChatMessage(message, html) {
    if (!isOurCard(message) || !game.user.isGM || !(html instanceof HTMLElement)) return;
    for (const element of html.querySelectorAll("button[data-pf2e-na]")) {
        element.addEventListener("click", async (event) => {
            event.preventDefault();
            element.disabled = true;
            try {
                await onButton(message, element.dataset);
            } finally {
                element.disabled = false;
            }
        });
    }
}

/* -------------------------------------------- */
/*  Bootstrap                                   */
/* -------------------------------------------- */

Hooks.once("init", () => {
    registerSettings();
    CONFIG.queries[TOOLBELT_QUERY] = (payload) => onToolbeltSave(payload, { remote: true });
    game.modules.get(ID).api = {
        /** Narrate an arbitrary context, e.g. from another module's own event. */
        suggest,
        extractContext,
        /** Force a reload of tables (module + world) on next narration. */
        invalidateTables: () => (tableCache = null),
        /** Bring back every text hidden with "Never again". */
        unbanAll: () => game.settings.set(ID, "banned", []),
    };
});

Hooks.once("ready", () => {
    if (game.system.id !== "pf2e") return;
    Hooks.on("createChatMessage", (message) => {
        Promise.resolve(onCreateChatMessage(message)).catch((error) => console.error(`${ID} |`, error));
    });
    Hooks.on("pf2e-toolbelt.rollSave", (data) => {
        Promise.resolve(onToolbeltRollSave(data)).catch((error) => console.error(`${ID} |`, error));
    });
    Hooks.on("updateActor", (actor, changes) => {
        onUpdateActor(actor, changes).catch((error) => console.error(`${ID} |`, error));
    });
    Hooks.on("renderChatMessageHTML", onRenderChatMessage);
    for (const hook of ["createRollTable", "updateRollTable", "deleteRollTable", "createTableResult", "updateTableResult", "deleteTableResult"]) {
        Hooks.on(hook, () => (tableCache = null));
    }
});
