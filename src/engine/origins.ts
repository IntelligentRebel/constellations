// Origins (Constellations 3.2): where an empire comes from changes how it starts, and sometimes how it must play.
// Chosen in the new game dialog (computer players draw one). Each has a real price.
import type { GameState, Hab, Planet, Player } from './types';
import { Rng, seedFromString } from './rng';
import { raceSpec, habitability } from './race';
import { distance, emptyCargo, fleetSpec } from './fleet';
import { revealPlanet } from './scan';
import { giveRelic } from './relics';
import { addHomeSite } from './anomalies';
import { designAtTech } from './guardians';
import { randomConcentrations } from './universe';

export interface OriginInfo { id: string; name: string; text: string; pros: string[]; cons: string[]; needs?: 'anomalies' | 'diaspora' | 'secret'; /** 0.3.9: unlocked by an achievement (the computers never draw it) */ locked?: boolean }

export const ORIGINS: OriginInfo[] = [
  { id: 'standard', name: 'Standard', text: 'Un départ classique, sans avantage ni contrainte.', pros: [], cons: [] },
  {
    id: 'doomed', name: 'Monde condamné',
    text: 'Votre étoile se dérègle. À partir de 2430, le climat de votre monde natal s\'éloigne chaque année de votre idéal, jusqu\'à le rendre hostile vers 2460. Il faudra déménager.',
    pros: ['deux arches de colonisation en plus au départ', '+25 % de croissance démographique jusqu\'en 2450'],
    cons: ['le monde natal devient hostile : sa population finit par décliner'],
  },
  {
    id: 'relicWorld', name: 'Monde-relique',
    text: 'Vous vivez sur les ruines d\'une civilisation plus ancienne. Le sol a été pillé, mais le savoir est resté.',
    pros: ['relique Codex des Bâtisseurs (+10 % de recherche)', 'un site archéologique sous votre capitale (recherche et minerais)'],
    cons: ['concentrations minérales du monde natal réduites de moitié', '60 % de minerais en moins en surface au départ'],
  },
  {
    id: 'lostColony', name: 'Colonie perdue',
    text: 'Une expédition partie il y a des siècles a fondé une colonie à 150-300 al, dont vous venez de retrouver la trace.',
    pros: ['une seconde colonie déjà peuplée (environ un quart d\'un monde natal), avec quelques usines et mines'],
    cons: ['30 % de colons en moins sur le monde natal', 'la colonie est loin de la capitale (rendement réduit si le coût de la taille est actif)'],
  },
  {
    id: 'explorers', name: 'Lignée d\'explorateurs', needs: 'anomalies',
    text: 'Des générations d\'éclaireurs : vous savez lire les ruines et les signaux étranges mieux que personne.',
    pros: ['étude des anomalies deux fois plus rapide', 'un éclaireur de plus', 'les systèmes à moins de 120 al de votre monde natal analysés dès le départ', 'un fragment de la carte des Anciens'],
    cons: ['20 % de colons en moins sur le monde natal'],
  },
  {
    id: 'proteges', name: 'Protégés des Anciens',
    text: 'Une intelligence ancienne veille sur votre peuple depuis ses débuts. Elle donne, mais elle ne vous laisse pas grandir seuls.',
    pros: ['deux navires d\'escorte très supérieurs à votre technologie', 'tous les 20 ans, 300 kt de chaque minerai livrés à votre capitale'],
    cons: ['−10 % de recherche pendant toute la partie'],
  },
  {
    id: 'exiles', name: 'Les Exilés', needs: 'diaspora', locked: true,
    text: 'Votre monde natal est mort avant même que l\'histoire commence. Ce qui reste de votre peuple vole à bord de cinq arches, à la recherche d\'une terre où renaître.',
    pros: ['cinq arches pleines', '+25 % de croissance démographique jusqu\'en 2450', 'la refondation apporte 20 usines et 20 mines à la nouvelle capitale'],
    cons: ['aucun monde au départ : seulement des arches', 'le monde natal, stérile, est perdu'],
  },
  {
    id: 'heirs', name: 'Les Héritiers du seuil', needs: 'secret', locked: true,
    text: 'Vos ancêtres gardaient une porte dont ils avaient oublié le sens. Vos archives en savent plus que celles de quiconque sur la Brèche… et ce qui vit derrière s\'en souvient aussi.',
    pros: ['trois indices sur six du secret des Anciens', '+2 niveaux en Électronique'],
    cons: ['les vagues des Moissonneurs vous visent en premier', '20 % de colons en moins sur le monde natal'],
  },
];
export const ORIGIN = Object.fromEntries(ORIGINS.map(o => [o.id, o])) as Record<string, OriginInfo>;
export const originsOn = (game: GameState) => !!game.settings.origins;

/** Origins a race can take (a race immune on every axis cannot be doomed). */
export function originsFor(game: GameState | { settings: GameState['settings'] }, race: Player['race']): OriginInfo[] {
  const s = game.settings;
  const need = (o: OriginInfo) => !o.needs || (o.needs === 'anomalies' ? !!s.anomalies : o.needs === 'diaspora' ? !!s.diaspora : !!s.ancientSecret && !!s.crisis && !!s.megaprojects);
  return ORIGINS.filter(o => need(o) && !(o.id === 'doomed' && race.immune.every(Boolean)));
}

/** Computer players draw an origin (their own random stream). */
export function aiOrigin(game: GameState, p: Player): string {
  const rng = new Rng(seedFromString(`${game.settings.seed}|origin|${p.id}`));
  const list = originsFor(game, p.race).filter(o => !o.locked);
  if (rng.chance(0.4)) return 'standard';
  const others = list.filter(o => o.id !== 'standard');
  return others.length ? rng.pick(others).id : 'standard';
}

const homeOf = (game: GameState, p: Player) => game.planets.find(pl => pl.owner === p.id && pl.homeworld);

function addFleetOf(game: GameState, p: Player, purpose: 'colonizer' | 'scout', at: Planet) {
  const d = game.designs.filter(x => x.owner === p.id && !x.deleted && !x.alien && !x.starbase && x.purpose === purpose).sort((a, b) => a.id - b.id)[0];
  if (!d) return;
  p.fleetNum++;
  game.fleets.push({
    id: game.nextId++, owner: p.id, num: p.fleetNum, name: `${d.name} #${p.fleetNum}`, x: at.x, y: at.y, orbiting: at.id,
    tokens: [{ designId: d.id, qty: 1, damage: 0, qtyDamaged: 0 }], cargo: emptyCargo(), fuel: 0,
    waypoints: [{ x: at.x, y: at.y, target: 'planet', targetId: at.id, warp: 0, task: 'none' }], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0,
  });
  d.built++;
}

/** Applies the origins at the creation of the game (after homeworlds, starting fleets, anomalies and guardians). */
export function applyOrigins(game: GameState) {
  for (const p of game.players) {
    if (p.monster) continue;
    if (!originsOn(game)) { p.origin = undefined; continue; }
    if (!p.origin || !originsFor(game, p.race).some(o => o.id === p.origin)) p.origin = p.ai ? aiOrigin(game, p) : 'standard';
    const home = homeOf(game, p);
    if (!home) continue;
    const rng = new Rng(seedFromString(`${game.settings.seed}|origin-apply|${p.id}`));
    switch (p.origin) {
      case 'doomed': {
        addFleetOf(game, p, 'colonizer', home); addFleetOf(game, p, 'colonizer', home);
        const c = raceSpec(p.race).habCenter;
        p.doomDir = [0, 1, 2].map(i => p.race.immune[i] ? 0 : c[i] >= 50 ? -1 : 1) as [number, number, number];
        break;
      }
      case 'relicWorld': {
        giveRelic(p, 'codex');
        for (const k of ['ironium', 'boranium', 'germanium'] as const) { home.conc[k] = Math.max(15, Math.round(home.conc[k] * 0.5)); home.surface[k] = Math.round(home.surface[k] * 0.4); }
        if (game.settings.anomalies) addHomeSite(game, home, p);
        break;
      }
      case 'lostColony': {
        home.pop = Math.round(home.pop * 0.7 / 100) * 100;
        const cands = game.planets.filter(pl => pl.owner < 0 && distance(pl, home) >= 150 && distance(pl, home) <= 300 && !game.guardians?.some(g => g.planetId === pl.id) && !game.anomalies?.some(a => a.planetId === pl.id && a.kind === 'vault'));
        const best = cands.map(pl => ({ pl, v: habitability(p.race, pl.hab) + rng.random() * 20 })).sort((a, b) => b.v - a.v)[0]?.pl;
        if (best) {
          const c = raceSpec(p.race).habCenter;
          if (habitability(p.race, best.hab) < 40) best.hab = best.hab.map((v, i) => p.race.immune[i] ? v : Math.round((v + c[i] * 3) / 4)) as Hab;
          best.baseHab = [...best.hab] as Hab; best.terraformed = [0, 0, 0];
          best.owner = p.id; best.pop = 6000; best.factories = 3; best.mines = 3; best.defenses = 0;
          p.originWorld = best.id;
          best.scanner = !raceSpec(p.race).livesOnStarbases; best.colonizedYear = game.year;
          best.conc = randomConcentrations(rng, best.hab[2], game.settings.accelerated);
          best.queue = [{ kind: 'autoFactories', qty: 50, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }, { kind: 'autoMines', qty: 50, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }];
          best.surface = { ironium: 200 + rng.int(300), boranium: 200 + rng.int(300), germanium: 200 + rng.int(300) };
          if (raceSpec(p.race).livesOnStarbases) {
            const fort = game.designs.find(d => d.owner === p.id && d.starbase && d.name === 'Colonie de départ');
            if (fort) best.starbase = { designId: fort.id, damage: 0 };
          }
        }
        break;
      }
      case 'explorers': {
        home.pop = Math.round(home.pop * 0.8 / 100) * 100;
        addFleetOf(game, p, 'scout', home);
        p.fragments = (p.fragments ?? 0) + 1;
        break;
      }
      case 'exiles': {
        // the people leave the dead homeworld aboard five arks, as full as they can be
        for (let k = 0; k < 5; k++) addFleetOf(game, p, 'colonizer', home);
        const arks = game.fleets.filter(f => f.owner === p.id && f.orbiting === home.id && game.designs.find(d => d.id === f.tokens[0].designId)?.purpose === 'colonizer');
        for (const f of arks) f.cargo.colonists = Math.max(10, fleetSpec(game, f).cargoCapacity);
        home.owner = -1; home.pop = 0; home.factories = 0; home.mines = 0; home.defenses = 0; home.queue = []; home.starbase = null; home.scanner = false; home.homeworld = false;
        home.hab = [home.hab[0], 95, 100] as Hab; home.baseHab = [...home.hab] as Hab;
        p.capital = undefined;
        p.exile = { since: game.year };
        break;
      }
      case 'heirs': {
        home.pop = Math.round(home.pop * 0.8 / 100) * 100;
        p.clues = 3; p.clueLog = ['2400 : les archives de vos ancêtres'];
        p.tech.electronics += 2;
        break;
      }
      case 'proteges': {
        const tech = Math.min(26, Math.max(...Object.values(p.tech)) + 7);
        const d = designAtTech(p, tech, 'Destroyer', 'beamWarship', 'Escorte des Anciens');
        if (d) {
          d.alien = true; d.id = game.nextId++; game.designs.push(d);
          p.fleetNum++;
          game.fleets.push({
            id: game.nextId++, owner: p.id, num: p.fleetNum, name: `Escorte des Anciens #${p.fleetNum}`, x: home.x, y: home.y, orbiting: home.id,
            tokens: [{ designId: d.id, qty: 2, damage: 0, qtyDamaged: 0 }], cargo: emptyCargo(), fuel: 0,
            waypoints: [{ x: home.x, y: home.y, target: 'planet', targetId: home.id, warp: 0, task: 'none' }], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0,
          });
        }
        break;
      }
    }
  }
  // fill the tanks of the fleets added above
  for (const f of game.fleets) if (f.fuel === 0 && game.players[f.owner] && !game.players[f.owner].monster) f.fuel = fleetSpec(game, f).fuelCapacity;
}

/** After the initial intel: what the origins reveal, and the welcome messages. */
export function originIntel(game: GameState) {
  if (!originsOn(game)) return;
  for (const p of game.players) {
    if (p.monster || !p.origin) continue;
    const home = homeOf(game, p);
    if (p.origin === 'explorers' && home) for (const pl of game.planets) if (pl.owner !== p.id && distance(pl, home) <= 120) revealPlanet(game, p, pl, false);
    const o = ORIGIN[p.origin];
    if (o && p.origin !== 'standard') p.messages.push({ year: game.year, kind: 'info', text: `Origine : ${o.name}. ${o.text}`, target: home ? { kind: 'planet', id: home.id } : undefined });
  }
}

/** Yearly effects of the origins (the doomed world drifts, the Ancients send their gifts). */
export function originYear(game: GameState) {
  if (!originsOn(game)) return;
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    if (p.origin === 'doomed' && p.doomDir) doom(game, p);
    if (p.origin === 'proteges' && game.year > 2400 && (game.year - 2400) % 20 === 0) {
      const cap = (p.capital !== undefined && game.planets[p.capital]?.owner === p.id ? game.planets[p.capital] : undefined) ?? game.planets.filter(x => x.owner === p.id).sort((a, b) => b.pop - a.pop)[0];
      if (cap) {
        for (const k of ['ironium', 'boranium', 'germanium'] as const) cap.surface[k] += 300;
        p.messages.push({ year: game.year, kind: 'event', text: `Les Anciens ont déposé 300 kt de chaque minerai sur ${cap.name}.`, target: { kind: 'planet', id: cap.id } });
      }
    }
  }
}

export const DOOM_START = 2430;
export const DOOM_FLOOR = -30;

function doom(game: GameState, p: Player) {
  const home = game.planets.find(pl => pl.homeworld && (pl.owner === p.id || pl.id === p.capital)) ?? (p.capital !== undefined ? game.planets[p.capital] : undefined);
  if (!home) return;
  if (game.year === DOOM_START - 10 && home.owner === p.id && !p.ai) p.messages.push({ year: game.year, kind: 'warning', text: `Vos astronomes sont formels : dans dix ans, le climat de ${home.name} commencera à se dégrader, et rien ne l'arrêtera. Préparez de nouveaux foyers.`, target: { kind: 'planet', id: home.id } });
  if (game.year < DOOM_START) return;
  const before = habitability(p.race, home.hab);
  if (before <= DOOM_FLOOR) return;
  for (let i = 0; i < 3; i++) {
    const d = p.doomDir![i];
    if (!d) continue;
    home.baseHab[i] = Math.max(0, Math.min(100, home.baseHab[i] + d));
    home.hab[i] = Math.max(0, Math.min(100, home.hab[i] + d));
  }
  const after = habitability(p.race, home.hab);
  if (home.owner !== p.id) return;
  for (const t of [75, 50, 25, 0]) if (before > t && after <= t) p.messages.push({ year: game.year, kind: 'warning', text: t > 0 ? `Le climat de ${home.name} se dégrade : habitabilité ${after} %.` : `${home.name} est devenue hostile à votre peuple : sa population va décliner chaque année.`, target: { kind: 'planet', id: home.id } });
  if (game.year === DOOM_START && !p.ai) p.messages.push({ year: game.year, kind: 'warning', text: `Le dérèglement de votre étoile a commencé : ${home.name} perdra chaque année un peu de son habitabilité (${before} % aujourd'hui).`, target: { kind: 'planet', id: home.id } });
}

