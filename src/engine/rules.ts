// Switching Constellations rules on or off during a game (settings dialog): prepares the state each rule needs.
import type { GameState } from './types';
import { generateTerrain } from './terrain';
import { assignObjectives } from './objectives';
import { leaveNetwork } from './logistics';
import type { ConstellationsRule } from './newgame';
import { generateAnomalies, discoverAnomalies } from './anomalies';
import { placeGuardians, removeGuardians } from './guardians';
import { updateIntel } from './scan';
import { clampFleetHold } from './fleet';
import { initCulture, ensureBeaconCarrier } from './culture';
import { initPirates, removePirates } from './pirates';
import { initCrisis, removeCrisis } from './crisis';
import { initDiplomacy, removeDiplomacy, pairOf } from './diplomacy';
import { updateDossiers } from './espionage';
import { initActs } from './acts';
import { initGovernors } from './governors';
import { clearGreenhouse } from './greenhouse';

export const RULE_INFO: Record<ConstellationsRule, { name: string; text: string; /** only at the creation of a game */ creationOnly?: boolean }> = {
  randomResearch: { name: 'Percées aléatoires', text: 'Les temps de recherche sont estimés, pas exacts : une percée peut arriver en avance ou se faire attendre.' },
  fuzzyTechTree: { name: 'Arbre technologique variable', text: 'Chaque partie décale en secret le niveau requis de chaque technologie (±2).', creationOnly: true },
  terrain: { name: 'Terrain', text: 'Nébuleuses (scanners divisés par deux, Warp 6 maximum), tempêtes ioniques dérivantes (boucliers divisés par deux) et amas denses (riches, Warp 5 maximum).' },
  distanceCost: { name: 'Coût de la taille', text: 'Le rendement baisse loin de la capitale et des capitales régionales ; un monde conquis met une génération à produire pleinement ; perdre la capitale désorganise l\'empire.' },
  logistics: { name: 'Réseau logistique', text: 'Politiques migratoires et minières : des convois automatiques, réels et interceptables, déplacent colons et minerais.' },
  combatRoles: { name: 'Rôles de combat', text: 'Écran, ligne, artillerie ; ciblage par la menace (fini les leurres bon marché qui absorbent les tirs) ; seuils de retraite.' },
  doctrines: { name: 'Doctrines', text: 'À certains niveaux, chaque empire choisit entre deux doctrines exclusives et définitives.' },
  megaprojects: { name: 'Mégaprojets', text: 'Constructions de longue haleine, qui apparaissent quand la recherche s\'en approche ; l\'une d\'elles fait gagner la partie, et toute la galaxie suit son avancement.' },
  secretObjectives: { name: 'Objectifs secrets', text: 'Deux objectifs cachés par empire, révélés à la fin ; chacun accompli rapporte des points de score.' },
  deception: { name: 'Leurres et incertitude', text: 'Sans scanner pénétrant, la masse et le nombre des flottes repérées sont des estimations (±30 %) ; les leurres holographiques gonflent les flottes.' },
  anomalies: { name: 'Anomalies et archéologie', text: 'Des anomalies à étudier avec un vaisseau doté d\'un scanner, des sites archéologiques à fouiller chapitre par chapitre, des reliques, la carte dispersée des Anciens, et des étoiles cachées à découvrir.' },
  guardians: { name: 'Gardiens', text: 'Des flottes immobiles et redoutables veillent sur des mondes riches loin des capitales. Les vaincre rapporte recherche, minerais et parfois une relique.' },
  origins: { name: 'Origines', text: 'Chaque empire choisit une origine (monde condamné, monde-relique, colonie perdue...) qui change son départ.', creationOnly: true },
  pirates: { name: 'Pirates', text: 'Vers 2415, des bandes de pirates s\'installent dans des repaires loin des capitales. Tous les quelques années, un raid pille une colonie riche et mal défendue. On peut les payer pour viser un rival (une prime anonyme) ; détruire un repaire rapporte de la recherche et son butin.' },
  crisis: { name: 'Crise de fin de partie', text: 'Vers 2490-2520 selon la taille de la galaxie, une Brèche s\'ouvre loin des empires (annoncée dix ans avant). Son gardien, le Nexus, est plus fort que n\'importe quelle flotte de la galaxie, et des vagues de Moissonneurs en sortent pour ravager les mondes des plus puissants. À la Brèche, les empires ne se combattent pas entre eux ; celui qui abat le Nexus gagne la partie.' },
  diplomacy: { name: 'Diplomatie négociée', text: 'Guerre, paix ou alliance entre chaque paire d\'empires, accords commerciaux et scientifiques, tributs et cadeaux. Les ordinateurs ont une opinion de chaque empire, avec ses raisons, et répondent aux propositions selon des règles affichées à l\'avance. On ne combat, n\'envahit et ne bombarde que les empires avec qui l\'on est en guerre.' },
  espionage: { name: 'Renseignement', text: 'Ce que l\'on sait des autres empires se construit : leurs mondes sous vos scanners pénétrants ou vos vaisseaux en orbite, leurs vaisseaux identifiés, les accords et alliances, des ambassades (réciproques), des réseaux d\'espions, les combats et les conquêtes. Le niveau de renseignement (0 à 100) révèle d\'abord des estimations, puis les chiffres exacts de leur score, de leur technologie et de leur flotte, enfin leurs recherches et leurs objectifs secrets. Les ordinateurs jugent votre force à travers ce qu\'ils savent de vous.' },
  debris: { name: 'Débris technologiques', text: 'Qui tient le terrain après une bataille étudie les épaves ennemies : si elles portaient des composants inconnus, ses scientifiques progressent vers eux (un tiers du niveau suivant dans le domaine du plus avancé), avec d\'autant plus de chances que les épaves sont nombreuses.' },
  veterans: { name: 'Vétérans', text: 'Les équipages qui survivent aux batailles gagnent de l\'expérience, surtout en détruisant des vaisseaux ennemis : cinq rangs, de Recrues à Légende, chacun avec un peu plus de dégâts et de précision. Fusionner des recrues dans une flotte aguerrie dilue son expérience. Chaque flotte tient un journal de bord.' },
  nemesis: { name: 'Némésis', text: 'Un empire ordinateur se souvient des vaisseaux et des mondes que vous lui avez pris. Au-delà d\'un seuil, il jure votre perte : guerre dès qu\'il le peut, vos mondes les plus faibles pour cible, aucune paix tant qu\'il n\'est pas brisé (60 % des mondes qu\'il tenait, ou sa capitale). Une seule némésis à la fois.' },
  acts: { name: 'Trois actes', text: 'La partie se joue en trois actes, chacun annoncé par un carton titre : l\'Éveil (les ordinateurs ne font pas la guerre, pas de mégaprojet), les Rivalités (guerres, mégaprojets sauf le Portail, cataclysmes), l\'Apothéose (le Portail, une recherche 15 % moins chère, la Brèche). L\'acte suivant vient avec le temps, ou plus tôt quand la galaxie change (colonisation, première guerre, course au Portail).' },
  portalRelays: { name: 'Relais du Portail', text: 'Le Portail de l\'Ascension demande trois relais de l\'Ascension, sur trois mondes différents de l\'empire qui le bâtit. Toute la galaxie apprend où ils s\'élèvent ; perdre un relais met le chantier du Portail en pause.' },
  diaspora: { name: 'Diaspora', text: 'Un empire qui perd son dernier monde survit tant qu\'une de ses arches transporte des colons. Les arches glanent un peu de carburant chaque année ; la première colonie fondée en exil devient la nouvelle capitale, avec des usines et des mines apportées dans les soutes.' },
  cataclysms: { name: 'Cataclysmes annoncés', text: 'À partir du deuxième acte (vers 2445 sans les actes), de temps en temps, une supernova annoncée quinze ans à l\'avance (tout est balayé à moins de 35 al, irradié jusqu\'à 70 al) ou un trou noir errant qui traverse la galaxie en ligne droite. Les ruines regorgent d\'éléments lourds.' },
  goldenAges: { name: 'Âges d\'or', text: 'La culture que rayonnent vos mondes (population, capitale, stations, bâtiments culturels, mécénat) devient de l\'inspiration ; assez d\'inspiration ouvre un âge d\'or de dix ans : 15 % de ressources et de recherche en plus. Le suivant en demande davantage. Demande la règle Culture et territoires.' },
  dilemmas: { name: 'Dilemmes', text: 'Tous les dix à quinze ans environ, un choix difficile : réfugiés, filon, savant renégat, grève, culte, épave, mutations, triomphe. Deux réponses, leur prix annoncé, cinq ans pour trancher (sinon la seconde s\'applique). Les ordinateurs en ont aussi.' },
  eventChains: { name: 'Histoires au long cours', text: 'Tous les trente ou quarante ans, chaque empire vit une histoire en plusieurs étapes, sur une ou deux décennies : un signal venu d\'un monde lointain, une peste à confiner ou non, un prophète à embrasser ou exiler.' },
  ancientSecret: { name: 'Le secret des Anciens', text: 'Ce qu\'est la Brèche change à chaque partie. Fouilles, anomalies, observation de la Brèche et épaves des Moissonneurs donnent des indices ; six révèlent la vérité et le moyen de la sceller : le Sceau des Anciens, un mégaprojet dont le lieu dépend du secret, qui referme la Brèche et donne la victoire. Demande la crise de fin de partie et les mégaprojets.' },
  governors: { name: 'Gouverneurs de secteur', text: 'Chaque siège (la capitale, une capitale régionale, ou, sans la règle « Coût de la taille », un siège désigné) forme un secteur avec les mondes dont il est le plus proche. Un gouverneur nommé à sa tête apporte un talent qui grandit avec les années (ressources, usines et mines moins chères, défenses et stations moins chères, extraction, culture) et peut gérer les files de production du secteur selon une consigne : développement, industrie, fortification ou rayonnement. Il renforce les défenses quand une flotte hostile approche.' },
  originVictories: { name: 'Victoires d\'origine', text: 'Chaque origine a sa propre victoire, que seul son empire peut atteindre, à partir de 2430 : rester en tête vingt-cinq ans, refaire un berceau, réunir quatre reliques, faire grandir la colonie perdue, cartographier la galaxie, dépasser les Anciens…' },
  greenhouse: { name: 'Effet de serre', text: 'Les usines au travail rejettent des gaz à effet de serre : leur monde se réchauffe peu à peu, d\'autant plus que son industrie est grande (environ +11 °C pour 400 ressources d\'usines par an, +20 °C pour 1 000), et ne se refroidit que lentement. Trois technologies réduisent les rejets (Énergie décarbonée, Captage du carbone, Régulation climatique) ; la terraformation de température compense le reste, dans ses limites. Un monde trop froid pour votre race peut y gagner.' },
  culture: { name: 'Culture et territoires', text: 'Chaque colonie rayonne autour d\'elle, de plus en plus loin avec sa population, son ancienneté et ses bâtiments culturels. On ne peut pas coloniser dans le territoire d\'un autre empire, et un monde dominé par une culture étrangère finit, après quelques décennies, par la rejoindre.' },
};

export function setRule(game: GameState, rule: ConstellationsRule, on: boolean) {
  (game.settings as any)[rule] = on;
  if (rule === 'terrain' && on && !game.terrain?.length) game.terrain = generateTerrain(game);
  if (rule === 'secretObjectives' && on) assignObjectives(game);
  if (rule === 'doctrines' && !on) for (const p of game.players) p.doctrines = undefined;
  if (rule === 'logistics' && !on) for (const f of game.fleets) if (f.auto === 'logistics') leaveNetwork(f);
  if (rule === 'anomalies' && on && !game.anomalies?.length) { generateAnomalies(game); discoverAnomalies(game, true); }
  if (rule === 'guardians' && !on) removeGuardians(game);
  if (rule === 'culture' && on) { initCulture(game); for (const p of game.players) ensureBeaconCarrier(game, p); }
  if (rule === 'guardians' && on && !game.guardians?.some(g => g.alive)) { game.guardians = (game.guardians ?? []).filter(g => g.killedYear !== undefined); placeGuardians(game); updateIntel(game); }
  if (rule === 'pirates' && on) initPirates(game);
  if (rule === 'pirates' && !on) removePirates(game);
  if (rule === 'crisis' && on) initCrisis(game);
  if (rule === 'acts' && on) initActs(game);
  if (rule === 'governors' && on) initGovernors(game);
  if (rule === 'greenhouse' && !on) clearGreenhouse(game);
  if (rule === 'crisis' && !on) removeCrisis(game);
  if (rule === 'diplomacy' && on && !game.diplomacy) {
    // the relations of the moment become the statuses: hostile on either side = war, friends on both = alliance
    const rel = game.players.map(p => [...p.relations]);
    initDiplomacy(game);
    for (const a of game.players) for (const b of game.players) {
      if (a.id >= b.id || a.monster || b.monster) continue;
      const pr = pairOf(game, a.id, b.id)!;
      pr.status = rel[a.id][b.id] === 'friend' && rel[b.id][a.id] === 'friend' ? 'alliance' : (rel[a.id][b.id] === 'enemy' || rel[b.id][a.id] === 'enemy') && a.intel.met.includes(b.id) ? 'war' : 'peace';
    }
    initDiplomacy(game);
  }
  if (rule === 'diplomacy' && !on) removeDiplomacy(game);
  // 3.5: what is known is worked out at once (then every year)
  if (rule === 'espionage' && on) updateDossiers(game, true);
  // a doctrine gone can shrink tanks and holds
  if (rule === 'doctrines' && !on) for (const f of game.fleets) clampFleetHold(game, f);
  if (rule === 'distanceCost' && on) for (const p of game.players) {
    if (p.capital !== undefined && game.planets[p.capital]?.owner === p.id) continue;
    const own = game.planets.filter(x => x.owner === p.id);
    const hw = own.find(x => x.homeworld) ?? own.sort((a, b) => b.pop - a.pop)[0];
    if (hw) p.capital = hw.id;
  }
}
