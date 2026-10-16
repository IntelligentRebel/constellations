# Translating Constellations

Constellations is a turn-based 4X space strategy game in the spirit of Stars! (1995). Its sources are written in
French; every player-visible French text was extracted into chunk files `i18n/work/chunk-NN.json`:

```json
[{"id": 804, "fr": "Ambassade", "ctx": "engine/espionage.ts:168 call:add"}, ...]
```

`fr` is the French text, `ctx` says where it comes from (file and line, then the JSX attribute, object property or
function call it sits in: `attr:title` is a tooltip, `prop:text` a report message, `jsx` text inside the interface,
`call:notify` a short notification...). Texts from `ui/dialogs/misc.tsx` are mostly the player's guide.

## Output

Write one JSON object to the output file you are given, mapping each `id` (as a string) to its translation:

```json
{"804": "Embassy", "805": "Spy network (strength {0})"}
```

Every id of the chunk must be present, the file must be valid JSON (escape double quotes and backslashes; real line
breaks inside a text are written `\n`, exactly as in the source). Write the file with the Write tool, in one or
several steps (if the chunk is long, you may write a first part to a scratch file and assemble), then check it with
`node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"` (run from the repository root).

## Placeholders

`{0}`, `{1}`... are values inserted when the game runs: numbers, names (planets, fleets, empires), or pieces of text
that are translated separately. Keep every placeholder, in the order your language needs, exactly once.

The only exception: some placeholders only carry French grammar chosen by the code, such as plural or gender endings
(the value is `''` or `'s'`, `'x'`, `'e'`, `'es'`...), or a French article. Recognise them by their position (glued to
the end of a word: `vaisseau{1}`, `détruit{2}`). For those you may:
- drop them, or
- use them as a condition: `{1?s}` prints `s` when value 1 is not empty (plural), `{1?ships|ship}` prints the first
  form when it is not empty, the second otherwise.

Example: `"{0} vaisseau{1} détruit{2}"` → English `"{0} ship{1?s} destroyed"`, German `"{0} Schiff{1?e} zerstört"`.

## Fragments

Some texts are pieces of a sentence assembled by the code (they start or end with a space, a comma, a colon, or look
unfinished: `" l'emporte en "`, `"de leur score"`). Translate them so that the assembled sentence reads well, and keep
exactly the same leading and trailing spaces. A text that is a single word used as a label stays a single label.

## Style

- Natural, concise game interface language, as a good localisation team would write it. Sentence case for labels
  (capital letter on the first word only), as in the French.
- The game has its own vocabulary, distinct from Stars!: translate the French names (hulls, components, races, traits,
  doctrines...) into your language, do not replace them with the names of the original Stars!.
- Follow the glossary for the recurring terms, so that the whole game is consistent.
- French typography is not kept: no space before `:` `;` `!` `?` in English (use your language's own rules), French
  quotes « » become your language's quotes, `15 %` becomes `15%` in English.
- Keep units: `kt` (kilotonnes), `mg` (fuel), `dp` (damage points), `R` (resources), `Warp 6`; `al` (années-lumière) is
  the light-year abbreviation of your language (English `ly`).
- Proper names (planets, stars, `Stars!`, `Constellations`) are not translated.
- Keyboard keys and symbols (→, ×, ✦, ✕, ·, …) are kept.
- Do not add explanations or notes, only the translation.

## Glossary (French → English)

Interface: Tour suivant → Next turn · Carte → Map · Colonies → Colonies · Planificateur de colonies → Colony planner ·
Planificateur de minage → Mining planner · Flottes → Fleets · Empire → Empire · Conception → Design · Recherche →
Research · Diplomatie → Diplomacy · Rapports → Reports · Guide → Guide · Annuler → Undo (an order) / Cancel (a dialog) ·
Exporter / Importer → Export / Import · Partie → Game · Nouvelle partie → New game · Partie rapide → Quick game ·
Paramètres de la partie → Game settings · Règles Constellations → Constellations rules · Simulateur de combat → Combat
simulator · Navigateur technologique → Technology browser.

Space: vaisseau → ship · flotte → fleet · station (orbitale) → station · coque → hull · composant → component · modèle
(de vaisseau) → design · pile (au combat) → stack · planète → planet · monde → world · monde natal → homeworld ·
colonie → colony · capitale → capital · capitale régionale → regional capital · population → population · colons →
colonists · habitants → inhabitants · usine → factory · mine → mine · défenses → defenses · scanner → scanner ·
scanner pénétrant → penetrating scanner · terraformation → terraforming · minerais → minerals · ironium, boranium,
germanium (unchanged) · ressources → resources · carburant → fuel · soute → cargo hold · autonomie → range ·
habitabilité → habitability · gravité, température, radiation → gravity, temperature, radiation.

Combat: blindage → armor · boucliers → shields · puissance (de feu) → firepower · dégâts → damage · initiative →
initiative · brouillage → jamming · camouflage → cloaking · déflecteurs → deflectors · torpilles → torpedoes · rayons /
faisceaux → beams · bombes → bombs · bataille → battle · plan de bataille → battle plan · rôle: écran / ligne /
artillerie → screen / line / artillery · retraite → retreat · patrouille → patrol · interception → interception ·
escorte → escort.

World: champ de mines → minefield · mouilleur de mines → minelayer · foreuse, forage → miner, remote mining · paquet
(de minerais) → (mineral) packet · catapulte → mass driver · porte stellaire, portail → stargate · trou de ver →
wormhole · nébuleuse → nebula · amas dense → dense cluster · tempête ionique → ion storm · Marchand nomade → Nomad
Merchant · gardien → guardian · repaire → lair · la Brèche → the Breach · Moissonneurs → Reapers · anomalie → anomaly ·
site archéologique → archaeological site · relique → relic · culture, rayonnement → culture, radiance · territoire →
territory · doctrine → doctrine · grand projet, mégaprojet → megaproject · objectifs secrets → secret objectives ·
leurres → decoys · renseignement → intelligence · ambassade → embassy · espions → spies · Agence → Agency · dossier →
dossier · file de production → production queue · modèle de production → production template · réseau logistique →
logistics network · ravitailleur → tanker · arche → ark.

Diplomacy: guerre → war · paix → peace · alliance → alliance · allié → ally · neutre → neutral · traité → treaty ·
accord commercial → trade agreement · coopération scientifique → research cooperation · pacte de non-agression →
non-aggression pact · trêve → truce · opinion → opinion · usure (de la guerre) → war weariness.

Research fields: Énergie → Energy · Armement → Weapons · Propulsion → Propulsion · Construction → Construction ·
Électronique → Electronics · Biotechnologie → Biotechnology.

Races (singular / plural): Terrien(s) → Terran(s) · Bondisseur(s) → Leaper(s) · Chitineux → Chitinid(s) ·
Hélicoïde(s) → Helicoid(s) · Cristallin(s) → Crystalline(s) · Éthéré(s) → Ethereal(s) · Mycélien(s) → Mycelian(s) ·
Draconide(s) → Draconid(s) · Géomancien(s) → Geomancer(s) · Carapacien(s) → Carapacian(s) · Minotaure(s) →
Minotaur(s) · Balisticien(s) → Ballistician(s) · Spectre(s) → Specter(s) · Galvanien(s) → Galvanian(s) · Nomade(s) →
Nomad(s) · Ombre(s) → Shade(s).

Primary traits: Essaimage → Swarming · Furtivité → Stealth · Conquête → Conquest · Façonnage planétaire → Planet
Shaping · Résilience → Resilience · Artificiers → Demolitionists · Balistique de masse → Mass Ballistics · Maîtrise des
portails → Gate Mastery · Vie orbitale → Orbital Life · Polyvalence → Versatility.
Secondary traits: Sobriété → Fuel Thrift · Terraformation totale → Total Terraforming · Forage avancé → Advanced Remote
Mining · Stations améliorées → Improved Stations · Recherche généralisée → Generalized Research · Recyclage ultime →
Ultimate Recycling · Alchimie minérale → Mineral Alchemy · Sans statoréacteurs → No Ramscoops · Moteurs bon marché →
Cheap Engines · Forage basique seulement → Basic Remote Mining Only · Sans scanners avancés → No Advanced Scanners ·
Faible population initiale → Low Starting Population · Technologie de pointe → Bleeding Edge Technology · Boucliers
régénérants → Regenerating Shields.

Abbreviations: `a` after a number (years) → `y` · `al` → `ly` · `hab.` → `pop.` · `niv.` → `lvl`.

For languages other than English, the English translation of each text is given (field `en`) next to the French:
use both (the French is the source, the English shows how the terms were rendered), and build your own glossary from
the list above, translating each term into your language once and using it consistently.

## Languages other than English

The input files `i18n/work/in-N.json` give each text in French (`fr`, the source), in English (`en`, the reference
translation: follow its choices of meaning and its handling of placeholders) and where it comes from (`ctx`).
Write `i18n/work/<code>-pN.json` mapping each id to your translation.

- Some placeholders are inner interface elements (a bold term, a link, a button, a value in a tag): never drop them.
  When the English drops a placeholder (a French grammatical ending), you may drop it too, or use it as a condition.
- Plurals: `{n?x|y}` only distinguishes "the French ending is empty" (singular) from "not empty" (plural). When your
  language needs more forms (Russian, Polish...) or none (Chinese, Japanese, Korean), prefer a number-neutral phrasing
  ("Ships: {0}", "{0} 艘舰船") rather than a wrong form.
- Address the player as the localised versions of strategy games usually do in your language, consistently: German
  "Sie", Spanish "tú", Brazilian Portuguese "você", Italian "tu", Polish second person singular, Russian "вы",
  Japanese polite style for sentences (です/ます) and short nouns for labels, Korean polite style (합니다체 for sentences).
- Chinese (Simplified, mainland), Japanese and Korean: use your own punctuation (Chinese full-width ，：（）“”),
  no spaces around placeholders unless needed, `光年` / `光年` / `광년` for light-years.
- Keep the game's own names as translations of the French names (not the original Stars! names).
- Before translating, read `i18n/work/glossary-<code>.md` if it exists and follow it; if you are asked to create it,
  translate every term of the glossary above into your language there (French → English → yours), choosing the usual
  terminology of space strategy games in your language.
