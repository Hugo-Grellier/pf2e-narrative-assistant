/**
 * Foundry glue: settings, chat hook, table loading, output and chat buttons.
 * Read-only towards PF2e: it never updates PF2e messages, actors or rolls.
 */
import { createRecentSet, narrate, shouldNarrate } from "./engine.mjs";
import { extractContext } from "./extract.mjs";
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
    other: ["spell", "other"],
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

    register("enabled", { type: Boolean, default: true });
    register("output", { type: String, default: "whisper", choices: choices("output", ["whisper", "public", "notification"]) });
    register("language", {
        type: String,
        default: "auto",
        choices: { auto: "PF2E_NA.Settings.language.auto", ...Object.fromEntries(Object.entries(LANGUAGES).map(([k, l]) => [k, l.label])) },
        onChange: () => (tableCache = null),
    });
    register("source", {
        type: String,
        default: "module",
        choices: choices("source", ["module", "world"]),
        onChange: () => (tableCache = null),
    });
    register("frequency", { type: String, default: "all", choices: choices("frequency", ["all", "successes", "criticals"]) });
    for (const key of Object.keys(EVENT_SETTINGS)) {
        register(`event.${key}`, { type: Boolean, default: key !== "other" });
    }
    for (const key of DEGREE_KEYS) register(`degree.${key}`, { type: Boolean, default: true });
    register("disabledActions", { type: String, default: "" });
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
        frequency: get("frequency"),
        events,
        degrees: Object.fromEntries(DEGREE_KEYS.map((d) => [d, get(`degree.${d}`)])),
        disabledActions: get("disabledActions").split(",").map((s) => s.trim()).filter(Boolean),
    };
}

/* -------------------------------------------- */
/*  Tables                                      */
/* -------------------------------------------- */

let tableCache = null;

const narrationLanguage = () => resolveLanguage(game.settings.get(ID, "language"), game.i18n.lang);

/** RollTable document -> plain engine table, or null if it is not one of ours. */
function toEngineTable(rollTable) {
    const flag = rollTable.flags?.[ID];
    if (!flag?.key) return null;
    const entries = rollTable.results.contents
        // GM edits go through a rich-text editor, which wraps the text in a paragraph.
        .map((r) => ({ text: (r.description || r.name || "").trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1"), weight: r.weight ?? 1 }))
        .filter((e) => e.text);
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
    const byKey = new Map();
    for (const doc of (await pack?.getDocuments()) ?? []) {
        const table = toEngineTable(doc);
        if (table) byKey.set(table.key, table);
    }
    if (game.settings.get(ID, "source") === "world") {
        for (const doc of game.tables) {
            const table = toEngineTable(doc);
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
    const { fallbacks, fix } = LANGUAGES[narrationLanguage()];
    const result = narrate(tables, context, { exclude, recent: recentTexts, fallbacks, fix });
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
        default:
            return loc(`Event.${context.eventType}`);
    }
}

function header(context) {
    const group = context.eventType === "strike" ? "Attack" : "Check";
    const degree = game.i18n.localize(`PF2E.Check.Result.Degree.${group}.${context.degreeOfSuccess}`);
    return `${loc("Title")} — ${degree} · ${subjectLabel(context)}`;
}

function cardHTML(head, text, { buttons = true, publish = true } = {}) {
    const publishButton = publish
        ? `<button type="button" data-pf2e-na="publish"><i class="fa-solid fa-comment"></i> ${loc("Publish")}</button>`
        : "";
    const actions = buttons
        ? `<footer class="pf2e-na-actions">
            <button type="button" data-pf2e-na="reroll"><i class="fa-solid fa-dice"></i> ${loc("Reroll")}</button>
            ${publishButton}
        </footer>`
        : "";
    // `head` is built from localized strings and already-escaped names.
    return `<div class="pf2e-na-card"><header>🎭 ${head}</header><p class="pf2e-na-text">${text}</p>${actions}</div>`;
}

const escape = (value) => (value ? foundry.utils.escapeHTML(value) : value);

/** Display names, HTML-escaped since they end up in chat. Token names first: GMs often mask NPC identities there. */
function namesFor(message) {
    let target = null;
    let item = null;
    let origin = null;
    try {
        target = message.target?.token?.name ?? message.target?.actor?.name ?? null;
        item = message.item?.name ?? null;
        const originFlag = message.flags.pf2e?.context?.origin;
        const originUuid = originFlag?.token ?? originFlag?.actor;
        origin = originUuid ? fromUuidSync(originUuid)?.name : null;
    } catch (error) {
        console.warn(`${ID} | could not resolve names`, error);
    }
    const actor = message.token?.name ?? message.speaker?.alias ?? message.actor?.name;
    return { actor: escape(actor), target: escape(target), item: escape(item), origin: escape(origin) };
}

/** Wait for Dice So Nice to finish animating so a public narration doesn't spoil the result. */
function afterDice(message) {
    if (!game.modules.get("dice-so-nice")?.active || !message.rolls.length) return Promise.resolve();
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

async function onCreateChatMessage(message) {
    // A single client handles each message: the active GM. Hooks for messages loaded at startup never fire.
    if (!game.user.isActiveGM || seenMessages.has(message.id)) return;
    seenMessages.add(message.id);
    if (message.flags[ID]) return; // our own cards

    const settings = readSettings();
    if (!settings.enabled) return;

    const context = extractContext(message.flags.pf2e, namesFor(message));
    if (!context) return;
    // Other modules may enrich the context or cancel narration by returning false.
    if (Hooks.call(`${ID}.context`, context, message) === false) return;
    if (!shouldNarrate(context, settings)) return;

    const result = await suggest(context);
    if (!result) return;
    await output(context, result, settings, message);
}

async function output(context, result, settings, sourceMessage) {
    const head = header(context);
    // Never go public with a narration about a secret roll, nor with GM-only prompts (Recall Knowledge).
    const keepPrivate = sourceMessage.whisper.length > 0 || sourceMessage.blind || result.gmOnly;
    const mode = settings.output === "public" && keepPrivate ? "whisper" : settings.output;

    if (mode === "notification") {
        ui.notifications.info(`${head} : ${result.text}`);
        return;
    }
    if (mode === "public") await afterDice(sourceMessage);
    await ChatMessage.create({
        content: cardHTML(head, result.text, { buttons: mode === "whisper", publish: !result.gmOnly }),
        speaker: { alias: loc("Title") },
        whisper: mode === "whisper" ? game.users.filter((u) => u.isGM).map((u) => u.id) : [],
        // Stored so Reroll can resolve again; roll options are dropped, the engine never needs them.
        flags: { [ID]: { context: { ...context, rollOptions: [] }, header: head, text: result.text, tableKey: result.tableKey } },
    });
}

/* -------------------------------------------- */
/*  Chat buttons                                */
/* -------------------------------------------- */

/**
 * Our cards are only ever created by the active GM. Anyone can put our flag on a message, so a card
 * written by a player is ignored: its flags would otherwise be re-rendered as HTML by the GM's client.
 */
const isOurCard = (message) => !!message.flags[ID] && !!message.author?.isGM;

async function onButton(message, action) {
    if (!isOurCard(message)) return;
    const data = message.flags[ID];
    if (action === "reroll") {
        // Draws another narration only: the PF2e roll is untouched.
        const result = await suggest(data.context, { exclude: [data.text] });
        if (!result) return;
        await message.update({
            content: cardHTML(data.header, result.text, { publish: !result.gmOnly }),
            [`flags.${ID}`]: { text: result.text, tableKey: result.tableKey },
        });
    } else if (action === "publish") {
        await ChatMessage.create({
            content: `<div class="pf2e-na-card pf2e-na-public"><p class="pf2e-na-text">${data.text}</p></div>`,
            speaker: ChatMessage.getSpeaker(),
        });
    }
}

function onRenderChatMessage(message, html) {
    if (!isOurCard(message) || !game.user.isGM || !(html instanceof HTMLElement)) return;
    for (const button of html.querySelectorAll("button[data-pf2e-na]")) {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            button.disabled = true;
            try {
                await onButton(message, button.dataset.pf2eNa);
            } finally {
                button.disabled = false;
            }
        });
    }
}

/* -------------------------------------------- */
/*  Bootstrap                                   */
/* -------------------------------------------- */

Hooks.once("init", () => {
    registerSettings();
    game.modules.get(ID).api = {
        /** Narrate an arbitrary context, e.g. from another module's own event. */
        suggest,
        extractContext,
        /** Force a reload of tables (module + world) on next narration. */
        invalidateTables: () => (tableCache = null),
    };
});

Hooks.once("ready", () => {
    if (game.system.id !== "pf2e") return;
    Hooks.on("createChatMessage", (message) => {
        onCreateChatMessage(message).catch((error) => console.error(`${ID} |`, error));
    });
    Hooks.on("renderChatMessageHTML", onRenderChatMessage);
    for (const hook of ["createRollTable", "updateRollTable", "deleteRollTable", "createTableResult", "updateTableResult", "deleteTableResult"]) {
        Hooks.on(hook, () => (tableCache = null));
    }
});
