// Lints the shipped narration corpora. Rules are explained in docs/WRITING.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREES, narrate } from "../src/engine.mjs";
import { LANGUAGES } from "../src/languages.mjs";
import { corpusLanguages, loadRules, loadSourceTables } from "../tools/source.mjs";

const VARS = new Set(["actor", "attacker", "target", "weapon", "origin"]);
const NAME = String.raw`\{(actor|attacker|target|origin|bodyPart)('s)?\}`;

// Per-language checks. `mechanical` applies to strikes, spells, saves, recovery and generic text: they must
// stay cinematic. Skill actions may state their own rules outcome (Trip success: the target falls), and
// condition tables may name the condition PF2e already applied (a prone target is on the ground), and
// persistent damage checks may say the bleeding or burning stops or goes on, which PF2e decided.
const mayStateMechanics = (key) => key.startsWith("skill.") || key.startsWith("strike.condition.") || key.startsWith("persistent.");
const STYLE = {
    fr: {
        article: new RegExp(String.raw`(?<![\p{L}'])(le|la|les|un|une|du|au|d'|l')\s?${NAME}`, "iu"),
        possessive: /'s\}/,
        guard: /\b(garde|parade|parer|pare|bouclier|armure|cotte|plastron|équipement|cheveux|cape|manteau|ceinture|sangle|vêtements?|tunique|casque|bottes?|gantelet|brassard)\b|(lame|arme) de \{target\}|l'acier (rencontre|contre|heurte) l'acier|fer contre fer|lames? (se croisent|s'entrechoquent)|choc des (lames|armes)|croise le fer/i,
        mechanical: /à terre|au sol|renvers|projeté|(os|bras|jambe|côte)s? (bris|cass)|(?<!\p{L})cass[ée]|fractur|(?<!re)lâche (son|sa|ses) (arme|bouclier|épée|lame)|désarm|saign|hémorrag|meurt|(?<!\p{L})tu[ée]s?(?!\p{L})|achev|inconscien|assomm|aveugl|étourdi|paralys|immunis|résistance (au|à|aux) |\d+ ?m(ètres?)?\b|points? de vie|\bPV\b|dégâts persistants/iu,
        overused: ["violemment", "brutalement", "avec précision", "de justesse"],
    },
    en: {
        // Names never take an article; the roller's gender is unknown, so no gendered pronouns at all.
        article: new RegExp(String.raw`\b(the|a|an)\s${NAME}`, "i"),
        gendered: /\b(he|she|him|her|his|hers|himself|herself)\b/i,
        guard: /\b(guard|parr(y|ies|ied)|shield|armou?r|mail|breastplate|gear|hair|cloak|belt|straps?|cloth(es|ing)|tunic|helm(et)?|boots?|gauntlet|bracer)\b|\{target's\} (blade|weapon|sword)|steel (meets|on|against|rings on) steel|blades? (cross|meet|lock|clash)|clash of (steel|blades)|crosses? (blades|swords)/i,
        mechanical: /\bprone\b|knock(s|ed)? (down|over)|\bto the (ground|floor)|off (their|its) feet|\bshov(e|es|ed)\b|pushed back|\bbroken\b|\bbreaks? (a|the|their) (bone|arm|leg|rib)|fractur|drops? (their|its) (weapon|blade|sword|shield)|disarm|\bbleed|\bdies\b|\bdead\b|\bkill|unconscious|knocked out|\bblind(ed)?\b|\bstun(ned)?\b|paraly[sz]|\bimmune|resistan(t|ce) to|\d+ ?(ft|feet|foot)\b|hit points|\bHP\b|persistent/i,
        overused: ["violently", "brutally", "precisely", "barely"],
    },
};

const rules = loadRules();

for (const lang of corpusLanguages()) {
    const tables = loadSourceTables(lang);
    const narration = tables.filter((t) => t.slot === "narration");
    const slots = new Set(tables.map((t) => t.slot));
    const style = STYLE[lang];
    const each = (filter, fn) => {
        const problems = [];
        for (const table of tables.filter(filter)) {
            for (const { text } of table.entries) {
                const problem = fn(text, table);
                if (problem) problems.push(`${table.key}: ${problem} — « ${text} »`);
            }
        }
        assert.deepEqual(problems, []);
    };

    test(`[${lang}] language is declared and has lint rules`, () => {
        assert.ok(LANGUAGES[lang], "add it to src/languages.mjs");
        assert.ok(style, "add lint rules to tests/corpus.test.mjs");
    });

    test(`[${lang}] placeholders are known variables or component slots`, () => {
        each(() => true, (text) => {
            const unknown = [...text.matchAll(/\{(\w+)(?:'s)?\}/g)].map((m) => m[1]).filter((n) => !VARS.has(n) && !slots.has(n));
            return unknown.length ? `unknown {${unknown.join("}, {")}}` : null;
        });
    });

    test(`[${lang}] names are never glued to an article`, () => {
        each(() => true, (text) => (style.article.test(text) ? "article before a name/bodyPart" : null));
    });

    if (style.gendered) {
        test(`[${lang}] no gendered pronouns`, () => {
            each((t) => t.slot === "narration", (text) => (style.gendered.test(text) ? `gendered ${text.match(style.gendered)[0]}` : null));
        });
    }

    if (style.possessive) {
        test(`[${lang}] no English possessive placeholders`, () => {
            each(() => true, (text) => (style.possessive.test(text) ? "{name's} is English only" : null));
        });
    }

    test(`[${lang}] texts about a guard, parry, armour, gear or clothes declare needs: "armed"`, () => {
        // A rat has no guard, gear or hair: such texts must not be drawn against animals (strike.shield is the attacker's shield).
        each((t) => /^(strike|generic|spell)/.test(t.key) && !t.key.startsWith("strike.shield."), (text, table) => {
            const entry = table.entries.find((e) => e.text === text);
            return style.guard.test(text) && !entry.when ? `add "needs": "armed" (${text.match(style.guard)[0]})` : null;
        });
    });

    test(`[${lang}] Strikes against an animal never get a guard text, and still resolve`, () => {
        for (const degreeOfSuccess of DEGREES) {
            for (const damageTypes of [["slashing"], ["piercing"], ["bludgeoning"], []]) {
                const context = { eventType: "strike", range: "melee", damageTypes, targetTraits: ["animal"], degreeOfSuccess, vars: {} };
                for (let i = 0; i < 30; i++) {
                    const result = narrate(tables, context);
                    assert.ok(result, `${degreeOfSuccess} ${damageTypes}`);
                    assert.ok(!style.guard.test(result.rawText), result.rawText);
                }
            }
        }
    });

    test(`[${lang}] no stray braces or doubled spaces`, () => {
        each(() => true, (text) => (/\{[^}]*$|^[^{]*\}| {2}/.test(text) ? "malformed" : null));
    });

    test(`[${lang}] strikes, spells, saves, recovery and generic entries do not invent mechanics`, () => {
        each((t) => t.slot === "narration" && !mayStateMechanics(t.key), (text) =>
            style.mechanical.test(text) ? `mechanical wording ${text.match(style.mechanical)[0]}` : null,
        );
    });

    test(`[${lang}] overused adverbs stay rare`, () => {
        const all = narration.flatMap((t) => t.entries.map((e) => e.text.toLowerCase()));
        for (const word of style.overused) {
            const count = all.filter((t) => t.includes(word)).length;
            assert.ok(count <= Math.ceil(all.length / 200), `« ${word} » used ${count} times`);
        }
    });

    test(`[${lang}] no duplicate narration entries (components may overlap)`, () => {
        const seen = new Map();
        const duplicates = [];
        for (const table of narration) {
            for (const { text } of table.entries) {
                const norm = text.toLowerCase().trim();
                if (seen.has(norm)) duplicates.push(`${table.key} / ${seen.get(norm)}: « ${text} »`);
                seen.set(norm, table.key);
            }
        }
        assert.deepEqual(duplicates, []);
    });

    test(`[${lang}] generic fallback covers every degree, so narration never comes up empty`, () => {
        for (const degreeOfSuccess of DEGREES) {
            assert.ok(narrate(tables, { eventType: "made-up", degreeOfSuccess, vars: {} }), degreeOfSuccess);
        }
    });

    test(`[${lang}] every supported event resolves to its own table`, () => {
        const expect = (context, prefix) => {
            for (const degreeOfSuccess of DEGREES) {
                const result = narrate(tables, { vars: {}, ...context, degreeOfSuccess });
                assert.ok(result?.tableKey.startsWith(prefix), `${JSON.stringify(context)} ${degreeOfSuccess} -> ${result?.tableKey}`);
            }
        };
        for (const range of ["melee", "ranged"]) expect({ eventType: "strike", range }, `strike.${range}`);
        for (const damage of ["slashing", "piercing", "bludgeoning"]) {
            expect({ eventType: "strike", range: "melee", damageTypes: [damage] }, `strike.melee.${damage}`);
        }
        expect({ eventType: "strike", range: "ranged", thrown: true, damageTypes: ["piercing"] }, "strike.ranged.thrown");
        for (const slug of ["trip", "grapple", "shove", "disarm", "escape", "demoralize", "feint", "create-a-diversion", "hide", "sneak", "seek", "recall-knowledge", "treat-wounds", "administer-first-aid", "tumble-through"]) {
            expect({ eventType: "skill-check", actionSlug: slug }, "skill.");
        }
        for (const save of ["fortitude", "reflex", "will"]) expect({ eventType: "saving-throw", save }, `save.${save}`);
        expect({ eventType: "saving-throw", save: "reflex", traits: ["fire"] }, "save.reflex.fire");
        expect({ eventType: "saving-throw", save: "fortitude", traits: ["poison"] }, "save.fortitude.poison");
        expect({ eventType: "saving-throw", save: "will", traits: ["fear", "mental"] }, "save.will.fear");
        expect({ eventType: "recovery" }, "recovery");

        const melee = { eventType: "strike", range: "melee", damageTypes: ["slashing"] };
        expect({ ...melee, damageTypes: ["bludgeoning"], weaponGroup: "brawling", traits: ["agile", "finesse"] }, "strike.unarmed");
        expect({ ...melee, damageTypes: ["bludgeoning"], weaponGroup: "shield" }, "strike.shield");
        expect({ eventType: "strike", range: "ranged", damageTypes: ["piercing"], weaponGroup: "firearm" }, "strike.firearm");
        expect({ ...melee, damageTypes: ["piercing"], traits: ["finesse"] }, "strike.finesse");
        for (const type of ["undead", "construct", "swarm", "incorporeal"]) {
            expect({ ...melee, targetTraits: [type, "mindless"] }, `strike.vs.${type}`);
        }
        expect({ ...melee, traits: ["finesse"], targetTraits: ["undead"] }, "strike.vs.undead");
        expect({ ...melee, targetTraits: ["undead"], targetConditions: ["prone"] }, "strike.condition.target-prone");
        expect({ ...melee, targetConditions: ["frightened", "off-guard"] }, "strike.condition.target-frightened");
        expect({ ...melee, targetConditions: ["restrained"] }, "strike.condition.target-grabbed");
        expect({ ...melee, actorConditions: ["frightened"] }, "strike.condition.frightened");
        expect({ ...melee, actorConditions: ["sickened"] }, "strike.condition.sickened");
        expect({ ...melee, targetConditions: ["off-guard"] }, "strike.melee.slashing");

        expect({ eventType: "spell", traits: ["concentrate"] }, "spell.attack");
        for (const tradition of ["arcane", "divine", "occult", "primal"]) expect({ eventType: "spell", traits: [tradition] }, `spell.attack.${tradition}`);
        for (const damage of ["fire", "cold", "electricity", "acid", "force", "void"]) {
            expect({ eventType: "spell", traits: ["arcane", damage] }, `spell.attack.${damage}`);
        }
        expect({ eventType: "saving-throw", save: "fortitude", traits: ["void", "divine"] }, "save.fortitude.void");
        expect({ eventType: "saving-throw", save: "fortitude", traits: ["vitality"] }, "save.fortitude.vitality");

        for (const slug of ["reposition", "force-open", "climb", "swim", "lie", "request", "perform", "steal", "palm-an-object", "disable-a-device", "disable-device"]) {
            expect({ eventType: "skill-check", actionSlug: slug }, "skill.");
        }
        const at = (degrees, context, prefix) => {
            for (const degreeOfSuccess of degrees) {
                const result = narrate(tables, { vars: {}, ...context, degreeOfSuccess });
                assert.ok(result?.tableKey.startsWith(prefix), `${JSON.stringify(context)} ${degreeOfSuccess} -> ${result?.tableKey}`);
            }
        };
        const hits = ["success", "criticalSuccess"];
        at(["failure", "criticalFailure"], { ...melee, streak: "misses" }, "strike.streak.misses");
        at(hits, { ...melee, streak: "hits", targetHealth: "critical" }, "strike.streak.hits");
        at(["criticalSuccess"], { ...melee, streak: "comeback" }, "strike.streak.comeback");
        at(hits, { ...melee, targetHealth: "bloodied", targetTraits: ["undead"] }, "strike.health.bloodied");
        at(hits, { ...melee, targetHealth: "critical" }, "strike.health.critical");
        at(["failure"], { ...melee, targetHealth: "critical" }, "strike.melee.slashing");
        at(["success"], { eventType: "cast", traits: ["concentrate"] }, "cast.success");
        for (const tradition of ["arcane", "divine", "occult", "primal"]) at(["success"], { eventType: "cast", traits: [tradition] }, `cast.${tradition}`);
        at(["success"], { eventType: "cast", traits: ["divine", "healing"] }, "cast.healing");
        at(["success"], { eventType: "finish", victim: "npc", cause: "strike", range: "melee" }, "finish.npc.success");
        at(["success"], { eventType: "finish", victim: "npc", cause: "strike", range: "ranged" }, "finish.npc.ranged");
        at(["success"], { eventType: "finish", victim: "npc", cause: "magic" }, "finish.npc.magic");
        at(["success"], { eventType: "finish", victim: "character", cause: "magic" }, "finish.character");
        for (const type of ["undead", "construct", "swarm", "incorporeal"]) {
            at(["success"], { eventType: "finish", victim: "npc", cause: "strike", range: "ranged", targetTraits: [type] }, `finish.npc.${type}`);
        }
        at(["success"], { eventType: "finish", victim: "npc", targetTraits: ["undead", "incorporeal"] }, "finish.npc.incorporeal");
        at(["success"], { eventType: "revive" }, "revive");
        for (const phase of ["start", "end"]) at(["success"], { eventType: "combat", phase }, `combat.${phase}`);
        expect({ eventType: "persistent" }, "persistent.");
        for (const damage of ["fire", "bleed", "acid", "poison"]) expect({ eventType: "persistent", damageTypes: [damage] }, `persistent.${damage}`);
    });

    test(`[${lang}] main strike tables have real variety`, () => {
        for (const table of narration.filter((t) => t.key.startsWith("strike.melee."))) {
            assert.ok(table.entries.length >= 15, `${table.key}: ${table.entries.length} entries`);
        }
    });
}

test("every rule has text in every language, with the same outcome groups", () => {
    const keysByLang = Object.fromEntries(corpusLanguages().map((lang) => [lang, new Set(loadSourceTables(lang).map((t) => t.key))]));
    const all = new Set(Object.values(keysByLang).flatMap((s) => [...s]));
    const missing = [];
    for (const [lang, keys] of Object.entries(keysByLang)) {
        for (const key of all) if (!keys.has(key)) missing.push(`${lang}: ${key}`);
    }
    for (const key of rules.keys()) {
        for (const [lang, keys] of Object.entries(keysByLang)) {
            if (![...keys].some((k) => k === key || k.startsWith(`${key}.`))) missing.push(`${lang}: rule ${key}`);
        }
    }
    assert.deepEqual(missing, []);
});
