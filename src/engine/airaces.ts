// Races used by computer players (valid race-wizard designs, original names).
import type { Race, ResearchCostLevel, Field } from './types';

const rc = (e: ResearchCostLevel, w: ResearchCostLevel, p: ResearchCostLevel, c: ResearchCostLevel, el: ResearchCostLevel, b: ResearchCostLevel): Record<Field, ResearchCostLevel> =>
  ({ energy: e, weapons: w, propulsion: p, construction: c, electronics: el, biotechnology: b });

const base = (): Race => ({
  name: '', pluralName: '', prt: 'JoaT', lrts: [], habLow: [15, 15, 15], habHigh: [85, 85, 85], immune: [false, false, false],
  growthRate: 15, popEfficiency: 10, factoryOutput: 10, factoryCost: 10, numFactories: 10, factoriesCostLess: false,
  mineOutput: 10, mineCost: 5, numMines: 10, researchCost: rc('standard', 'standard', 'standard', 'standard', 'standard', 'standard'),
  techsStartHigh: false, leftover: 'surfaceMinerals', icon: 0,
});

export const AI_RACES: (() => Race)[] = [
  () => ({ ...base(), name: 'Mycélien', pluralName: 'Mycéliens', prt: 'HE', lrts: ['IFE', 'ISB', 'GR', 'NRSE', 'OBRM', 'NAS'], habLow: [0, 0, 0], habHigh: [0, 0, 0], immune: [true, true, true], growthRate: 4, factoryOutput: 15, factoryCost: 6, numFactories: 23, factoriesCostLess: true, mineOutput: 15, mineCost: 2, numMines: 21, researchCost: rc('less', 'less', 'less', 'less', 'less', 'less'), leftover: 'mineralConcentrations', icon: 6 }),
  () => ({ ...base(), name: 'Draconide', pluralName: 'Draconides', prt: 'WM', lrts: ['OBRM', 'NAS', 'CE'], habLow: [40, 40, 0], habHigh: [100, 100, 0], immune: [false, false, true], growthRate: 13, factoryOutput: 11, factoryCost: 9, numFactories: 12, factoriesCostLess: true, mineCost: 3, numMines: 12, researchCost: rc('extra', 'less', 'standard', 'less', 'extra', 'extra'), techsStartHigh: true, icon: 7 }),
  () => ({ ...base(), name: 'Géomancien', pluralName: 'Géomanciens', prt: 'CA', lrts: ['TT', 'GR', 'OBRM', 'LSP'], habLow: [28, 28, 28], habHigh: [72, 72, 72], growthRate: 19, popEfficiency: 9, numFactories: 13, factoriesCostLess: true, numMines: 11, researchCost: rc('extra', 'standard', 'standard', 'standard', 'extra', 'less'), leftover: 'factories', icon: 8 }),
  () => ({ ...base(), name: 'Carapacien', pluralName: 'Carapaciens', prt: 'IS', lrts: ['IFE', 'GR', 'NRSE', 'NAS'], habLow: [0, 0, 0], habHigh: [52, 0, 52], immune: [false, true, false], growthRate: 13, numFactories: 12, numMines: 12, researchCost: rc('standard', 'less', 'standard', 'less', 'standard', 'standard'), leftover: 'factories', icon: 9 }),
  () => ({ ...base(), name: 'Minotaure', pluralName: 'Minotaures', prt: 'SD', leftover: 'defenses', icon: 10 }),
  () => ({ ...base(), name: 'Balisticien', pluralName: 'Balisticiens', prt: 'PP', lrts: ['ARM', 'ISB', 'GR'], habLow: [0, 0, 46], habHigh: [0, 52, 100], immune: [true, false, false], growthRate: 14, popEfficiency: 11, factoryOutput: 9, numMines: 11, mineCost: 4, researchCost: rc('less', 'extra', 'extra', 'less', 'extra', 'extra'), leftover: 'mines', icon: 11 }),
  () => ({ ...base(), name: 'Spectre', pluralName: 'Spectres', prt: 'AR', lrts: ['IFE', 'ARM', 'ISB', 'NRSE'], habLow: [0, 62, 64], habHigh: [0, 98, 100], immune: [true, false, false], growthRate: 18, factoryOutput: 0, factoryCost: 0, numFactories: 0, mineOutput: 0, mineCost: 0, numMines: 0, researchCost: rc('less', 'standard', 'extra', 'standard', 'extra', 'extra'), leftover: 'mineralConcentrations', icon: 12 }),
  () => ({ ...base(), name: 'Galvanien', pluralName: 'Galvaniens', prt: 'JoaT', icon: 13 }),
  () => ({ ...base(), name: 'Nomade', pluralName: 'Nomades', prt: 'IT', lrts: ['IFE', 'TT', 'CE', 'NAS'], habLow: [10, 35, 13], habHigh: [56, 81, 53], growthRate: 20, factoryCost: 9, numFactories: 17, factoriesCostLess: true, mineCost: 9, researchCost: rc('extra', 'extra', 'less', 'standard', 'standard', 'less'), leftover: 'defenses', icon: 14 }),
  () => ({ ...base(), name: 'Ombre', pluralName: 'Ombres', prt: 'SS', lrts: ['ARM', 'ISB'], habLow: [0, 12, 0], habHigh: [100, 88, 100], immune: [true, false, false], growthRate: 10, popEfficiency: 9, mineCost: 15, numMines: 5, researchCost: rc('extra', 'extra', 'extra', 'extra', 'extra', 'extra'), techsStartHigh: true, leftover: 'factories', icon: 15 }),
];
