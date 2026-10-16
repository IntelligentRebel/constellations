// What your researchers actually learnt from a discovery (Constellations 3.2): one sentence per research reward,
// "what was studied, and what it led to". {de} is the source with its preposition ("de la sonde", "du puits").
// Tags: 'device' (any machine), 'ship' (anything that flew), 'crewed' (places where people lived or worked),
// 'nature' (phenomena), 'ruins' (archaeological sites), or the id of one source when the sentence only fits it.
import type { Field } from '../engine/types';

export interface Story { f: Field; t: string[]; s: string }

export const SOURCES: Record<string, { de: string; tags: string[] }> = {
  probe: { de: 'de la sonde', tags: ['device', 'ship'] },
  wreck: { de: 'de l\'épave', tags: ['device', 'ship', 'crewed'] }, tomb: { de: 'du vaisseau-tombeau', tags: ['device', 'ship', 'crewed'] }, guardian: { de: 'de l\'épave du gardien', tags: ['device', 'ship', 'crewed'] },
  lair: { de: 'du repaire pirate', tags: ['device', 'ship', 'crewed'] }, nexus: { de: 'du Nexus', tags: ['device', 'ship'] },
  lab: { de: 'du laboratoire', tags: ['device', 'crewed'] }, beacon: { de: 'de la balise', tags: ['device', 'crewed'] }, cache: { de: 'de l\'entrepôt', tags: ['device', 'crewed'] }, cryo: { de: 'des capsules', tags: ['device', 'crewed'] },
  sarcophagus: { de: 'du sarcophage', tags: ['device'] }, climate: { de: 'du moteur climatique', tags: ['device'] },
  storm: { de: 'du nuage d\'ions', tags: ['nature'] }, well: { de: 'du puits de deutérium', tags: ['nature'] }, crystals: { de: 'des cristaux chantants', tags: ['nature'] }, vein: { de: 'du filon', tags: ['nature'] },
  builders: { de: 'des ruines', tags: ['ruins'] }, seers: { de: 'de l\'observatoire', tags: ['ruins'] }, gardens: { de: 'des jardins', tags: ['ruins'] }, navigators: { de: 'du vieux port', tags: ['ruins'] },
  library: { de: 'de la bibliothèque', tags: ['ruins'] }, catacombs: { de: 'des catacombes', tags: ['ruins'] }, vault: { de: 'du sanctuaire', tags: ['ruins'] }, fragment: { de: 'du fragment', tags: ['ruins'] }, charts: { de: 'des archives', tags: ['ruins'] },
};

export const STORIES: Story[] = [
  // ---------------------------------------------------------------- Énergie
  { f: 'energy', t: ['device'], s: 'les cellules d\'énergie {de} stockent deux fois plus de charge que vos batteries : leur électrode en feuillets, enfin comprise, se fabrique désormais dans vos usines' },
  { f: 'energy', t: ['device'], s: 'les supraconducteurs {de} fonctionnent encore à température ambiante ; une fois leur réseau cristallin cartographié, votre câblage perd presque toute sa résistance' },
  { f: 'energy', t: ['device'], s: 'un condensateur {de}, démonté pièce par pièce, montre une isolation en couches alternées qui supprime les fuites de charge' },
  { f: 'energy', t: ['device'], s: 'en suivant le câblage {de}, vos techniciens découvrent un réseau électrique qui contourne seul une ligne coupée ; vos centrales l\'adoptent' },
  { f: 'energy', t: ['device'], s: 'le générateur {de} tourne encore au ralenti après des siècles ; ses paliers sans frottement font gagner quelques précieux pour cent de rendement à vos réacteurs' },
  { f: 'energy', t: ['device'], s: 'la chaleur résiduelle {de} s\'évacue par des micro-canaux gravés dans le métal ; vos dissipateurs deviennent trois fois plus compacts' },
  { f: 'energy', t: ['ship'], s: 'le cœur de fusion encore tiède {de} tient son plasma avec un confinement magnétique plus stable que le vôtre, de quoi alléger vos réacteurs' },
  { f: 'energy', t: ['ship'], s: 'un générateur de champ intact {de} montre comment répartir la charge d\'un bouclier sur toute la coque au lieu de la concentrer à la proue' },
  { f: 'energy', t: ['ship'], s: 'les traces d\'impacts sur le blindage {de} permettent de modéliser la dispersion d\'un faisceau d\'énergie, et donc de mieux s\'en protéger' },
  { f: 'energy', t: ['storm'], s: 'les relevés {de} montrent comment les particules chargées s\'empilent en couches qui s\'isolent les unes des autres ; vos boucliers reprennent le principe' },
  { f: 'energy', t: ['storm', 'well'], s: 'l\'énergie libérée {de} suit un cycle d\'une régularité parfaite ; le modéliser donne à vos physiciens une nouvelle équation du plasma' },
  { f: 'energy', t: ['nature'], s: 'une mesure fine des champs magnétiques autour {de} permet d\'étalonner vos capteurs de plasma, qui donnaient des valeurs fausses depuis des années' },
  { f: 'energy', t: ['crystals'], s: 'la résonance {de} convertit la lumière de l\'étoile en courant avec un rendement que vos panneaux n\'approchent pas ; leur structure se copie' },
  { f: 'energy', t: ['ruins'], s: 'les conduits qui courent sous le sol {de} transportaient l\'énergie sans perte sur des kilomètres ; leur gaine inspire vos lignes à haute tension' },
  { f: 'energy', t: ['ruins'], s: 'les fresques {de} décrivent, en symboles enfin compris, un cycle de réaction que vos physiciens n\'avaient jamais envisagé' },
  { f: 'energy', t: ['ruins'], s: 'un foyer éteint au cœur {de} garde la trace d\'une combustion à très haute température ; son analyse fait progresser vos réacteurs' },
  // ---------------------------------------------------------------- Armement
  { f: 'weapons', t: ['device'], s: 'les tourelles de défense {de} visent sur deux longueurs d\'onde à la fois, ce qui les rend insensibles aux leurres ; vos armuriers reproduisent le viseur' },
  { f: 'weapons', t: ['device'], s: 'une réserve de munitions {de} contient des obus à charge creuse d\'une précision redoutable, aussitôt disséqués' },
  { f: 'weapons', t: ['device'], s: 'le système de défense automatique {de} classe les menaces en un millième de seconde ; vos calculateurs de tir s\'en inspirent' },
  { f: 'weapons', t: ['device'], s: 'la lentille d\'un émetteur {de} focalise mieux que les vôtres grâce à un verre dopé aux terres rares' },
  { f: 'weapons', t: ['device'], s: 'un piège {de}, désamorcé avec beaucoup de prudence, cache un détonateur de proximité dont vos ingénieurs tirent une nouvelle fusée' },
  { f: 'weapons', t: ['ship'], s: 'les impacts figés dans le blindage {de} révèlent l\'angle d\'attaque le plus efficace d\'un projectile cinétique' },
  { f: 'weapons', t: ['ship'], s: 'un tube lance-torpilles {de}, presque intact, utilise un guidage par inertie que vos ingénieurs n\'avaient jamais imaginé' },
  { f: 'weapons', t: ['ship'], s: 'les journaux de tir {de} décrivent une salve décalée qui sature les boucliers adverses avant de les percer' },
  { f: 'weapons', t: ['ship'], s: 'l\'usure des rails d\'un canon {de} montre comment refroidir une arme cinétique entre deux tirs, et donc tirer plus souvent' },
  { f: 'weapons', t: ['storm'], s: 'les décharges naturelles {de} atteignent des puissances que vos canons envient ; les étudier apprend à canaliser un arc électrique' },
  { f: 'weapons', t: ['well', 'vein'], s: 'la façon dont la pression {de} fracture la roche inspire une ogive qui se divise juste avant l\'impact' },
  { f: 'weapons', t: ['nature'], s: 'les ondes de choc mesurées autour {de} aident vos balisticiens à calculer les dégâts d\'une explosion dans le vide' },
  { f: 'weapons', t: ['ruins'], s: 'une armurerie scellée au cœur {de} renferme des pointes de projectiles en alliage qui s\'affûte en frappant' },
  { f: 'weapons', t: ['ruins'], s: 'les remparts {de} portent les marques d\'un siège ancien : en les lisant, vos stratèges comprennent quelles armes perçaient quels murs' },
  { f: 'weapons', t: ['ruins'], s: 'des bas-reliefs {de} montrent des batteries de tir disposées en éventail, une géométrie qui couvre mieux un ciel ouvert' },
  // ---------------------------------------------------------------- Propulsion
  { f: 'propulsion', t: ['device'], s: 'un réservoir {de} stocke le deutérium sous forme cristalline, plus dense et plus sûre que vos réservoirs pressurisés' },
  { f: 'propulsion', t: ['device'], s: 'les gyroscopes {de} tournent encore après des siècles ; leurs paliers magnétiques intéressent vos motoristes' },
  { f: 'propulsion', t: ['device'], s: 'un injecteur {de} pulvérise le combustible en gouttes calibrées au micron, d\'où une combustion plus complète' },
  { f: 'propulsion', t: ['device'], s: 'les pompes {de} déplacent des fluides glacés sans une seule pièce mobile ; vos circuits de carburant en sortent simplifiés' },
  { f: 'propulsion', t: ['ship'], s: 'les tuyères {de} sont revêtues d\'un alliage qui supporte des températures que vos moteurs n\'atteignent même pas' },
  { f: 'propulsion', t: ['ship'], s: 'le journal de navigation {de} contient des corrections de trajectoire qui économisent un cinquième du carburant' },
  { f: 'propulsion', t: ['ship'], s: 'les collecteurs {de} montrent comment récolter l\'hydrogène interstellaire à plus basse vitesse que vos statoréacteurs' },
  { f: 'propulsion', t: ['ship'], s: 'les traces de sillage {de} prouvent qu\'un champ de compression bien réglé réduit la friction à grande vitesse' },
  { f: 'propulsion', t: ['storm'], s: 'les courants {de} suivent des lignes de force que vos pilotes apprennent à emprunter pour gagner de la vitesse sans brûler de carburant' },
  { f: 'propulsion', t: ['well', 'vein'], s: 'les échantillons {de} contiennent un isotope rare qui, ajouté à votre carburant, en augmente nettement la poussée' },
  { f: 'propulsion', t: ['well'], s: 'les jets {de} jaillissent à vitesse constante depuis des années ; leur géométrie inspire une nouvelle forme de tuyère' },
  { f: 'propulsion', t: ['ruins'], s: 'les cartes gravées {de} indiquent des couloirs gravitationnels où l\'on vole plus vite pour le même effort' },
  { f: 'propulsion', t: ['ruins'], s: 'les quais {de} gardent les ancrages d\'un système de lancement par catapulte, que vos ingénieurs adaptent au départ de vos vaisseaux' },
  { f: 'propulsion', t: ['ruins'], s: 'les registres {de} notent des temps de voyage impossibles avec vos moteurs ; les recalculer révèle une astuce d\'accélération progressive' },
  // ---------------------------------------------------------------- Construction
  { f: 'construction', t: ['device'], s: 'les soudures {de} n\'ont pas bougé en mille ans ; vos chantiers adoptent leur procédé de fusion à froid' },
  { f: 'construction', t: ['device'], s: 'des nanomachines inertes trouvées au fond {de} assemblaient le métal atome par atome ; on en comprend enfin le principe' },
  { f: 'construction', t: ['device'], s: 'la structure {de} se répare seule grâce à un polymère qui comble les fissures au contact du vide' },
  { f: 'construction', t: ['device'], s: 'les rivets {de} se resserrent avec la chaleur au lieu de prendre du jeu ; vos assemblages y gagnent en solidité' },
  { f: 'construction', t: ['device'], s: 'l\'étude de la corrosion {de} apprend à vos métallurgistes ce qui use vraiment une structure après des décennies dans le vide' },
  { f: 'construction', t: ['ship'], s: 'la coque {de} est faite d\'un composite tissé en trois dimensions, plus léger et plus résistant que vos plaques' },
  { f: 'construction', t: ['ship'], s: 'l\'ossature {de} répartit les chocs comme un nid d\'abeille ; vos architectes navals en tirent une charpente plus légère' },
  { f: 'construction', t: ['ship'], s: 'les plaques de blindage {de}, montées en écailles, dévient les impacts au lieu de les encaisser' },
  { f: 'construction', t: ['crystals'], s: 'la croissance {de} suit un motif fractal que vos ingénieurs copient pour des poutres légères et très rigides' },
  { f: 'construction', t: ['vein', 'well'], s: 'la roche autour {de} a été durcie par des siècles de pression ; reproduire ce procédé donne un nouveau béton spatial' },
  { f: 'construction', t: ['nature'], s: 'les dépôts minéraux {de} forment des fibres plus résistantes que l\'acier, que vos laboratoires apprennent à faire pousser' },
  { f: 'construction', t: ['ruins'], s: 'les fondations {de} reposent sur un béton qui se régénère avec l\'humidité de l\'air' },
  { f: 'construction', t: ['ruins'], s: 'les voûtes {de} tiennent sans un seul pilier depuis des millénaires ; le calcul de leurs courbes sert à vos stations orbitales' },
  { f: 'construction', t: ['ruins'], s: 'les grues abandonnées près {de} montrent comment assembler une structure géante sans échafaudage' },
  // ---------------------------------------------------------------- Électronique
  { f: 'electronics', t: ['device'], s: 'les mémoires {de} utilisent un codage holographique qui stocke mille fois plus que vos cristaux de données' },
  { f: 'electronics', t: ['device'], s: 'les circuits {de} sont gravés en trois dimensions, ce qui divise leur échauffement par deux' },
  { f: 'electronics', t: ['device'], s: 'le langage machine {de}, une fois traduit, révèle des algorithmes de pistage bien plus rapides que les vôtres' },
  { f: 'electronics', t: ['device'], s: 'les antennes {de} captent des fréquences que vos scanners ignoraient, ce qui élargit leur portée' },
  { f: 'electronics', t: ['device'], s: 'un brouilleur {de} simule des échos multiples ; en le démontant, vos ingénieurs apprennent à déjouer ce genre de leurre' },
  { f: 'electronics', t: ['ship'], s: 'le calculateur de bord {de} fonctionne encore ; son architecture parallèle inspire vos ordinateurs de combat' },
  { f: 'electronics', t: ['ship'], s: 'le système de camouflage {de} déphase la lumière autour de la coque, un principe que vos laboratoires commencent à maîtriser' },
  { f: 'electronics', t: ['ship'], s: 'les capteurs {de} distinguent un vrai vaisseau d\'un leurre par sa signature thermique ; vos analystes adoptent la méthode' },
  { f: 'electronics', t: ['storm'], s: 'les interférences {de} brouillent les signaux selon un motif que vos ingénieurs apprennent à filtrer ; vos transmissions y gagnent' },
  { f: 'electronics', t: ['crystals', 'vein'], s: 'la structure {de} ne conduit le courant que dans un sens, comme une diode naturelle d\'une pureté jamais vue' },
  { f: 'electronics', t: ['nature'], s: 'les signaux naturels {de} servent de banc d\'essai à vos scanners, qui gagnent en finesse' },
  { f: 'electronics', t: ['ruins'], s: 'les archives {de}, gravées sur du quartz, deviennent lisibles une fois le code compris ; vos informaticiens y trouvent une méthode de compression remarquable' },
  { f: 'electronics', t: ['ruins'], s: 'un réseau de cristaux enfouis sous le sol {de} relayait les messages sur des centaines de kilomètres ; le principe donne un nouveau relais pour vos scanners' },
  { f: 'electronics', t: ['ruins'], s: 'les calendriers astronomiques {de} sont calculés avec une précision qui oblige vos mathématiciens à revoir leurs modèles' },
  // ---------------------------------------------------------------- Biotechnologie
  { f: 'biotechnology', t: ['crewed'], s: 'le recyclage de l\'air {de} reposait sur des algues qui fixent le carbone dix fois plus vite que les vôtres' },
  { f: 'biotechnology', t: ['crewed'], s: 'les trousses médicales {de} contiennent des enzymes qui réparent l\'ADN abîmé par les radiations' },
  { f: 'biotechnology', t: ['crewed'], s: 'un écosystème miniature, scellé au fond {de}, tient en équilibre depuis des siècles : une leçon pour vos colonies fermées' },
  { f: 'biotechnology', t: ['crewed'], s: 'les rations {de}, encore comestibles, révèlent une méthode de conservation par stase moléculaire' },
  { f: 'biotechnology', t: ['crewed'], s: 'les restes de l\'équipage {de} montrent une résistance aux radiations obtenue par modification génétique' },
  { f: 'biotechnology', t: ['crewed'], s: 'les cultures de bord {de} poussaient sans lumière grâce à une photosynthèse chimique que vos agronomes reproduisent' },
  { f: 'biotechnology', t: ['crewed'], s: 'l\'infirmerie {de} conserve des tissus cultivés en laboratoire, qui accélèrent la cicatrisation de vos colons' },
  { f: 'biotechnology', t: ['device'], s: 'les filtres {de} ont piégé pendant des siècles des micro-organismes inconnus ; les cultiver ouvre une nouvelle branche de votre génétique' },
  { f: 'biotechnology', t: ['climate'], s: 'le moteur climatique ensemençait l\'atmosphère de micro-organismes qui fixent l\'azote ; vos agronomes en tirent des cultures pour les sols pauvres' },
  { f: 'biotechnology', t: ['climate'], s: 'les réservoirs {de} contiennent encore les souches de lichens qui rendaient l\'air respirable ; elles s\'adaptent sans peine à vos colonies' },
  { f: 'biotechnology', t: ['sarcophagus'], s: 'le corps qui reposait dans le sarcophage était maintenu en vie par un liquide nutritif dont vos médecins percent enfin la formule' },
  { f: 'biotechnology', t: ['nature'], s: 'des bactéries prélevées autour {de} supportent le vide et le froid ; vos généticiens en tirent des cultures pour les mondes hostiles' },
  { f: 'biotechnology', t: ['vein', 'well'], s: 'les micro-organismes {de} se nourrissent de métal ; ils pourraient extraire des minerais là où vos mines échouent' },
  { f: 'biotechnology', t: ['nature'], s: 'des spores piégées {de} survivent au vide ; leur enveloppe protectrice passionne vos généticiens' },
  { f: 'biotechnology', t: ['ruins'], s: 'les graines retrouvées {de} germent encore ; leur génome compact apprend à vos biologistes à adapter une plante à un autre climat' },
  { f: 'biotechnology', t: ['ruins'], s: 'les tombes {de} renferment des corps préservés par un procédé chimique dont s\'inspirent vos caissons de cryogénie' },
  { f: 'biotechnology', t: ['ruins'], s: 'les terrasses cultivées {de} étaient irriguées par un réseau qui recyclait chaque goutte ; vos colonies arides l\'adoptent' },
];

const fits = (st: Story, kind: string, tags: string[]) => st.t.includes(kind) || st.t.some(t => tags.includes(t));

/**
 * A story for a research reward: the sentence (lower case, no final full stop) and its index, never one already
 * told to this player when another is available. `n` is a number from the game's random stream.
 */
export function pickStory(field: Field, kind: string, n: number, told: number[] = []): { text: string; index: number } {
  const src = SOURCES[kind] ?? SOURCES.lab;
  let pool = STORIES.map((st, i) => ({ st, i })).filter(x => x.st.f === field && fits(x.st, kind, src.tags));
  if (!pool.length) pool = STORIES.map((st, i) => ({ st, i })).filter(x => x.st.f === field && x.st.t.includes('device'));
  const fresh = pool.filter(x => !told.includes(x.i));
  const list = fresh.length ? fresh : pool;
  const pick = list[Math.abs(Math.trunc(n)) % list.length];
  return { text: pick.st.s.replace('{de}', src.de), index: pick.i };
}
