// Core game state types for Constellations (a Stars!-like engine).

export type Field = 'energy' | 'weapons' | 'propulsion' | 'construction' | 'electronics' | 'biotechnology';
export const FIELDS: Field[] = ['energy', 'weapons', 'propulsion', 'construction', 'electronics', 'biotechnology'];
export type TechLevels = Record<Field, number>;

export type MineralKey = 'ironium' | 'boranium' | 'germanium';
export const MINERALS: MineralKey[] = ['ironium', 'boranium', 'germanium'];
export interface Minerals { ironium: number; boranium: number; germanium: number }
export interface Cost extends Minerals { resources: number }
/** colonists are stored in kT (1 kT = 100 colonists) inside cargo holds */
export interface Cargo extends Minerals { colonists: number }
export type CargoKey = MineralKey | 'colonists';
export const CARGO_KEYS: CargoKey[] = ['ironium', 'boranium', 'germanium', 'colonists'];

/** gravity, temperature, radiation in "clicks" 0..100 */
export type Hab = [number, number, number];

export type PRT = 'HE' | 'SS' | 'WM' | 'CA' | 'IS' | 'SD' | 'PP' | 'IT' | 'AR' | 'JoaT';
export type LRT = 'IFE' | 'TT' | 'ARM' | 'ISB' | 'GR' | 'UR' | 'MA' | 'NRSE' | 'CE' | 'OBRM' | 'NAS' | 'LSP' | 'BET' | 'RS';
export type ResearchCostLevel = 'less' | 'standard' | 'extra';
export type LeftoverSpend = 'surfaceMinerals' | 'mines' | 'factories' | 'defenses' | 'mineralConcentrations';

export interface Race {
  name: string;
  pluralName: string;
  prt: PRT;
  lrts: LRT[];
  habLow: Hab;
  habHigh: Hab;
  immune: [boolean, boolean, boolean];
  growthRate: number;
  /** one resource per popEfficiency*100 colonists (7..25) */
  popEfficiency: number;
  factoryOutput: number;
  factoryCost: number;
  numFactories: number;
  factoriesCostLess: boolean;
  mineOutput: number;
  mineCost: number;
  numMines: number;
  researchCost: Record<Field, ResearchCostLevel>;
  techsStartHigh: boolean;
  leftover: LeftoverSpend;
  icon: number;
}

export type QueueKind =
  | 'ship' | 'starbase' | 'factory' | 'mine' | 'defenses' | 'alchemy' | 'terraform' | 'scanner'
  | 'packetI' | 'packetB' | 'packetG' | 'packetMixed' | 'genesis'
  | 'autoFactories' | 'autoMines' | 'autoDefenses' | 'autoAlchemy' | 'autoMinTerraform' | 'autoMaxTerraform' | 'autoPackets'
  /** Constellations 3: regional capital, megaproject */
  | 'capital' | 'mega'
  /** Constellations: refit of ships in orbit to another design of the same hull */
  | 'refit'
  /** Constellations 3.3: a cultural building (cultureId), patronage (culture points for resources) */
  | 'culture' | 'patronage' | 'autoPatronage'
  /** Constellations 3.4: a bounty on a rival's head (the pirates raid the empire with the highest bounty) */
  | 'bounty'
  /** Constellations 3.5: a spy network in a rival empire (bountyOn = the empire), an intelligence agency (one per empire) */
  | 'spy' | 'agency';

export interface QueueItem {
  kind: QueueKind;
  designId?: number;
  qty: number;
  /** resources/minerals already spent on the first unit (partial build) */
  allocated: Cost;
  /** standing orders for the ship once built (one-click "build and send") */
  mission?: { kind: 'colonize' | 'explore' | 'mine' | 'haul' | 'logistics'; planetId: number; homeId?: number };
  /** megaproject id (kind 'mega') */
  megaId?: string;
  /** last progress step announced (megaprojects, in %) */
  announced?: number;
  /** refit: design the ships come from, and the fleet in orbit */
  fromDesignId?: number;
  /** Constellations 3.3: cultural building id (kind 'culture') */
  cultureId?: string;
  fleetId?: number;
  /** Constellations 3.4: empire the bounty is placed on (kind 'bounty'); 3.5: empire spied on (kind 'spy') */
  bountyOn?: number;
  /** 0.3.9 (operations): ships built to reinforce this fleet (the id of the fleet of the operation) */
  forOp?: number;
  /** Constellations 3.6: the player has been told this line is stuck */
  warned?: boolean;
  /** 3.6: the unfinished unit of an automatic item (it holds the queue only for a few years, never for decades) */
  fromAuto?: boolean;
}

export interface ProductionTemplate { id: number; name: string; items: { kind: QueueKind; designId?: number; qty: number }[] }

export interface Starbase { designId: number; damage: number }

export interface Planet {
  id: number;
  name: string;
  x: number;
  y: number;
  hab: Hab;
  baseHab: Hab;
  /** terraforming applied so far (signed clicks per hab) */
  terraformed: Hab;
  conc: Minerals;
  mineYears: Minerals;
  surface: Minerals;
  owner: number; // -1 = nobody
  pop: number; // colonists
  mines: number;
  factories: number;
  defenses: number;
  scanner: boolean;
  homeworld: boolean;
  artifact?: boolean;
  queue: QueueItem[];
  leftoverOnly: boolean;
  route?: number; // planet id where new ships go
  packetTarget?: number;
  packetWarp: number;
  starbase: Starbase | null;
  bonusResources: number;
  /** year this planet was colonized by the current owner */
  colonizedYear?: number;
  /** Constellations 3: year the current owner took it by force (efficiency recovers over a generation) */
  conqueredYear?: number;
  /** Constellations 3: seat of a regional government */
  regionalCapital?: boolean;
  /** 0.3.9 (governors): seat of the sector this world belongs to (worked out every year), seat of a sector (without
   * the cost of distance, where regional capitals do not exist), left out of the governor's hands */
  sector?: number;
  sectorSeat?: boolean;
  manual?: boolean;
  /** Constellations 3: migration policy (target = percentage of the planet's capacity) */
  migration?: { mode: 'out' | 'in'; target: number };
  /** Constellations 3: mineral policy of the logistics network (reserve kept per mineral, kt) */
  mineralPolicy?: { mode: 'export' | 'import'; reserve: number };
  /** Constellations 3: megaprojects standing on this planet */
  megaprojects?: string[];
  /** Constellations 3.3: culture gathered (see culture.ts), the owner it was gathered for, cultural buildings */
  culture?: number;
  cultureOwner?: number;
  cultureBld?: string[];
  /** Constellations 3.3: assimilation by a foreign culture (points out of ASSIM_NEEDED) */
  assim?: { by: number; progress: number };
  /** Constellations 3.3: no assimilation before this year (just founded, conquered or turned) */
  cultureGrace?: number;
  /** Constellations 3.5: the empire's intelligence agency stands here */
  agency?: boolean;
  /** Constellations 3.6: production template last applied (the chain colony → developed → mature moves it on) */
  tpl?: number;
  /** 0.3.7: a hidden star (found late, by a quest, a technology or by chance up close) */
  hidden?: SecretKind;
}

export interface ShipToken { designId: number; qty: number; damage: number; qtyDamaged: number }

export type TargetKind = 'planet' | 'fleet' | 'space' | 'wormhole' | 'packet' | 'salvage' | 'trader';
export type WaypointTask = 'none' | 'transport' | 'colonize' | 'remoteMine' | 'merge' | 'scrap' | 'layMines' | 'patrol' | 'route' | 'transfer' | 'refuel' | 'beacon'
  /** Constellations 3.6: stay on post (a sentinel: not reported as waiting for orders); refit to newer designs on arrival */
  | 'stay' | 'refit';
export type TransportAction =
  | 'none' | 'loadAll' | 'unloadAll' | 'loadAmount' | 'unloadAmount' | 'fillPercent' | 'waitPercent'
  | 'loadOptimal' | 'loadDunnage' | 'setAmount' | 'setWaypoint';
export type TransportKey = 'fuel' | CargoKey;
export const TRANSPORT_KEYS: TransportKey[] = ['fuel', 'ironium', 'boranium', 'germanium', 'colonists'];
export interface TransportOrder { action: TransportAction; amount: number }

export interface Waypoint {
  x: number;
  y: number;
  target: TargetKind;
  targetId?: number;
  /** 0..10 warp; 11 = use stargate */
  warp: number;
  task: WaypointTask;
  transport?: Partial<Record<TransportKey, TransportOrder>>;
  /** patrol, and the standing refuelling order ('refuel'): radius around the waypoint, in light-years */
  patrolRange?: number;
  patrolWarp?: number;
  transferTo?: number;
  mergeWith?: number;
  /** Constellations 3.6 (task 'refit'): design to refit each design of the fleet to (from id -> to id) */
  refitTo?: Record<number, number>;
  /** Constellations 3.6: a chase started by a patrol (given up if the target proves far too strong) */
  chase?: boolean;
  /** years to lay mines (0 = indefinitely) */
  layYears?: number;
  /** set once tasks at this waypoint have been performed on arrival */
  processed?: boolean;
  /**
   * Deep-space point only: stop here (true) instead of going through without slowing down (default).
   * Planets, waypoints with a task and the last one always stop.
   */
  stop?: boolean;
  /** 3.6: a point of the detour around a dark cloud (recomputed each year) */
  detour?: boolean;
}

export interface Fleet {
  /** 0.3.9.17: the year it last went through a stargate (no repairs that year) */
  gatedYear?: number;
  id: number;
  owner: number;
  num: number;
  name: string;
  /** user-renamed? */
  customName?: boolean;
  x: number;
  y: number;
  orbiting: number; // planet id or -1
  tokens: ShipToken[];
  cargo: Cargo;
  fuel: number;
  waypoints: Waypoint[];
  repeat: boolean;
  /** route template used by repeat orders */
  route?: Waypoint[];
  /** waiting at waypoint 0 for cargo (transport 'wait for %' / 'set amount') */
  waiting?: boolean;
  battlePlan: number;
  heading: { x: number; y: number } | null;
  lastWarp: number;
  prevX?: number;
  prevY?: number;
  age: number;
  /** fleet ran out of fuel this turn */
  outOfFuel?: boolean;
  /** path flown during the last movement phase (start, waypoints crossed, end): scanners sweep it */
  trail?: { x: number; y: number }[];
  /** AI bookkeeping */
  purpose?: string;
  /** standing automatic order (human fleets): exploration, or a freighter of the logistics network */
  auto?: 'explore' | 'logistics';
  /** current job of a logistics freighter */
  job?: { kind: 'colonists' | 'minerals'; from: number; to: number; amount: number; cargo?: Partial<Record<'ironium' | 'boranium' | 'germanium' | 'colonists', number>> };
  aiTarget?: number;
  /** Constellations 3.2: standing interception order (foreign fleet id), worked out again every year */
  pursue?: number;
  /** Constellations 3.6: standing order to meet the Mystery Trader (its id), worked out again every year */
  meetTrader?: number;
  /** Constellations 3.6: enemy fleets this patrol declined to chase (far too strong), reported once */
  shunned?: number[];
  /** Constellations 3.2: this fleet is on its way to refuel one of its own (fleet id; pursue holds the same id) */
  refuelFor?: number;
  /** Constellations 3.2: year the tanker expects to meet that fleet */
  refuelYear?: number;
  /** Constellations 3.2: post of a tanker on standing refuelling duty, to go back to once a fleet is served */
  tankerPost?: Waypoint;
  /** Constellations 3.3: a sovereignty beacon (an armed fort that never moves) claiming this free planet */
  beaconOf?: number;
  /** Constellations 3.4: a fort that never moves (pirate lair, the crisis Nexus) */
  immobile?: boolean;
  /** Constellations 3.4 (computer players): guarding a world against a raid until that year */
  aiGuard?: { planetId: number; until: number };
  /** Constellations 3.4: orders of a pirate or invader fleet */
  raid?: RaidOrder;
  /** 0.3.9 (veterans): experience of the crews, battles fought, enemy ships destroyed, year it was commissioned, log */
  xp?: number;
  battles?: number;
  kills?: number;
  born?: number;
  journal?: FleetLogEntry[];
  /** 0.3.9: an operation led by this fleet (operations.ts), or the operation this fleet goes to reinforce */
  op?: Operation;
  joinOp?: number;
  /** 0.3.9.11: caught inside a territory whose borders are closed to its owner: the delay it has to get out */
  borderExit?: BorderExit;
}

/** 0.3.9.11: a fleet inside a territory closed to its empire (borders.ts). */
export interface BorderExit {
  /** the empire whose territory it is in */
  closer: number;
  /** year by which the fleet must be out */
  by: number;
  /** the nearest way out, and the fastest warp its fuel allows to get there */
  x: number;
  y: number;
  warp: number;
  /** short of fuel (or engines) to get out in time: dismantled at the deadline */
  stranded?: boolean;
  /** caught under an automatic order: the game flies it out (until the player gives it orders by hand) */
  auto?: boolean;
  /** year it was warned, past the deadline (war, or the scrapyard, the year after) */
  warned?: number;
  /** 0.3.9.14: the ways out offered before (the territory grew over them): a fleet flying to one is leaving */
  ways?: { x: number; y: number }[];
}

/** 0.3.9: a game played by turn files (pbem.ts). */
export interface PbemState {
  role: 'host' | 'player';
  /** identifies the hosted game across files */
  hostId: string;
  /** year of the turn being played */
  turn: number;
  /** host: fingerprints of the state the turn files were made from, and the orders received (player → year) */
  base?: PbemBase;
  received?: Record<number, number>;
  /** player: whose turn this is, the save slot of the host when it lives in the same browser, year of the orders sent */
  player?: number;
  hostSlot?: string;
  sent?: number;
}
export interface PbemBase {
  nextId: number;
  planets: Record<number, string>;
  fleets: Record<number, string>;
  designs: Record<number, string>;
  pairs: Record<string, string>;
  chains: Record<number, string>;
  proposals: number[];
}

/** 0.3.9: a standing operation: hold or take a world with a fleet kept up to a number of ships. */
export interface Operation {
  kind: 'defend' | 'attack';
  planetId: number;
  /** design of the reinforcements */
  designId: number;
  /** number of ships wanted in the fleet */
  target: number;
  /** attack: leave for the target once the fleet is complete (year it left) */
  launch?: boolean;
  launched?: number;
  since: number;
  /** reinforcements built anywhere, or only in the sector of the target */
  sectorOnly?: boolean;
}

/** 0.3.9: a sector governor (governors.ts). */
export interface Governor {
  id: number;
  name: string;
  trait: 'steward' | 'builder' | 'warden' | 'prospector' | 'patron';
  /** years of service */
  xp: number;
  /** seat of the sector governed (absent: waiting for a sector) */
  seat?: number;
  policy: 'manual' | 'develop' | 'industry' | 'fortify' | 'culture';
  since?: number;
  /** last year the governor raised the defenses of the sector against a threat */
  alert?: number;
}

/** 0.3.9: a line of a fleet's log. */
export interface FleetLogEntry { year: number; text: string }

/** Constellations 3.4: what a raider (pirate or invader) is doing. */
export interface RaidOrder {
  kind: 'pirates' | 'crisis';
  /** empire attacked */
  empire: number;
  /** planet aimed at */
  target: number;
  phase: 'go' | 'siege' | 'home';
  /** year the current phase started */
  since: number;
  /** pirates: loot carried (kt of minerals) */
  loot: number;
  /** pirates: the lair the raid comes from (planet id) */
  home?: number;
}

export interface DesignSlot { slot: number; part: string; qty: number }

export interface ShipDesign {
  id: number;
  owner: number;
  name: string;
  hull: string;
  slots: DesignSlot[];
  starbase: boolean;
  purpose?: string;
  deleted?: boolean;
  /** number of ships ever built of this design */
  built: number;
  /** a design obtained from elsewhere (Mystery Trader) */
  alien?: boolean;
  /** Constellations 3: battle role (screen goes first and draws fire, artillery stays behind the line) */
  role?: ShipRole;
  /** 0.3.8.10: counted as a scout (exploration missions, idle-scout reminders); default: the Scout hull. Needs a scanner. */
  scout?: boolean;
}

export type ShipRole = 'screen' | 'line' | 'artillery';

export type TargetClass = 'none' | 'any' | 'starbase' | 'armed' | 'bomberFreighter' | 'unarmed' | 'fuelTransport' | 'freighter';
export type Tactic = 'disengage' | 'disengageIfChallenged' | 'minimizeDamage' | 'maximizeNetDamage' | 'maximizeDamageRatio' | 'maximizeDamage';
export type AttackWho = 'nobody' | 'enemies' | 'enemiesAndNeutrals' | 'everyone' | `player:${number}`;
export interface BattlePlan {
  id: number;
  name: string;
  primary: TargetClass;
  secondary: TargetClass;
  tactic: Tactic;
  attackWho: AttackWho;
  dumpCargo: boolean;
  /** Constellations 3: leave the battle once this percentage of the fleet's strength is lost (0 = never) */
  retreatAt?: number;
}

export type Relation = 'friend' | 'neutral' | 'enemy';

export type MessageKind =
  | 'info' | 'production' | 'research' | 'colony' | 'fleet' | 'battle' | 'scan' | 'combat' | 'diplomacy'
  | 'population' | 'packet' | 'minefield' | 'wormhole' | 'trader' | 'event' | 'victory' | 'warning';
/**
 * What a report is about. x/y: where it was, for objects that may have left the scanners since (a foreign fleet).
 * 3.2.4: anomaly (Empire page, Découvertes), relic, doctrine (Research page), colonies (Colonies page), trader, space.
 */
export interface MessageTarget { kind: 'planet' | 'fleet' | 'battle' | 'research' | 'design' | 'player' | 'wormhole' | 'minefield' | 'packet' | 'score' | 'anomaly' | 'relic' | 'doctrine' | 'colonies' | 'trader' | 'space'; id: number; x?: number; y?: number }
export interface Message { year: number; kind: MessageKind; text: string; target?: MessageTarget }

export interface PlanetIntel {
  id: number;
  /** year of the last report (undefined = never scanned) */
  year?: number;
  owner?: number; // -1 unowned, undefined unknown
  hab?: Hab;
  baseHab?: Hab;
  conc?: Minerals;
  surface?: Minerals;
  pop?: number;
  defenses?: number;
  starbaseDesign?: number;
  starbaseName?: string;
  homeworld?: boolean;
  /** visited in orbit / pen-scanned at least once */
  explored?: boolean;
  /** Constellations 3.2: a guardian was seen in orbit (kind id), and the year it was last seen */
  guardian?: string;
  guardianYear?: number;
  /** Constellations 3.4: a pirate lair or the crisis Breach is known to be there */
  lair?: 'pirates' | 'crisis';
  /** 0.3.7: a hidden star this player has not found yet (it does not appear anywhere for them) */
  unknown?: boolean;
}

export interface FleetIntel {
  id: number;
  owner: number; // -1 unknown (anonymous contact)
  x: number;
  y: number;
  /** 'contact' = position only, 'full' = composition known */
  detail: 'contact' | 'full';
  name?: string;
  heading?: { x: number; y: number } | null;
  warp?: number;
  mass?: number;
  /** Constellations 3: the mass and the count are an estimate (±30 %) unless pen-scanned */
  uncertain?: boolean;
  /** apparent number of ships (decoys and estimates included) */
  count?: number;
  tokens?: { designId: number; qty: number }[];
  orbiting?: number;
  /**
   * Constellations 3.2 (fog of war): the identification comes from an earlier year (penetrating scan, encounter)
   * and the contact has been followed without a break by ordinary scanners since. Composition may be out of date.
   */
  identYear?: number;
  /** destination is never revealed by scanners; estimated from observations */
}

export interface DesignIntel {
  id: number;
  owner: number;
  name: string;
  hull: string;
  slots?: DesignSlot[]; // known when seen in battle / pen-scanned
  starbase: boolean;
}

export interface Observation { year: number; x: number; y: number }

export interface WormholeIntel { id: number; x: number; y: number; year: number; destId?: number; stability?: string }
export interface MinefieldIntel { id: number; owner: number; x: number; y: number; mines: number; type: MinefieldType; year: number }
export interface PacketIntel { id: number; owner: number; x: number; y: number; targetId: number; warp: number; mass: number }

/** 0.3.9.7: what a crew measured of a guardian's strength, kept for the guardian's panel. */
export interface GuardianReport {
  year: number;
  /** the ship or fleet whose crew measured it */
  witness: string;
  /** the guardian's strength then (armor and shields × firepower) */
  strength: number;
  /** the player's navy then: all the warships together, the strongest fleet */
  navy: number;
  best: number;
  bestName: string;
  /** pirate lairs: ships of the garrison counted then */
  ships?: number;
}

export interface Intel {
  /** 0.3.9.7: the last measure of each guardian's strength (guardian id), of each pirate lair's garrison (planet id) */
  guardianReports?: Record<number, GuardianReport>;
  lairReports?: Record<number, GuardianReport>;
  planets: PlanetIntel[];
  fleets: FleetIntel[];
  /** observed positions of foreign fleets by fleet id, used to estimate trajectories */
  tracks: Record<number, Observation[]>;
  designs: Record<number, DesignIntel>;
  met: number[];
  wormholes: Record<number, WormholeIntel>;
  minefields: Record<number, MinefieldIntel>;
  packets: PacketIntel[];
  salvage: { id: number; x: number; y: number; mass: number }[];
  /** 3.6: with its heading when it broadcasts its position or crosses our scanners */
  traders: { id: number; x: number; y: number; warp: number; heading?: { x: number; y: number } }[];
  /** "fleetId:planetId" -> year a threat warning was last given */
  warned?: Record<string, number>;
  /** Constellations 3.2: last identification of each contact still followed (lost with the track) */
  idents?: Record<number, { owner: number; name: string; tokens: { designId: number; qty: number }[]; mass: number; count: number; year: number }>;
  /** Constellations 3.5: what is known of each other empire (intelligence level, sources, figures) */
  dossiers?: Record<number, Dossier>;
}

/** Constellations 3.5: the figures of the score table an intelligence level reveals. */
export type FactKey = 'score' | 'planets' | 'starbases' | 'unarmed' | 'escort' | 'capital' | 'techLevels' | 'resources';
/** A figure as known: value, margin of error (%, 0 exact) and year of the observation. */
export interface Fact { v: number; err: number; year: number }
/** What an empire knows of another (Constellations 3.5). */
export interface Dossier {
  /** intelligence level this year (0-100) and where it comes from */
  level: number;
  lines: { key: string; label: string; value: number }[];
  /** strength of the spy network in that empire (decays every year) */
  network?: number;
  /** fresh knowledge from battles and worlds taken (decays every year) */
  fresh?: number;
  /** figures as last known */
  facts: Partial<Record<FactKey, Fact>>;
  techs?: { v: TechLevels; year: number };
  research?: { field: Field; year: number };
  victory?: { v: number; year: number };
  objectives?: { list: SecretObjective[]; year: number };
  /** score as observed over the years */
  history?: { year: number; v: number; err: number }[];
  /** highest level reached (to announce a new step once) */
  best?: number;
}

/** 0.3.9: a hard choice offered to an empire (dilemmas.ts); it waits until answered or until `expires`. */
export interface Dilemma { id: number; kind: string; year: number; expires: number; data?: Record<string, number | string> }

export interface ScoreEntry {
  year: number;
  score: number;
  planets: number;
  starbases: number;
  unarmed: number;
  escort: number;
  capital: number;
  techLevels: number;
  resources: number;
}

export interface Player {
  id: number;
  name: string;
  race: Race;
  color: string;
  /** 0.3.9: the colour given at creation, when a colour-blind palette shows another one (display only) */
  baseColor?: string;
  ai: null | AIDifficulty;
  tech: TechLevels;
  researchSpent: TechLevels;
  researching: Field;
  /** 0.3.9.17: the year of the last level gained by trading technology (one a year at most) */
  techTradeYear?: number;
  nextField: 'same' | 'lowest' | Field;
  researchPct: number;
  /** optional technology goal: research fields are chosen automatically until obtained */
  researchGoal?: string;
  /** research points the goal needed when it was set (progress display) */
  researchGoalStart?: number;
  /** hidden per-game shift of each technology's main requirement (same for every player) */
  techShift?: Record<string, number>;
  /** research resources spent last turn */
  researchLastYear: number;
  relations: Relation[];
  /** 0.3.9 (computer empires): grudge against each other empire (worlds and ships it took), toward a nemesis */
  grudges?: Record<number, number>;
  /** 0.3.9: last size milestone told in the chronicle (worlds held) */
  milestone?: number;
  /** 0.3.9 (diaspora): no world left, the people aboard the arks since that year; refounded: year of the new capital */
  exile?: { since: number; refounded?: number };
  /** 0.3.9: last act whose title card this player saw */
  actSeen?: number;
  /** 0.3.9.10 (closed borders, borders.ts): the empires this one's borders are closed to; the policy for the empires
   * met from now on; the empires met that the policy was applied to (or that were decided one by one) */
  closed?: number[];
  borderPolicy?: 'open' | 'closed';
  bordersSet?: number[];
  /** 0.3.9.10: how much each empire's closed borders hinder this one (0 to 1: the share of the worlds within its reach
   * that lie behind them), measured every year */
  hindered?: Record<number, number>;
  /** 0.3.9 (golden ages): inspiration gathered, needed for the next golden age, golden ages so far, last year of the current one */
  golden?: { inspiration: number; next: number; count: number; until?: number };
  /** 0.3.9 (dilemmas): year of the last one, kinds met lately */
  lastDilemma?: number;
  dilemmaSeen?: string[];
  /** 0.3.9 (secret of the Ancients): clues found, where from, year the secret was found */
  clues?: number;
  clueLog?: string[];
  secretKnown?: number;
  lastBreachClue?: number;
  anchorTold?: boolean;
  crisisKillsSeen?: number;
  /** 0.3.9 (origin victories): years in a row at the top of the scores, the lost colony's world */
  leadYears?: number;
  originWorld?: number;
  /** 0.3.9 (event chains): year the next story may begin, stories lived */
  nextChain?: number;
  chainsSeen?: string[];
  battlePlans: BattlePlan[];
  templates: ProductionTemplate[];
  /** template applied to new colonies (-1 none) */
  defaultTemplate: number;
  /** Constellations 3.6: colonies move on from template 1 to 2 to 3 by themselves (undefined = yes) */
  tplChain?: boolean;
  /** 3.6: abilities that need no research in this game (the "close to Stars!" preset: wormholes as in Stars!) */
  freeSpecials?: ('autoExplore' | 'wormholeNav' | 'infrared' | 'lensing')[];
  acquiredTechs: string[];
  fleetNum: number;
  intel: Intel;
  messages: Message[];
  scores: ScoreEntry[];
  dead: boolean;
  /** Constellations 3.2: not an empire but the guardians of the galaxy (always marked dead: no turn, no score) */
  monster?: boolean;
  aiState?: AIState;
  /** cumulative statistics */
  stats: { shipsBuilt: number; shipsLost: number; shipsDestroyed: number; planetsColonized: number; planetsCaptured?: number; convoysDestroyed?: number; homeworldsTaken?: number[]; capturedFrom?: number[]; planetsLost?: number; culturalGains?: number; raided?: number; lairsDestroyed?: number; crisisKills?: number; refounded?: number };
  /** player's Mystery Trader rewards so far (ids of traders that already rewarded) */
  traderRewards: number[];
  /** victory conditions met this year (bitmask of indexes) */
  victoryMet: number;
  /** Constellations 3: seat of government (planet id) */
  capital?: number;
  /** Constellations 3: the empire is disorganised until this year (capital lost) */
  disorgUntil?: number;
  /** Constellations 3: chosen research doctrines (fork id -> option) */
  doctrines?: Record<string, 'a' | 'b'>;
  /** Constellations 3: secret objectives */
  objectives?: SecretObjective[];
  /** Constellations 3: logistics network statistics (cumulative) */
  logStats?: { colonists: number; minerals: number; lostColonists: number; lostMinerals: number; convoysLost: number; trips: number };
  /** 0.3.9: choices waiting for the player (see dilemmas.ts) */
  dilemmas?: Dilemma[];
  /** 0.3.9: sector governors in office, and the candidates offered (renewed every ten years) */
  governors?: Governor[];
  govPool?: Governor[];
  govPoolYear?: number;
  /** 0.3.8.7: emigrants also go to habitable colonies without a policy, under upTo % of their capacity (see logistics.ts) */
  autoImmigration?: { on: boolean; upTo: number };
  /** 0.3.8.6: one-time pieces of advice already given (e.g. 'emigration') */
  hints?: string[];
  /** Constellations 3.2: origin of the empire */
  origin?: string;
  /** Constellations 3.2: doomed homeworld, direction of the drift of each habitability axis */
  doomDir?: [number, number, number];
  /** Constellations 3.2: relics owned (permanent bonuses) */
  relics?: string[];
  /** Constellations 3.2: fragments of the Ancients' map found */
  fragments?: number;
  /** Constellations 3.2: choices waiting for the player after a discovery */
  decisions?: Decision[];
  /** Constellations 3.2: research stories already told to this player (indexes, to avoid repeats) */
  told?: number[];
  /** Constellations 3.2: discoveries made (anomalies studied, chapters, guardians defeated) */
  finds?: { anomalies: number; chapters: number; guardians: number };
  /** Constellations 3.4: a pseudo-player that is not an empire (always monster and dead) */
  faction?: 'pirates' | 'crisis';
}

/** A choice offered by a discovery (Constellations 3.2). */
export interface Decision { id: number; anomalyId: number; kind: string; planetId: number; year: number; fleetId?: number }

/** Constellations 3.2: a discovery waiting on a planet (anomaly, archaeological site, the Ancients' vault). */
export interface Anomaly {
  id: number;
  planetId: number;
  kind: string;
  /** difficulty 1..5: study points needed */
  level: number;
  /** archaeological site: chapters already deciphered */
  chapter?: number;
  /** players who know about it */
  known: number[];
  /** study points accumulated by each player (current chapter for a site) */
  progress: Record<number, number>;
  doneBy?: number;
  doneYear?: number;
  /** the Ancients' vault stays hidden until a player has gathered enough fragments */
  hidden?: boolean;
}

/** Constellations 3.2: a guardian watching over a planet. */
export interface Guardian { id: number; planetId: number; kind: string; tier: number; fleetId: number; alive: boolean; killedBy?: number; killedYear?: number }

export interface SecretObjective { id: string; param?: number; /** rival player (vendetta) */ param2?: number; done?: number; failed?: number }

export type AIDifficulty = 'easy' | 'standard' | 'harder' | 'expert';

export interface AIState {
  phase: 'expand' | 'build' | 'war';
  targetPlayer?: number;
  lastDesignYear: number;
  scouted: number[];
  colonyTargets: Record<number, number>; // planet id -> fleet id
  attackStartYear?: number;
  /** planet id -> troop fleet id */
  troopClaims?: Record<number, number>;
  /** planet id -> minelayer fleet id */
  mineClaims?: Record<number, number>;
  staging?: number;
  /** Constellations 3: a rival's Portail to destroy */
  portalTarget?: number;
  /** Constellations 3.4: the Breach of the crisis (planet id), while the Nexus stands */
  crisisTarget?: number;
  /** 0.3.9.14: the enemy world the main fleet went to take (the troops follow once its orbit is held) */
  siege?: number;
  /** 0.3.9.14: the warships designed against the enemy's fleet (torpedoes or beams) */
  counter?: 'beamWarship' | 'torpedoWarship';
  /** 0.3.9.14: loaded colony ships with no world to go to (fleet id -> since when) */
  idleColonizers?: Record<number, number>;
  /** 0.3.9.14: refits waiting in a yard's queue (fleet id -> since when) */
  refitSince?: Record<number, number>;
}

export type MinefieldType = 'standard' | 'heavy' | 'speedBump';
export interface Minefield { id: number; owner: number; x: number; y: number; mines: number; type: MinefieldType; detonate: boolean }

export interface Packet {
  id: number;
  owner: number;
  x: number;
  y: number;
  targetId: number;
  warp: number;
  safeWarp: number;
  cargo: Minerals;
  /** built this turn: only moves half distance */
  newThisTurn: boolean;
  sourceId: number;
}

export interface Salvage { id: number; owner: number; x: number; y: number; cargo: Minerals; age: number }

export type Stability = 'rockSolid' | 'stable' | 'mostlyStable' | 'average' | 'slightlyVolatile' | 'volatile' | 'extremelyVolatile';
export const STABILITIES: Stability[] = ['rockSolid', 'stable', 'mostlyStable', 'average', 'slightlyVolatile', 'volatile', 'extremelyVolatile'];
export interface Wormhole {
  id: number; x: number; y: number; destId: number; stability: Stability; yearsAtStability: number;
  /** 0.3.7: the wormhole of a hidden cluster never moves; sealed until an empire has studied it open */
  fixed?: boolean;
  sealed?: boolean;
}

/** 0.3.7: the kinds of hidden stars. */
export type SecretKind = 'veiled' | 'dwarf' | 'ancients' | 'pulsar' | 'pocket' | 'blackhole' | 'dyson';

/**
 * 0.3.7: a hidden star (or, for the cluster behind a wormhole, a few of them). Its worlds are made with the galaxy but
 * only join `game.planets` when an empire first finds them; for the others they stay unknown until they find them too.
 */
export interface Secret {
  id: number;
  kind: SecretKind;
  name: string;
  /** where it is (the cluster: its wormhole in the galaxy) */
  x: number;
  y: number;
  /** its worlds before anyone found them */
  pending?: Planet[];
  /** their ids once found */
  ids: number[];
  /** empires that know where it is */
  known: number[];
  /** the world of the anomaly that puts on its track (the echo of the veiled star, the clocks of the pulsar) */
  clueAt?: number;
  /** veiled star: the way in through the cloud (outside first, the star last), its half-width and the cavity's radius */
  lane?: { x: number; y: number }[];
  laneWidth?: number;
  cavity?: number;
  /** veiled star: where to look for the way in (a rough zone), the empires that found it, sounding points so far */
  zone?: { x: number; y: number; r: number };
  tunnel?: number[];
  probe?: Record<number, number>;
  /** hidden cluster: its wormholes (the mouth in the galaxy, the end inside), the box it fills off the map, what waits there */
  mouthId?: number;
  endId?: number;
  box?: { x: number; y: number; w: number; h: number };
  outcome?: 'virgin' | 'dragon' | 'enclave' | 'swarm';
  /** study points spent on opening the sealed wormhole */
  open?: Record<number, number>;
  openedBy?: number;
  raids?: number;
  nextRaid?: number;
  /** pulsar: year of the next flare */
  nextFlare?: number;
  foundBy?: number;
  foundYear?: number;
}

export interface MysteryTrader {
  id: number;
  x: number;
  y: number;
  destX: number;
  destY: number;
  warp: number;
  reward: string;
  heading: { x: number; y: number } | null;
  rewarded: number[];
  /** Constellations 3.3.8: players it has hailed (it announces itself near their worlds, not from across the galaxy) */
  hailed?: number[];
}

export type UniverseSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge';
export type Density = 'Sparse' | 'Normal' | 'Dense' | 'Packed';
export type PlayerPositions = 'Close' | 'Moderate' | 'Farther' | 'Distant';

export interface VictoryConditions {
  ownPlanets: number | null; // percent
  attainTech: { level: number; fields: number } | null;
  exceedScore: number | null;
  exceedSecond: number | null; // percent
  production: number | null; // thousands
  capitalShips: number | null;
  highestAfter: number | null; // years
  numCriteria: number;
  minYears: number;
}

/**
 * 3.6: the region of space a game takes place in. 'arm', 'nursery' and 'bubble' are realistic at the scale of a map
 * (a few hundred to two thousand light-years); 'spiral', 'elliptical' and 'irregular' (whole galaxies) only remain for
 * games created with 0.3.5.8 to 0.3.6.2.
 */
export type GalaxyShape = 'arm' | 'nursery' | 'bubble' | 'spiral' | 'elliptical' | 'irregular' | 'square';
/**
 * A dark molecular cloud: impassable (at Warp speeds its dust is lethal); lobes in map units [-1, 1], melted into one
 * shape (shape.ts, cloudAt). `name` as written when the game was created, `ni` its index in the list of names (shown in
 * the player's language).
 */
export interface DarkCloud { name: string; ni?: number; lobes: { x: number; y: number; r: number }[] }
/** Constellations 3.6: parameters of the region's shape (see shape.ts); positions in map units [-1, 1]. */
export interface ShapeParams {
  kind: GalaxyShape;
  seed: number;
  rot: number;
  arms: number;
  twist: number;
  flat: number;
  blobs: { x: number; y: number; r: number }[];
  /** the spiral arm crossing the map: direction, offset of its centre line, curvature, half-width */
  arm?: { angle: number; offset: number; curve: number; width: number };
  /** young stellar associations and clusters: denser spots */
  clumps?: { x: number; y: number; r: number; a: number }[];
  /** superbubbles blown by old supernovae: few stars inside, a dense shell */
  voids?: { x: number; y: number; r: number }[];
  /** the impassable dark clouds */
  walls?: DarkCloud[];
  /** 0.3.6.8: narrow passes carved through the clouds (segments and half-width, map units): chokepoints */
  passes?: { x1: number; y1: number; x2: number; y2: number; w: number }[];
}

export interface GameSettings {
  size: UniverseSize;
  density: Density;
  positions: PlayerPositions;
  maxMinerals: boolean;
  slowTech: boolean;
  accelerated: boolean;
  randomEvents: boolean;
  aiAlliances: boolean;
  publicScores: boolean;
  clumping: boolean;
  /** Constellations option (user request): ordinary scanners only reveal anonymous contacts */
  anonymousContacts: boolean;
  /** Constellations: MoO2-like random breakthroughs (estimated, not exact, research times) */
  randomResearch?: boolean;
  /** Constellations: every game moves each technology's requirement by up to ±2 levels (hidden) */
  fuzzyTechTree?: boolean;
  /** Constellations 3: nebulae, ion storms and dense clusters */
  terrain?: boolean;
  /** Constellations 3: efficiency falls with the distance to a capital; conquered worlds are disorganised */
  distanceCost?: boolean;
  /** Constellations 3: migration policies and the logistics network (automatic, raidable convoys) */
  logistics?: boolean;
  /** Constellations 3: ship roles, threat-based targeting, retreat thresholds */
  combatRoles?: boolean;
  /** Constellations 3: exclusive research doctrines */
  doctrines?: boolean;
  /** Constellations 3: megaprojects (alternative victory) */
  megaprojects?: boolean;
  /** Constellations 3: two hidden objectives per empire */
  secretObjectives?: boolean;
  /** Constellations 3: decoys and uncertain contact masses */
  deception?: boolean;
  /** Constellations 3.2: anomalies, archaeological sites, relics */
  anomalies?: boolean;
  /** Constellations 3.2: guardians on rich worlds far from the homeworlds */
  guardians?: boolean;
  /** Constellations 3.2: each empire has an origin (chosen at the start) */
  origins?: boolean;
  /** Constellations 3.3: culture, territories (no colony in another's), assimilation of dominated worlds */
  culture?: boolean;
  /** Constellations 3.4: pirate lairs raiding the empire with the highest bounty */
  pirates?: boolean;
  /** Constellations 3.4: an endgame crisis (the Breach and its waves) */
  crisis?: boolean;
  /** Constellations 3.4: negotiated diplomacy (war and peace, treaties, opinions) */
  diplomacy?: boolean;
  /** Constellations 3.5: intelligence on the other empires is gathered (scanners, treaties, embassies, spies) */
  espionage?: boolean;
  /** Constellations 3.6: the wrecks of enemy ships destroyed may teach their technology */
  debris?: boolean;
  /** 0.3.9: crews gain experience in battle (ranks, bonuses, the fleet's log) */
  veterans?: boolean;
  /** 0.3.9: a computer empire you hurt too much swears your destruction */
  nemesis?: boolean;
  /** 0.3.9: the game in three acts, each changing a few rules */
  acts?: boolean;
  /** 0.3.9: the Portal of the Ascension needs three relays on three worlds */
  portalRelays?: boolean;
  /** 0.3.9: an empire without a world lives on while an ark carries its people */
  diaspora?: boolean;
  /** 0.3.9: supernovae and wandering black holes, announced years ahead */
  cataclysms?: boolean;
  /** 0.3.9: culture becomes inspiration, and inspiration golden ages */
  goldenAges?: boolean;
  /** 0.3.9: hard choices offered now and then */
  dilemmas?: boolean;
  /** 0.3.9: stories that unfold over decades */
  eventChains?: boolean;
  /** 0.3.9: the origin of the Breach, to investigate, and the seal of the Ancients (another victory) */
  ancientSecret?: boolean;
  /** 0.3.9: each origin has a victory of its own */
  originVictories?: boolean;
  /** 0.3.9: sector governors */
  governors?: boolean;
  /** Constellations 3.6: the shape of the galaxy (absent: the square of Stars!) */
  shape?: GalaxyShape;
  /** Constellations 3.6: created with the "close to the original Stars!" preset */
  classic?: boolean;
  /** Constellations 3.6: populations shown in millions (one colonist of the rules = a thousand people); display only */
  popUnits?: 'millions';
  victory: VictoryConditions;
  seed: string;
}

export interface BattleTokenRecord {
  id: number;
  owner: number;
  fleetId: number; // -1 for starbase
  planetId?: number;
  designId: number;
  designName: string;
  hull: string;
  qty: number;
  armor: number; // per ship
  shields: number; // per ship
  damage: number; // per damaged ship at start
  qtyDamaged: number;
  x: number;
  y: number;
  initiative: number;
  movement: number;
  starbase: boolean;
}

export type BattleAction =
  | { t: 'round'; round: number }
  | { t: 'move'; id: number; x: number; y: number }
  | { t: 'fire'; id: number; target: number; weapon: string; torpedo: boolean; hits?: number; misses?: number; shieldDmg: number; armorDmg: number; killed: number; fromX: number; fromY: number }
  | { t: 'leave'; id: number }
  | { t: 'state'; id: number; qty: number; shields: number; damage: number; qtyDamaged: number };

export interface BattleRecord {
  id: number;
  year: number;
  x: number;
  y: number;
  planetId?: number;
  players: number[];
  tokens: BattleTokenRecord[];
  actions: BattleAction[];
  losses: Record<number, number>; // player -> ships lost
  rounds: number;
}

export interface Landing { planetId: number; owner: number; kt: number; fleetId: number; fleetName: string }

export interface GameState {
  format: 'constellations-1';
  /** identifies the save slot in the browser */
  id?: string;
  name: string;
  year: number;
  settings: GameSettings;
  rng: [number, number, number, number];
  width: number;
  height: number;
  planets: Planet[];
  fleets: Fleet[];
  designs: ShipDesign[];
  players: Player[];
  minefields: Minefield[];
  packets: Packet[];
  salvage: Salvage[];
  /**
   * 0.3.9.16: troops landed on another empire's world (or on one emptied by bombs this year), waiting for the ground
   * combat of the phase (all those of a world fight together, as in Stars!)
   */
  landings?: Landing[];
  /** 0.3.9.16: worlds emptied by bombs this year, and who held them (they can still be taken by troops this year) */
  emptied?: Record<number, { owner: number; year: number }>;
  wormholes: Wormhole[];
  traders: MysteryTrader[];
  battles: BattleRecord[];
  nextId: number;
  human: number;
  /** hotseat: humans who already gave their orders this year */
  submitted?: number[];
  /** 0.3.9: a game played by turn files (pbem.ts): the host's game, or a player's copy of a turn */
  pbem?: PbemState;
  victor: number | null;
  victoryAnnounced: boolean;
  /** Constellations 3: nebulae, ion storms, dense clusters */
  terrain?: Terrain[];
  /** Constellations 3.6: the galaxy's natural shape (absent: a square) */
  shape?: ShapeParams;
  /** how the game was won, when it was */
  victoryKind?: 'conditions' | 'megaproject' | 'lastStanding' | 'crisis' | 'seal' | 'origin';
  /** 0.3.9: what the Breach is (ancients.ts), and the anchor world of the seed */
  breachSecret?: { kind: string; anchor?: number };
  /** Constellations 3.2: anomalies and archaeological sites */
  anomalies?: Anomaly[];
  /** Constellations 3.2: guardians, and the id of their pseudo-player */
  guardians?: Guardian[];
  monsterId?: number;
  /** 0.3.7: the hidden stars */
  secrets?: Secret[];
  /** Constellations 3.4: the pirates */
  pirates?: PirateState;
  /** Constellations 3.4: the endgame crisis */
  crisis?: CrisisState;
  /** Constellations 3.4: negotiated diplomacy */
  diplomacy?: DiplomacyState;
  /** 0.3.8: the tutorial's progress (only in the tutorial game; the engine never reads it) */
  tutorial?: TutorialState;
  /** 0.3.9: the computer empires sworn to destroy a human one */
  nemeses?: Nemesis[];
  /** 0.3.9: the history of the game (events, territory year by year) */
  chronicle?: Chronicle;
  /** 0.3.9: the current act (rule acts) */
  act?: { n: 1 | 2 | 3; since: number; why?: string };
  /** 0.3.9: cataclysms announced or past, and the year the next one may come */
  cataclysms?: Cataclysm[];
  cataNext?: number;
  /** 0.3.9: the stories under way or told (chains.ts) */
  chains?: StoryChain[];
}

/** 0.3.9: a story of several steps lived by an empire. */
export interface StoryChain { id: number; kind: string; owner: number; stage: number; next: number; data: Record<string, number | string>; done?: number }

/** 0.3.9: a supernova (a star, a date) or a wandering black hole (a position, a drift per year). */
export interface Cataclysm {
  id: number;
  kind: 'supernova' | 'blackhole';
  announced: number;
  x: number;
  y: number;
  /** supernova: the star and the year it blows */
  planetId?: number;
  at?: number;
  /** black hole: light-years per year */
  vx?: number;
  vy?: number;
  /** countdown steps already told (years left), worlds already warned */
  told?: number[];
  warned?: number[];
  done?: number;
}

/** 0.3.9: a computer empire that has sworn to destroy a human one. */
export interface Nemesis {
  /** the human empire */
  of: number;
  /** the computer empire */
  ai: number;
  since: number;
  /** most worlds it held since */
  peak: number;
  /** year it was broken (beaten: it gives up its hatred) */
  broken?: number;
  /** last year it sent a message */
  said: number;
  /** the weapons it chose against you (it studies your warships) */
  counter?: 'beamWarship' | 'torpedoWarship';
}

/** 0.3.9: a notable event of the game. who: the empires concerned (everyone knows what concerns them, or empires they met). */
export interface ChronicleEvent { year: number; kind: ChronicleKind; text: string; who: number[]; x?: number; y?: number }
export type ChronicleKind = 'start' | 'contact' | 'war' | 'peace' | 'alliance' | 'conquest' | 'capital' | 'death' | 'mega' | 'crisis' | 'nemesis' | 'victory' | 'guardian' | 'secret' | 'worlds' | 'veteran' | 'golden' | 'cataclysm' | 'act' | 'diaspora' | 'event';
export interface Chronicle {
  events: ChronicleEvent[];
  /** who held each planet, every few years: one character per planet (owner + 1, from '0') */
  frames: { year: number; owners: string }[];
}

/** 0.3.8: where the player is in the tutorial, and the objects it points at (chosen when the game is created). */
export interface TutorialState {
  /** current chapter id, or 'menu' for the list of chapters */
  chapter: string;
  /** index of the step in the chapter */
  step: number;
  /** chapters finished */
  done: string[];
  /** the card is closed (the game goes on; the tutorial can be resumed from the menu) */
  hidden?: boolean;
  /** the card is folded to a small bar */
  folded?: boolean;
  /** where the player was when opening the list of chapters */
  back?: { chapter: string; step: number };
  /** planets and fleets the steps refer to */
  targets: { colony: number; scout: number; probe: number; scoutFleet: number; probeFleet: number; arkFleet: number; startFleets: number[]; startDesigns?: number[] };
}

/** Constellations 3.4: a pirate lair (an immobile fort and its garrison, on a planet). */
export interface PirateLair { planetId: number; name: string; fleetId: number; alive: boolean; killedBy?: number; killedYear?: number }

export interface PirateState {
  /** pseudo-player id */
  id: number;
  /** year they appear (lairs placed then) */
  emergeYear: number;
  emerged: boolean;
  lairs: PirateLair[];
  /** resources on each empire's head */
  bounty: Record<number, number>;
  /** bounties placed by each empire on each other (placer -> target -> R), for the placer's eyes only */
  placed?: Record<number, Record<number, number>>;
  /** what they have plundered and been paid (makes the raids bigger) */
  treasure: number;
  nextRaid: number;
  raids: number;
  /** empire aimed at by the last raid */
  lastTarget?: number;
  ended?: boolean;
  /** the last plunders (for the Empire page) */
  log?: { year: number; empire: number; planet: number; loot: number }[];
}

/** Constellations 3.4: negotiated diplomacy between two empires. */
export type DiploStatus = 'war' | 'peace' | 'alliance';
export interface DiploPair {
  status: DiploStatus;
  /** year the status began */
  since: number;
  /** treaties (year signed) */
  trade?: number;
  research?: number;
  /** Constellations 3.5: embassies opened in each other's capital (year) */
  embassy?: number;
  /** wars fought against each other */
  wars: number;
  /** this war: ships and worlds lost, by empire */
  losses?: Record<number, number>;
  /** 3.6: this war: value of the ships lost (resources + minerals), by empire */
  lossValue?: Record<number, number>;
  planets?: Record<number, number>;
  /** 0.3.7: year of the last tribute demanded, by the empire that demanded it (one every three years) */
  tribute?: Record<number, number>;
}
/** What an empire remembers of another (decays with time). */
export interface DiploMemory { by: number; about: number; kind: 'war' | 'betrayal' | 'dishonor' | 'gift' | 'demand' | 'broken' | 'conquest' | 'assimilation' | 'ally' | 'refused' | 'spying' | 'choice'; value: number; year: number; decay: number }
/** 0.3.9.10: 'borders': the proposer asks the other empire to open its borders to it. */
export type ProposalKind = 'peace' | 'trade' | 'research' | 'alliance' | 'tribute' | 'embassy' | 'borders';
/** A proposal waiting for an answer (to a human player). */
export interface Proposal { id: number; from: number; to: number; kind: ProposalKind; year: number; expires: number; /** minerals (kt) that change hands with it, and who pays */ minerals?: number; payer?: number }
export interface DiplomacyState {
  pairs: Record<string, DiploPair>;
  memory: DiploMemory[];
  proposals: Proposal[];
  /** yearly bonuses from treaties, by empire */
  bonus: Record<number, { trade: number; research: number }>;
  log: { year: number; a: number; b: number; text: string }[];
}

/** Constellations 3.4: the endgame crisis. */
export interface CrisisState {
  id: number;
  phase: 'dormant' | 'omen' | 'active' | 'ended';
  /** year the omens start, and the Breach opens */
  omenYear: number;
  openYear: number;
  planetId?: number;
  nexusFleetId?: number;
  wave: number;
  nextWave: number;
  endedYear?: number;
  endedBy?: number;
  /** 3.6: the schedule of 3.6 applies (a dormant crisis of an older save is postponed once) */
  sched?: number;
  /** 0.3.9: closed by the Seal of the Ancients */
  sealed?: boolean;
}

export type TerrainKind = 'nebula' | 'storm' | 'cluster';
/** A region of space: a circle (storms drift every year). */
export interface Terrain { id: number; kind: TerrainKind; x: number; y: number; r: number; name: string; dx?: number; dy?: number }
