// Shapes of the generated Stars! data tables.
export interface TechReq {
  en: number; we: number; pr: number; co: number; el: number; bi: number;
  prtsRequired?: string[]; prtsDenied?: string[];
  lrtsRequired?: string[]; lrtsDenied?: string[];
  hullsAllowed?: string[]; hullsDenied?: string[];
  acquirable?: boolean;
}

export type TechCategory =
  | 'Engine' | 'Orbital' | 'MineRobot' | 'Bomb' | 'Scanner' | 'Armor' | 'Electrical' | 'MineLayer'
  | 'Mechanical' | 'BeamWeapon' | 'Torpedo' | 'Shield' | 'PlanetaryScanner' | 'PlanetaryDefense'
  | 'Terraforming' | 'Planetary';

export interface TechStats {
  ability?: number; accuracy?: number; armor?: number; beamBonus?: number; beamDefense?: number;
  canJump?: boolean; canStealFleetCargo?: boolean; canStealPlanetCargo?: boolean; capitalShipMissile?: boolean;
  cargoBonus?: number; cloakUnarmedOnly?: boolean; cloakUnits?: number; colonizationModule?: boolean;
  damageShieldsOnly?: boolean; defenseCoverage?: number; fuelBonus?: number; fuelGeneration?: number;
  gatling?: boolean; habType?: string; hitsAllTargets?: boolean; initiative?: number; initiativeBonus?: number;
  killRate?: number; maxHullMass?: number; maxRange?: number; minKillRate?: number; mineLayingRate?: number;
  minefieldType?: string; miningRate?: number; movementBonus?: number; orbitalConstructionModule?: boolean;
  packetSpeed?: number; power?: number; radiating?: boolean; range?: number; reduceCloaking?: boolean;
  reduceMovement?: number; resetPlanet?: boolean; safeHullMass?: number; safeRange?: number;
  scanRange?: number; scanRangePen?: number; shield?: number; smart?: boolean; structureDestroyRate?: number;
  terraformRate?: number; torpedoBonus?: number; torpedoJamming?: number; unterraformRate?: number;
  /** Constellations: apparent extra mass projected by a decoy (kt per part) */
  decoyMass?: number;
  /** Constellations 3.3: a sovereignty beacon, set up in orbit of a free world to claim it */
  beaconKit?: boolean;
}

export interface EngineData { ideal: number; free: number; maxSafe: number; fuel: number[]; scoop: boolean; radiating: boolean }

export interface TechData {
  name: string;
  cat: TechCategory;
  tags: string[];
  req: TechReq;
  /** [ironium, boranium, germanium, resources] */
  cost: [number, number, number, number] | number[];
  rank: number;
  origin?: string;
  mass?: number;
  slot?: string;
  stats?: TechStats;
  engine?: EngineData;
}

export interface HullSlotData { types: string[]; cap: number; req: boolean; x: number; y: number }

export interface HullData {
  name: string;
  type: string;
  starbase: boolean;
  req: TechReq;
  cost: number[];
  rank: number;
  origin?: string;
  mass: number;
  armor: number;
  fuel: number;
  cargo: number;
  init: number;
  slots: HullSlotData[];
  fuelGen?: number;
  dock?: number;
  mineLayingBonus?: number;
  repairBonus?: number;
  immuneToOwnDetonation?: boolean;
  rangeBonus?: number;
  builtInScanner?: boolean;
  doubleMineEfficiency?: boolean;
  maxPop?: number;
  innatePenFactor?: number;
  orbitalConstruction?: boolean;
  cargoBox?: { x: number; y: number; w: number; h: number; circle: boolean };
  dockBox?: { x: number; y: number; w: number; h: number; circle: boolean };
}
