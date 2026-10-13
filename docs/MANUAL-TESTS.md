# Manual Foundry test scenarios

Setup: Foundry v14, PF2e ≥ 8.6, module enabled, logged in as GM, one PC (Valeros, longsword and
longbow), one NPC (Kobold). Expected for every scenario: one 🎭 whispered card per roll, nothing for
players, PF2e's own message untouched.

| # | Scenario | Expected |
|---|---|---|
| 1 | Target the kobold, Strike with the longsword, normal hit | Card "Hit · Longsword", slashing narration |
| 2 | Same, critical hit (adjust the DC or retry) | "Critical Hit", slashing critical narration |
| 3 | Longbow Strike, miss | Ranged piercing failure narration |
| 4 | Trip the kobold, success | Trip success text (target falls) |
| 5 | Grapple, critical success | Grapple critical text (target held fast) |
| 6 | Demoralize | Demoralize text matching the degree |
| 7 | Kobold rolls Reflex against a fire spell (*Breathe Fire*) from the chat card | Reflex fire narration |
| 8 | Fortitude against a poison (e.g. a poisoned NPC Strike's effect) | Fortitude poison narration |
| 9 | Will against *Fear* | Will fear narration (fear wins over mental) |
| 10 | Recall Knowledge (Arcana) on the kobold | "GM prompt", no *Send to chat* button, even with public output |
| 11 | PC at Dying 1 rolls a recovery check from the sheet | Recovery narration |
| 12 | Strike with no target selected | No card (PF2e computed no degree of success) |
| 13 | Several targets, a spell asking each to save | One card per save message |
| 14 | NPC Strikes the PC | Narration with the NPC token name as attacker |
| 15 | PC Strikes the NPC | Narration with the token name as target |
| 16 | Click *Another suggestion* | Same card, new text; no new PF2e roll |
| 17 | Click *Send to chat* | Public message with the narration only |
| 18 | Reload the world | No narration for past messages |
| 19 | Roll damage after a hit | No card for the damage roll |
| 20 | Output = public, blind/secret roll (Seek, Hide) | Card stays whispered |
| 21 | Import a table from the compendium, edit it, set source = World RollTables | Edited text is used |
| 22 | Second GM connected | Still exactly one card per roll |
| 23 | Foundry UI in French, narration language = UI | French narration; set it to English: English narration |
| 24 | Foundry UI in German | English narration (no German corpus) |
| 25 | Fireball (or any area save spell) on 3 NPCs, GM rolls the saves with all three selected | One card, three lines "Name (degree): text" |
| 26 | Same with *Group saves* = 0 | Three cards |
| 27 | Click ↰ on a line | Chat scrolls to that save and highlights it |
| 28 | Click 🚫 on a line | That line changes; the text never comes back; `api.unbanAll()` restores it |
| 29 | *Chance: success* = 0, normal hit | No card; a critical hit still gets one |
| 30 | Unarmed Strike (fist), shield bash, firearm, rapier | Unarmed / shield / firearm / agile-finesse narration |
| 31 | Strike a skeleton, a golem, a rat swarm, a ghost | Undead / construct / swarm / incorporeal narration |
| 32 | Trip the kobold, then Strike it while prone | "Target prone" narration |
| 33 | Strike while frightened | "Attacker frightened" narration |
| 34 | Spell attack (*Ignition*, *Ray of Frost*), with *Events: spell attacks* on | Fire / cold spell narration, header "Hit · <spell>" |
| 35 | Undead save against *Heal*; living creature saves against *Harm* | Fortitude vitality / void narration |
| 36 | Run `tools/check-pf2e.mjs` on a fresh PF2e checkout (or the *PF2e watch* workflow) | All assumptions hold |
| 37 | Strike the same target and miss three times in a row | Third card uses a "misses in a row" text |
| 38 | Hit a target below half HP, then below a quarter | "Bloodied", then "near collapse" texts |
| 39 | In a started combat, bring an NPC to 0 HP with an arrow, a spell, a melee hit | One "finishing blow" card each, naming the attacker, ↰ jumps to the hit |
| 40 | Bring a PC to 0 HP | "Player character" finishing card (collapse, never death) |
| 41 | Set an NPC to 0 HP by hand outside combat | No card |
| 42 | Cast *Heal* on an ally (no save), then *Fear* (save) | A cast card for Heal only; Fear is narrated on its saves |
| 43 | Reposition, Force Open, Climb, Swim, Lie, Request, Perform, Steal, Palm an Object, Disable a Device | Matching action text |
| 44 | PF2e Toolbelt target helper: Fireball on 3 NPCs, GM clicks the save buttons on the card | One grouped card; ↰ jumps to the spell card |
| 45 | Same, a player rolls their own PC's save from the card | The GM gets the narration; the player's client creates nothing |

## Capturing fixtures

Real PF2e data turns the assumptions above into regression tests. After playing a few scenarios, run in
the browser console (F12) as GM:

```js
copy(JSON.stringify(game.messages.contents.slice(-20)
    .filter((m) => m.flags.pf2e?.context || m.flags.pf2e?.casting)
    .map((m) => {
        const { type, outcome, options, identifier, altUsage, isReroll, traits, domains, origin, target } = m.flags.pf2e.context ?? {};
        return {
            note: m.flavor?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80),
            flags: { pf2e: {
                context: m.flags.pf2e.context && { type, outcome, options, identifier, altUsage, isReroll, traits, domains, origin, target },
                origin: m.flags.pf2e.origin, casting: m.flags.pf2e.casting,
            } },
        };
    }), null, 2));
```

Paste the result into `tests/fixtures/pf2e-flags.json` and add an `expect` to each entry, e.g.
`"expect": { "eventType": "strike", "range": "melee", "damageTypes": ["slashing"] }`, or
`"expect": null` for a roll that must not be narrated (damage, initiative). `npm test` replays them.
