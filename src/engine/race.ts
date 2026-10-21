// Races: primary/lesser racial traits, habitability, advantage points, derived race spec.
import type { Field, Hab, LeftoverSpend, LRT, PRT, Race, ResearchCostLevel, TechLevels } from './types';
import { FIELDS } from './types';

export interface TraitInfo { code: string; name: string; desc: string }

export const PRT_INFO: Record<PRT, TraitInfo> = {
  HE: { code: 'HE', name: 'Essaimage', desc: "Vous devez vous étendre pour survivre. Vous disposez d'une petite arche bon marché et d'un moteur qui voyage à Warp 6 sans carburant. Votre population croît deux fois plus vite que le taux choisi, mais la population maximale de chaque planète est divisée par deux. La coque Métamorphe et l'Amplificateur de flux vous sont réservés, mais vous ne pouvez pas construire de portails." },
  SS: { code: 'SS', name: 'Furtivité', desc: "Vous traversez le territoire ennemi sans être vu. Tous vos vaisseaux ont 75 % de camouflage intégré et la cargaison ne réduit pas ce camouflage. Coques Bombardier furtif et Maraudeur, composants furtifs et deux capteurs capables de voler des minerais aux flottes et planètes ennemies. Vous traversez les champs de mines un cran de Warp plus vite sans risque et vous espionnez passivement la recherche des autres." },
  WM: { code: 'WM', name: 'Conquête', desc: "Vous dominez le champ de bataille. Vos colons attaquent mieux, vos vaisseaux sont plus rapides au combat et vos armes coûtent 25 % de moins. Vous commencez avec Armement 6, Énergie 1 et Propulsion 1, et pourrez construire le Croiseur lourd et le Léviathan. En revanche vous ne construisez que des défenses planétaires élémentaires et aucun mouilleur de mines." },
  CA: { code: 'CA', name: 'Façonnage planétaire', desc: "Vous êtes expert en manipulation des environnements. Vous commencez avec Biotechnologie 6 et un vaisseau capable de terraformer depuis l'orbite. Vos bombes peuvent dé-terraformer les mondes ennemis. La terraformation ne vous coûte rien, les planètes que vous quittez retrouvent leur environnement d'origine, et chaque planète a jusqu'à 10 % de chances par an d'améliorer définitivement une variable d'environnement de 1 %." },
  IS: { code: 'IS', name: 'Résilience', desc: "Vous êtes coriace. Vos colons repoussent mieux les invasions, vos vaisseaux se réparent deux fois plus vite et vous disposez de protections uniques et de champs de mines ralentisseurs (herses). Défenses planétaires 40 % moins chères, armes 25 % plus chères. Vos colons se reproduisent à mi-vitesse dans vos cargos. Votre peuple pacifique refuse les bombes ciblées." },
  SD: { code: 'SD', name: 'Artificiers', desc: "Vous êtes expert en champs de mines. Vous commencez avec deux mouilleurs, Propulsion 2 et Biotechnologie 2. Vos champs se dégradent plus lentement, détectent les vaisseaux ennemis, peuvent être posés en mouvement et vos champs standard peuvent être détonés à distance. Vous traversez les champs ennemis deux crans de Warp plus vite sans risque." },
  PP: { code: 'PP', name: 'Balistique de masse', desc: "Vous excellez dans le lancement de paquets de minerais. Vous commencez avec Énergie 4, une catapulte Warp 5 sur votre station et une seconde planète. Vos paquets sont plus petits, moins chers, se dégradent moins vite, emportent un scanner pénétrant et peuvent terraformer la cible s'ils ne sont pas entièrement captés." },
  IT: { code: 'IT', name: 'Maîtrise des portails', desc: "Vous excellez dans les portails. Vous commencez avec Propulsion 5 et Construction 5, un assortiment de vaisseaux et une seconde planète, toutes deux équipées de portails. Vos vaisseaux franchissent les portails avec leur cargaison et risquent moins en dépassant les limites. Portails 25 % moins chers ; ils scannent les planètes ennemies équipées de portails à portée. Vos catapultes sont en revanche médiocres." },
  AR: { code: 'AR', name: 'Vie orbitale', desc: "Votre peuple vit en orbite dans ses stations (20 % moins chères) et ne peut pas vivre sur les planètes. Si la station est détruite, toute la colonie meurt. Pas d'installations planétaires, mais une capacité innée de minage et de détection, et le minage à distance de vos propres mondes. La population maximale dépend de la station, la production de l'habitabilité et du niveau d'Énergie. Vous pourrez construire la Forteresse-monde." },
  JoaT: { code: 'JoaT', name: 'Polyvalence', desc: "Votre race ne se spécialise dans aucun domaine. Vous commencez avec un niveau 3 dans toutes les technologies et un large assortiment de vaisseaux. Vos coques Vedette, Frégate et Contre-torpilleur ont un scanner pénétrant intégré qui progresse avec l'Électronique. Votre population maximale par planète est 20 % plus élevée." },
};

export const LRT_INFO: Record<LRT, TraitInfo & { points: number }> = {
  IFE: { code: 'IFE', name: 'Sobriété', points: -235, desc: "Accès aux moteurs Économiseur et Statoréacteur galactique, +1 niveau de Propulsion au départ. Tous les moteurs consomment 15 % de carburant en moins." },
  TT: { code: 'TT', name: 'Terraformation totale', points: -25, desc: "Technologies de terraformation supplémentaires via la Biotechnologie, de ±3 % sur les trois variables jusqu'à ±30 %. La terraformation coûte 30 % de moins." },
  ARM: { code: 'ARM', name: 'Forage avancé', points: -159, desc: "Trois coques de forage et deux robots supplémentaires. Vous commencez avec deux Foreuses naines." },
  ISB: { code: 'ISB', name: 'Stations améliorées', points: -201, desc: "Deux nouvelles stations : la Cale orbitale, bon marché avec un petit chantier, et la Citadelle orbitale. Vos stations sont camouflées à 20 % et coûtent 20 % de moins." },
  GR: { code: 'GR', name: 'Recherche généralisée', points: 40, desc: "Seule la moitié des ressources de recherche va au domaine choisi, mais chacun des cinq autres domaines reçoit en plus 15 % du total (125 % au total)." },
  UR: { code: 'UR', name: 'Recyclage ultime', points: -240, desc: "Démanteler une flotte sur une station récupère 90 % des minerais et jusqu'à 70 % des ressources, disponibles l'année suivante. Sur une planète sans station, moitié moins." },
  MA: { code: 'MA', name: 'Alchimie minérale', points: -155, desc: "L'alchimie coûte 25 ressources au lieu de 100 pour produire 1 kt de chaque minerai." },
  NRSE: { code: 'NRSE', name: 'Sans statoréacteurs', points: 160, desc: "Aucun statoréacteur (moteurs qui récupèrent du carburant en route). Vous obtenez l'Interstice 10, capable de Warp 10 sans danger bien plus tôt." },
  CE: { code: 'CE', name: 'Moteurs bon marché', points: 240, desc: "Moteurs 50 % moins chers mais peu fiables : au-dessus de Warp 6, 10 % de chances par an qu'ils refusent de démarrer. +1 niveau de Propulsion au départ." },
  OBRM: { code: 'OBRM', name: 'Forage basique seulement', points: 255, desc: "Seule la Mini-foreuse est disponible pour le forage à distance (annule Forage avancé). Population maximale par planète +10 %." },
  NAS: { code: 'NAS', name: 'Sans scanners avancés', points: 325, desc: "Aucun scanner pénétrant, mais la portée des scanners classiques est doublée." },
  LSP: { code: 'LSP', name: 'Faible population initiale', points: 180, desc: "Vous commencez avec 30 % de colons en moins (17 500 au lieu de 25 000)." },
  BET: { code: 'BET', name: 'Technologie de pointe', points: 70, desc: "Une technologie neuve coûte deux fois plus cher à construire jusqu'à ce que vous dépassiez d'un niveau tous ses prérequis. Miniaturisation 5 % par niveau jusqu'à 80 % (au lieu de 4 % et 75 %)." },
  RS: { code: 'RS', name: 'Boucliers régénérants', points: 30, desc: "Boucliers 40 % plus forts, régénération de 10 % par round tant qu'ils tiennent. Les composants de blindage n'ont que 50 % de leur valeur." },
};

export const PRT_LIST: PRT[] = ['HE', 'SS', 'WM', 'CA', 'IS', 'SD', 'PP', 'IT', 'AR', 'JoaT'];
export const LRT_LIST: LRT[] = ['IFE', 'TT', 'ARM', 'ISB', 'GR', 'UR', 'MA', 'NRSE', 'CE', 'OBRM', 'NAS', 'LSP', 'BET', 'RS'];
export const PRT_POINT_COST: Record<PRT, number> = { HE: -40, SS: -95, WM: -45, CA: -10, IS: 100, SD: 150, PP: -120, IT: -180, AR: -90, JoaT: 66 };

const allStd = (): Record<Field, ResearchCostLevel> => ({ energy: 'standard', weapons: 'standard', propulsion: 'standard', construction: 'standard', electronics: 'standard', biotechnology: 'standard' });
const rc = (e: ResearchCostLevel, w: ResearchCostLevel, p: ResearchCostLevel, c: ResearchCostLevel, el: ResearchCostLevel, b: ResearchCostLevel): Record<Field, ResearchCostLevel> =>
  ({ energy: e, weapons: w, propulsion: p, construction: c, electronics: el, biotechnology: b });

function baseRace(): Race {
  return {
    name: 'Terrien', pluralName: 'Terriens', prt: 'JoaT', lrts: [],
    habLow: [15, 15, 15], habHigh: [85, 85, 85], immune: [false, false, false],
    growthRate: 15, popEfficiency: 10, factoryOutput: 10, factoryCost: 10, numFactories: 10, factoriesCostLess: false,
    mineOutput: 10, mineCost: 5, numMines: 10, researchCost: allStd(), techsStartHigh: false, leftover: 'surfaceMinerals', icon: 0,
  };
}

/** The predefined races of the Stars! race wizard (values checked against Stars! 2.70j). */
/** Keys of the predefined races (a union type, so that the i18n extractor never takes them for text). */
export type PresetKey = 'Humanoid' | 'Rabbitoid' | 'Insectoid' | 'Nucleotid' | 'Silicanoid' | 'Antetheral';
export const PREDEFINED_RACES: Record<string, () => Race> = {
  Humanoid: () => baseRace(),
  Rabbitoid: () => ({ ...baseRace(), name: 'Bondisseur', pluralName: 'Bondisseurs', prt: 'IT', lrts: ['IFE', 'TT', 'CE', 'NAS'], habLow: [10, 35, 13], habHigh: [56, 81, 53], growthRate: 20, factoryCost: 9, numFactories: 17, factoriesCostLess: true, mineCost: 9, researchCost: rc('extra', 'extra', 'less', 'standard', 'standard', 'less'), leftover: 'defenses', icon: 1 }),
  Insectoid: () => ({ ...baseRace(), name: 'Chitineux', pluralName: 'Chitineux', prt: 'WM', lrts: ['ISB', 'CE', 'RS'], habLow: [0, 0, 70], habHigh: [100, 100, 100], immune: [true, false, false], growthRate: 10, mineOutput: 9, mineCost: 10, numMines: 6, researchCost: rc('less', 'less', 'less', 'less', 'standard', 'extra'), leftover: 'mineralConcentrations', icon: 2 }),
  Nucleotid: () => ({ ...baseRace(), name: 'Hélicoïde', pluralName: 'Hélicoïdes', prt: 'SS', lrts: ['ARM', 'ISB'], habLow: [0, 12, 0], habHigh: [100, 88, 100], immune: [true, false, false], growthRate: 10, popEfficiency: 9, numFactories: 10, mineOutput: 10, mineCost: 15, numMines: 5, researchCost: rc('extra', 'extra', 'extra', 'extra', 'extra', 'extra'), techsStartHigh: true, leftover: 'factories', icon: 3 }),
  Silicanoid: () => ({ ...baseRace(), name: 'Cristallin', pluralName: 'Cristallins', prt: 'HE', lrts: ['IFE', 'UR', 'OBRM', 'BET'], habLow: [0, 0, 0], habHigh: [100, 100, 100], immune: [true, true, true], growthRate: 6, popEfficiency: 8, factoryOutput: 12, factoryCost: 12, numFactories: 15, mineOutput: 10, mineCost: 9, numMines: 10, researchCost: rc('standard', 'standard', 'less', 'less', 'standard', 'extra'), leftover: 'factories', icon: 4 }),
  Antetheral: () => ({ ...baseRace(), name: 'Éthéré', pluralName: 'Éthérés', prt: 'SD', lrts: ['ARM', 'MA', 'NRSE', 'CE', 'NAS'], habLow: [0, 0, 70], habHigh: [30, 100, 100], growthRate: 7, popEfficiency: 7, factoryOutput: 11, factoryCost: 10, numFactories: 18, mineOutput: 10, mineCost: 10, numMines: 10, researchCost: rc('less', 'extra', 'less', 'less', 'less', 'less'), leftover: 'surfaceMinerals', icon: 5 }),
};
export const PREDEFINED_ORDER = ['Humanoid', 'Rabbitoid', 'Insectoid', 'Nucleotid', 'Silicanoid', 'Antetheral'];
export const PREDEFINED_LABELS: Record<string, string> = { Humanoid: 'Terrien', Rabbitoid: 'Bondisseur', Insectoid: 'Chitineux', Nucleotid: 'Hélicoïde', Silicanoid: 'Cristallin', Antetheral: 'Éthéré' };

export function cloneRace(r: Race): Race {
  return JSON.parse(JSON.stringify(r));
}

/**
 * 0.3.9.21: a race read from outside (an imported file, the browser's saved races) held to what the wizard allows:
 * known traits, whole values within the wizard's bounds (a popEfficiency of 7.01 used to save some 800 points), a hab
 * range inside 0..100. Returns an error for what is not a race at all.
 */
export function sanitizeRace(raw: unknown): Race | string {
  if (!raw || typeof raw !== 'object') return 'ce n\'est pas une race';
  const x = raw as Record<string, any>;
  if (!PRT_LIST.includes(x.prt)) return `type principal inconnu (${String(x.prt)})`;
  if (!Array.isArray(x.habLow) || !Array.isArray(x.habHigh)) return 'ce n\'est pas une race';
  const r = baseRace();
  const int = (v: unknown, lo: number, hi: number, d: number) => Number.isFinite(+(v as number)) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(+(v as number)))) : d;
  const str = (v: unknown, d: string) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : d;
  r.name = str(x.name, r.name); r.pluralName = str(x.pluralName, r.name);
  r.prt = x.prt;
  r.lrts = [...new Set((Array.isArray(x.lrts) ? x.lrts : []).filter((l: unknown) => LRT_LIST.includes(l as LRT)))] as LRT[];
  if (r.lrts.includes('OBRM') && r.lrts.includes('ARM')) r.lrts = r.lrts.filter(l => l !== 'ARM');
  for (let i = 0; i < 3; i++) {
    const lo = int(x.habLow[i], 0, 100, 15), hi = int(x.habHigh[i], 0, 100, 85);
    r.habLow[i] = Math.min(lo, hi); r.habHigh[i] = Math.max(lo, hi);
    r.immune[i] = Array.isArray(x.immune) && x.immune[i] === true;
  }
  r.growthRate = int(x.growthRate, 1, 20, r.growthRate);
  r.popEfficiency = int(x.popEfficiency, 7, 25, r.popEfficiency);
  r.factoryOutput = int(x.factoryOutput, 5, 15, r.factoryOutput);
  r.factoryCost = int(x.factoryCost, 5, 25, r.factoryCost);
  r.numFactories = int(x.numFactories, 5, 25, r.numFactories);
  r.factoriesCostLess = x.factoriesCostLess === true;
  r.mineOutput = int(x.mineOutput, 5, 25, r.mineOutput);
  r.mineCost = int(x.mineCost, 2, 15, r.mineCost);
  r.numMines = int(x.numMines, 5, 25, r.numMines);
  for (const f of Object.keys(r.researchCost) as Field[]) {
    const v = x.researchCost?.[f];
    r.researchCost[f] = v === 'extra' || v === 'less' ? v : 'standard';
  }
  r.techsStartHigh = x.techsStartHigh === true;
  r.leftover = (['surfaceMinerals', 'mines', 'factories', 'defenses', 'mineralConcentrations'] as LeftoverSpend[]).includes(x.leftover) ? x.leftover : 'surfaceMinerals';
  r.icon = int(x.icon, 0, 999, 0);
  return r;
}

export function habCenter(race: Race): Hab {
  return [0, 1, 2].map(i => Math.trunc((race.habHigh[i] - race.habLow[i]) / 2) + race.habLow[i]) as Hab;
}

/** Planet value for a race, -45..100 (Stars! formula). */
export function habitability(race: Race, hab: Hab): number {
  let points = 0, red = 0, ideality = 10000;
  for (let i = 0; i < 3; i++) {
    if (race.immune[i]) { points += 10000; continue; }
    const v = hab[i], lo = race.habLow[i], hi = race.habHigh[i];
    const c = Math.trunc((hi - lo) / 2) + lo;
    if (v >= lo && v <= hi) {
      let fromIdeal = Math.trunc(Math.abs(v - c) * 100);
      let radius: number, tmp: number;
      if (c > v) { radius = c - lo; tmp = c - v; } else { radius = hi - c; tmp = v - c; }
      fromIdeal = radius === 0 ? 0 : Math.trunc(fromIdeal / radius);
      const poorPlanetMod = tmp * 2 - radius;
      fromIdeal = 100 - fromIdeal;
      points += fromIdeal * fromIdeal;
      if (poorPlanetMod > 0) ideality = Math.trunc(ideality * (radius * 2 - poorPlanetMod) / (radius * 2));
    } else {
      const habRed = v >= lo ? v - hi : lo - v;
      red += Math.min(habRed, 15);
    }
  }
  if (red !== 0) return -red;
  points = Math.trunc(Math.sqrt(points / 3) + 0.9);
  return Math.trunc(points * ideality / 10000);
}

// ---------------------------------------------------------------- advantage points

function habForIndex(race: Race, h: number, i: number, n: number, start: number, width: number, loop: number, tt: number): [number, number] {
  let v = (i === 0 || n <= 1) ? start : Math.trunc(width * i / (n - 1)) + start;
  let off = 0;
  if (loop !== 0 && !race.immune[h]) {
    const c = habCenter(race)[h];
    let o = c - v;
    if (Math.abs(o) <= tt) o = 0; else if (o < 0) o += tt; else o -= tt;
    off = o; v = c - o;
  }
  return [v, off];
}

function habRangePoints(race: Race): number {
  const isTT = race.lrts.includes('TT');
  let points = 0;
  const its = race.immune.map(im => im ? 1 : 11);
  for (let loop = 0; loop < 3; loop++) {
    const tt = [0, isTT ? 8 : 5, isTT ? 17 : 15][loop];
    const start: number[] = [], width: number[] = [];
    for (let h = 0; h < 3; h++) {
      if (race.immune[h]) { start[h] = 50; width[h] = 11; }
      else {
        start[h] = Math.max(0, Math.min(100, race.habLow[h] - tt));
        width[h] = Math.max(0, Math.min(100, race.habHigh[h] + tt)) - start[h];
      }
    }
    let gravSum = 0;
    for (let ig = 0; ig < its[0]; ig++) {
      const [g, o0] = habForIndex(race, 0, ig, its[0], start[0], width[0], loop, tt);
      let tempSum = 0;
      for (let it = 0; it < its[1]; it++) {
        const [t, o1] = habForIndex(race, 1, it, its[1], start[1], width[1], loop, tt);
        let radSum = 0;
        for (let ir = 0; ir < its[2]; ir++) {
          const [r, o2] = habForIndex(race, 2, ir, its[2], start[2], width[2], loop, tt);
          let d = habitability(race, [g, t, r]);
          const offSum = o0 + o1 + o2;
          if (offSum > tt) d = Math.max(0, d - (offSum - tt));
          d = d * d * [7, 5, 6][loop];
          radSum += d;
        }
        radSum = race.immune[2] ? radSum * 11 : Math.trunc(radSum * width[2] / 100);
        tempSum += radSum;
      }
      tempSum = race.immune[1] ? tempSum * 11 : tempSum * width[1] / 100;
      gravSum += tempSum;
    }
    gravSum = race.immune[0] ? gravSum * 11 : gravSum * width[0] / 100;
    points += gravSum;
  }
  return Math.trunc(points / 10 + 0.5);
}

/** Advantage points left in the race wizard (Stars! algorithm). Must be >= 0 to be valid. */
export function advantagePoints(race: Race): number {
  let points = 1650;
  const habPoints = Math.trunc(habRangePoints(race) / 2000);
  let grf = race.growthRate;
  if (grf <= 5) points += (6 - grf) * 4200;
  else if (grf <= 13) { points += ({ 6: 3600, 7: 2250, 8: 600, 9: 225 } as Record<number, number>)[grf] ?? 0; grf = grf * 2 - 5; }
  else if (grf < 20) grf = (grf - 6) * 3;
  else grf = 45;
  points -= Math.trunc(Math.trunc(habPoints * grf) / 24);

  let numImmune = 0;
  const center = habCenter(race);
  for (let h = 0; h < 3; h++) {
    if (race.immune[h]) numImmune++;
    else points += Math.trunc(Math.abs(center[h] - 50) * 4);
  }
  if (numImmune > 1) points -= 150;

  let op = race.numFactories, prod = race.factoryOutput;
  if (race.prt !== 'AR' && (op > 10 || prod > 10)) {
    op = Math.max(1, op - 9); prod = Math.max(1, prod - 9);
    prod *= race.prt === 'HE' ? 3 : 2;
    points -= Math.trunc(Math.trunc(prod * op * race.growthRate) / (numImmune >= 2 ? 2 : 9));
  }
  const pe = Math.min(race.popEfficiency, 25);
  if (pe <= 7) points -= 2400; else if (pe === 8) points -= 1260; else if (pe === 9) points -= 600; else if (pe > 10) points += (pe - 10) * 120;

  if (race.prt === 'AR') points += 210;
  else {
    let p = 10 - race.factoryOutput, c = 10 - race.factoryCost, o = 10 - race.numFactories;
    let t = p > 0 ? p * 100 : p * 121;
    t += c > 0 ? c * c * -60 : c * -55;
    t += o > 0 ? o * 40 : o * 35;
    if (t > 700) t = Math.trunc((t - 700) / 3) + 700;
    if (o <= -7) {
      if (o < -11) t += o < -14 ? -360 : (o + 7) * 45;
      else t += (o + 6) * 30;
    }
    if (p <= -3) t += (p + 2) * 60;
    points += t;
    if (race.factoriesCostLess) points -= 175;
    p = 10 - race.mineOutput; c = 3 - race.mineCost; o = 10 - race.numMines;
    t = p > 0 ? p * 100 : p * 169;
    t += c > 0 ? -360 : c * -65 + 80;
    t += o > 0 ? o * 40 : o * 35;
    points += t;
  }
  points += PRT_POINT_COST[race.prt];
  let good = 0, bad = 0;
  for (const l of race.lrts) {
    const cost = LRT_INFO[l].points;
    points += cost;
    if (cost >= 0) bad++; else good++;
  }
  if (good + bad > 4) points -= (good + bad) * (good + bad - 4) * 10;
  if (bad - good > 3) points -= (bad - good - 3) * 60;
  if (good - bad > 3) points -= (good - bad - 3) * 40;
  if (race.lrts.includes('NAS')) {
    if (race.prt === 'PP') points -= 280; else if (race.prt === 'SS') points -= 200; else if (race.prt === 'JoaT') points -= 40;
  }
  let techcosts = 0;
  for (const f of FIELDS) { if (race.researchCost[f] === 'less') techcosts++; else if (race.researchCost[f] === 'extra') techcosts--; }
  if (techcosts > 0) {
    points -= techcosts * techcosts * 130;
    if (techcosts >= 6) points += 1430; else if (techcosts === 5) points += 520;
  } else if (techcosts < 0) {
    points += [150, 330, 540, 780, 1050, 1380][-techcosts - 1];
    if (techcosts < -4 && race.popEfficiency < 10) points -= 190;
  }
  if (race.techsStartHigh) points -= 180;
  if (race.prt === 'AR' && race.researchCost.energy === 'less') points -= 100;
  return Math.trunc(points / 3);
}

// ---------------------------------------------------------------- race spec

export interface RaceSpec {
  habCenter: Hab;
  startingTech: TechLevels;
  newTechCostFactor: number;
  miniMax: number;
  miniPerLevel: number;
  scanRangeFactor: number;
  fuelEfficiency: number; // multiplier, IFE 0.85
  maxPopFactor: number;
  growthFactor: number;
  minHabFloor: number;
  researchFactor: number;
  researchSplash: number;
  shieldFactor: number;
  shieldRegen: number;
  armorFactor: number;
  techCostOffset: Record<string, number>;
  engineFailureRate: number;
  engineReliableSpeed: number;
  starbaseCostFactor: number;
  starbaseCloakUnits: number;
  builtInCloakUnits: number;
  freeCargoCloak: boolean;
  mineSafeWarpBonus: number;
  minefieldsAreScanners: boolean;
  minefieldMoveFactor: number;
  /** SD: planets inside its fields add 1 % decay a year instead of 4 % */
  minefieldDecayFactor: number;
  canDetonate: boolean;
  invasionAttack: number;
  invasionDefend: number;
  repairFactor: number;
  starbaseRepairFactor: number;
  livesOnStarbases: boolean;
  innate: boolean; // AR innate resources/mining/scanner
  canRemoteMineOwn: boolean;
  freighterGrowth: { rate: number; absolute: boolean } | null;
  packetMineralsSingle: number;
  packetMineralsMixed: number;
  packetResourceCost: number;
  packetMineralCostFactor: number;
  packetReceiverFactor: number;
  packetDecayFactor: number;
  packetOverSafePenalty: number;
  packetScanner: boolean;
  packetTerraform: boolean;
  canGateCargo: boolean;
  detectStargatePlanets: boolean;
  shipsVanishInVoid: boolean;
  stealsResearch: number;
  discoverDesignOnScan: boolean;
  movementBonus: number;
  instaform: boolean;
  permaformChance: number;
  noAdvancedScanners: boolean;
  startingPopFactor: number;
  alchemyCost: number;
  scrapMineralOffset: number;
  scrapMineralOffsetStarbase: number;
  scrapResourcesOffset: number;
  scrapResourcesOffsetStarbase: number;
  canBuildDefenses: boolean;
  techsCostExtraLevel: number;
  joatScanner: boolean;
}

const zeroTech = (): TechLevels => ({ energy: 0, weapons: 0, propulsion: 0, construction: 0, electronics: 0, biotechnology: 0 });

const specCache = new WeakMap<Race, { key: string; spec: RaceSpec }>();

export function raceSpec(race: Race): RaceSpec {
  const key = JSON.stringify(race);
  const c = specCache.get(race);
  if (c && c.key === key) return c.spec;
  const spec = computeRaceSpec(race);
  specCache.set(race, { key, spec });
  return spec;
}

function computeRaceSpec(race: Race): RaceSpec {
  const prt = race.prt, has = (l: LRT) => race.lrts.includes(l);
  const st = zeroTech();
  const add = (t: Partial<TechLevels>) => { for (const k in t) st[k as Field] += t[k as Field]!; };
  switch (prt) {
    case 'SS': add({ electronics: 5 }); break;
    case 'WM': add({ energy: 1, weapons: 6, propulsion: 1 }); break;
    case 'CA': add({ energy: 1, weapons: 1, propulsion: 1, construction: 2, biotechnology: 6 }); break;
    case 'SD': add({ propulsion: 2, biotechnology: 2 }); break;
    case 'PP': add({ energy: 4 }); break;
    case 'IT': add({ propulsion: 5, construction: 5 }); break;
    case 'AR': add({ energy: 1 }); break;
    case 'JoaT': add({ energy: 3, weapons: 3, propulsion: 3, construction: 3, electronics: 3, biotechnology: 3 }); break;
  }
  if (has('IFE')) st.propulsion += 1;
  if (has('CE')) st.propulsion += 1;
  const techsCostExtraLevel = prt === 'JoaT' ? 4 : 3;
  if (race.techsStartHigh) for (const f of FIELDS) if (race.researchCost[f] === 'extra') st[f] = Math.max(st[f], techsCostExtraLevel);

  const baseMaxPop = 1 + (prt === 'HE' ? -0.5 : prt === 'JoaT' ? 0.2 : 0);
  let maxPopFactor = baseMaxPop;
  if (has('OBRM')) maxPopFactor += baseMaxPop * 0.1;

  const tco: Record<string, number> = {};
  const addCost = (tag: string, v: number) => { tco[tag] = (tco[tag] ?? 0) + v; };
  if (prt === 'WM') { addCost('BeamWeapon', -0.25); addCost('Torpedo', -0.25); addCost('Bomb', -0.25); }
  if (prt === 'IS') { addCost('Defense', -0.4); addCost('BeamWeapon', 0.25); addCost('Torpedo', 0.25); addCost('Bomb', 0.25); }
  if (prt === 'IT') addCost('Stargate', -0.25);
  if (has('TT')) addCost('Terraforming', -0.3);
  if (has('CE')) addCost('Engine', -0.5);

  let starbaseCostFactor = 1;
  if (prt === 'AR') starbaseCostFactor = 0.8;
  if (has('ISB')) starbaseCostFactor = Math.min(starbaseCostFactor, 0.8);

  return {
    habCenter: habCenter(race),
    startingTech: st,
    newTechCostFactor: has('BET') ? 2 : 1,
    miniMax: has('BET') ? 0.8 : 0.75,
    miniPerLevel: has('BET') ? 0.05 : 0.04,
    scanRangeFactor: has('NAS') ? 2 : 1,
    fuelEfficiency: has('IFE') ? 0.85 : 1,
    maxPopFactor,
    growthFactor: prt === 'HE' ? 2 : 1,
    minHabFloor: prt === 'AR' ? 25 : 5,
    researchFactor: has('GR') ? 0.5 : 1,
    researchSplash: has('GR') ? 0.15 : 0,
    shieldFactor: has('RS') ? 1.4 : 1,
    shieldRegen: has('RS') ? 0.1 : 0,
    armorFactor: has('RS') ? 0.5 : 1,
    techCostOffset: tco,
    engineFailureRate: has('CE') ? 0.1 : 0,
    engineReliableSpeed: has('CE') ? 6 : 10,
    starbaseCostFactor,
    starbaseCloakUnits: has('ISB') ? 40 : 0,
    builtInCloakUnits: prt === 'SS' ? 300 : 0,
    freeCargoCloak: prt === 'SS',
    mineSafeWarpBonus: prt === 'SS' ? 1 : prt === 'SD' ? 2 : 0,
    minefieldsAreScanners: prt === 'SD',
    minefieldMoveFactor: prt === 'SD' ? 0.5 : 0,
    minefieldDecayFactor: prt === 'SD' ? 0.25 : 1,
    canDetonate: prt === 'SD',
    invasionAttack: prt === 'WM' ? 1.65 : 1.1,
    invasionDefend: prt === 'IS' ? 2 : 1,
    repairFactor: prt === 'IS' ? 2 : 1,
    starbaseRepairFactor: prt === 'IS' ? 1.5 : 1,
    livesOnStarbases: prt === 'AR',
    innate: prt === 'AR',
    canRemoteMineOwn: prt === 'AR',
    freighterGrowth: prt === 'IS' ? { rate: 0.5, absolute: false } : prt === 'AR' ? { rate: -0.03, absolute: true } : null,
    packetMineralsSingle: prt === 'PP' ? 70 : 100,
    packetMineralsMixed: prt === 'PP' ? 25 : 40,
    packetResourceCost: prt === 'PP' ? 5 : 10,
    packetMineralCostFactor: prt === 'PP' ? 1 : prt === 'IT' ? 1.2 : 1.1,
    packetReceiverFactor: prt === 'IT' ? 0.5 : 1,
    packetDecayFactor: prt === 'PP' ? 0.5 : 1,
    packetOverSafePenalty: prt === 'IT' ? 1 : 0,
    packetScanner: prt === 'PP',
    packetTerraform: prt === 'PP',
    canGateCargo: prt === 'IT',
    detectStargatePlanets: prt === 'IT',
    shipsVanishInVoid: prt !== 'IT',
    stealsResearch: prt === 'SS' ? 0.5 : 0,
    discoverDesignOnScan: prt === 'WM',
    movementBonus: prt === 'WM' ? 2 : 0,
    instaform: prt === 'CA',
    permaformChance: prt === 'CA' ? 0.1 : 0,
    noAdvancedScanners: has('NAS'),
    startingPopFactor: has('LSP') ? 0.7 : 1,
    alchemyCost: has('MA') ? 25 : 100,
    scrapMineralOffset: has('UR') ? 0.45 - 1 / 3 : 0,
    scrapMineralOffsetStarbase: has('UR') ? 0.9 - 1 / 3 : 0.8 - 1 / 3,
    scrapResourcesOffset: has('UR') ? 0.35 : 0,
    scrapResourcesOffsetStarbase: has('UR') ? 0.7 : 0,
    canBuildDefenses: prt !== 'AR',
    techsCostExtraLevel,
    joatScanner: prt === 'JoaT',
  };
}

// ---------------------------------------------------------------- display helpers

export function gravString(v: number): string {
  const tmp = Math.abs(v - 50);
  let r = tmp <= 25 ? (tmp + 25) * 4 : tmp * 24 - 400;
  if (v < 50) r = Math.floor(10000 / r);
  return (Math.trunc(r) / 100).toFixed(2) + 'g';
}
export function tempString(v: number): string { return `${(v - 50) * 4}°C`; }
export function radString(v: number): string { return `${v}mR`; }
export function habString(i: number, v: number): string { return i === 0 ? gravString(v) : i === 1 ? tempString(v) : radString(v); }
export const HAB_NAMES = ['Gravité', 'Température', 'Radiation'];

/** Rough "1 planet in N" estimate shown in the race wizard. */
export function habitableFraction(race: Race): number {
  let frac = 1;
  for (let i = 0; i < 3; i++) {
    if (race.immune[i]) continue;
    const width = race.habHigh[i] - race.habLow[i] + 1;
    frac *= Math.max(0, Math.min(1, width / 100));
  }
  return frac;
}

export function researchCostFactor(level: ResearchCostLevel): number {
  return level === 'less' ? 0.5 : level === 'extra' ? 1.75 : 1;
}
