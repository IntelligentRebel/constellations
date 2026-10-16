// Constellations parts that do not exist in Stars! (added to the generated tables at start-up).
import { TECH_DATA } from './techs';
import type { TechData } from './types';

export const EXTRA_TECHS: TechData[] = [
  {
    // Constellations 3 (rule "deception"): projects phantom ships that ordinary scanners count as real
    name: 'Holographic Decoy', cat: 'Electrical', tags: ['Decoy'], origin: 'deception',
    req: { en: 0, we: 0, pr: 0, co: 0, el: 4, bi: 0 }, cost: [2, 0, 4, 9], rank: 5, mass: 2, slot: 'Electrical',
    stats: { decoyMass: 120 },
  },
  {
    // Constellations 3.3 (rule "culture"): set up in orbit of a free world, it becomes an armed fort that claims it
    name: 'Sovereignty Beacon', cat: 'Mechanical', tags: ['BeaconKit'], origin: 'culture',
    req: { en: 0, we: 0, pr: 0, co: 4, el: 2, bi: 0 }, cost: [40, 20, 40, 150], rank: 90, mass: 40, slot: 'Mechanical',
    stats: { beaconKit: true },
  },
];

for (const t of EXTRA_TECHS) if (!TECH_DATA.some(x => x.name === t.name)) TECH_DATA.push(t);
