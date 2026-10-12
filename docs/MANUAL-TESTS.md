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
