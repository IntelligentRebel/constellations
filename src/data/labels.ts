// Display names. The data tables keep the original identifiers (they are the keys used by the
// rules and by saved games); everything shown to the player goes through these maps, so
// Constellations has its own vocabulary instead of copying Stars! word for word.

export const HULL_LABELS: Record<string, string> = {
  'Small Freighter': 'Cargo léger', 'Medium Freighter': 'Cargo moyen', 'Large Freighter': 'Cargo lourd', 'Super Freighter': 'Vraquier',
  'Scout': 'Vedette', 'Frigate': 'Frégate', 'Destroyer': 'Contre-torpilleur', 'Cruiser': 'Croiseur', 'Battle Cruiser': 'Croiseur lourd',
  'Battleship': 'Cuirassé', 'Dreadnought': 'Léviathan', 'Privateer': 'Corsaire', 'Rogue': 'Maraudeur', 'Galleon': 'Galion',
  'Mini-Colony Ship': 'Arche légère', 'Colony Ship': 'Arche', 'Mini Bomber': 'Bombardier léger', 'B-17 Bomber': 'Bombardier',
  'Stealth Bomber': 'Bombardier furtif', 'B-52 Bomber': 'Bombardier lourd', 'Midget Miner': 'Foreuse naine', 'Mini-Miner': 'Mini-foreuse',
  'Miner': 'Foreuse', 'Maxi-Miner': 'Grande foreuse', 'Ultra-Miner': 'Méga-foreuse', 'Fuel Transport': 'Ravitailleur',
  'Super-Fuel Xport': 'Grand ravitailleur', 'Mini Mine Layer': 'Mouilleur léger', 'Super Mine Layer': 'Grand mouilleur',
  'Nubian': 'Chimère', 'Meta Morph': 'Métamorphe', 'Mini Morph': 'Mini-métamorphe',
  'Orbital Fort': 'Fortin orbital', 'Space Dock': 'Cale orbitale', 'Space Station': 'Station orbitale', 'Ultra Station': 'Citadelle orbitale', 'Death Star': 'Forteresse-monde',
};

export const COMPONENT_LABELS: Record<string, string> = {
  // engines
  "Settler's Delight": 'Propulseur du colon', 'Quick Jump 5': 'Saut rapide 5', 'Fuel Mizer': 'Économiseur', 'Long Hump 6': 'Long-courrier 6',
  'Daddy Long Legs 7': 'Grand Faucheux 7', 'Alpha Drive 8': 'Propulseur Alpha 8', 'Trans-Galactic Drive': 'Propulseur transgalactique',
  'Interspace-10': 'Interstice 10', 'Enigma Pulsar': 'Pulsar Énigme', 'Trans-Star 10': 'Transstellaire 10',
  'Radiating Hydro-Ram Scoop': 'Statoréacteur rayonnant', 'Sub-Galactic Fuel Scoop': 'Statoréacteur subgalactique',
  'Trans-Galactic Fuel Scoop': 'Statoréacteur transgalactique', 'Trans-Galactic Super Scoop': 'Superstatoréacteur',
  'Trans-Galactic Mizer Scoop': 'Statoréacteur économe', 'Galaxy Scoop': 'Statoréacteur galactique',
  // orbital
  'Stargate 100-250': 'Portail 100/250', 'Stargate any-300': 'Portail ∞/300', 'Stargate 150-600': 'Portail 150/600', 'Stargate 300-500': 'Portail 300/500',
  'Stargate 100-any': 'Portail 100/∞', 'Stargate any-800': 'Portail ∞/800', 'Stargate any-any': 'Portail ∞/∞',
  'Mass Driver 5': 'Catapulte 5', 'Mass Driver 6': 'Catapulte 6', 'Mass Driver 7': 'Catapulte 7', 'Super Driver 8': 'Supercatapulte 8',
  'Super Driver 9': 'Supercatapulte 9', 'Ultra Driver 10': 'Hypercatapulte 10', 'Ultra Driver 11': 'Hypercatapulte 11',
  'Ultra Driver 12': 'Hypercatapulte 12', 'Ultra Driver 13': 'Hypercatapulte 13',
  // mining robots
  'Robo-Miner': 'Robot foreur', 'Robo-Maxi-Miner': 'Robot foreur maxi', 'Robo-Midget-Miner': 'Robot foreur nain', 'Robo-Mini-Miner': 'Mini-robot foreur',
  'Robo-Super-Miner': 'Super-robot foreur', 'Robo-Ultra-Miner': 'Ultra-robot foreur', 'Alien Miner': 'Foreuse xénologique', 'Orbital Adjuster': 'Régulateur orbital',
  // bombs
  'Lady Finger Bomb': 'Pétard', 'Black Cat Bomb': 'Marron', 'M-70 Bomb': 'Grenade 70', 'M-80 Bomb': 'Grenade 80', 'Cherry Bomb': 'Bombe Cerise',
  'LBU-17 Bomb': 'Sape 17', 'LBU-32 Bomb': 'Sape 32', 'LBU-74 Bomb': 'Sape 74', 'Hush-a-Boom': 'Chuchoteuse', 'Retro Bomb': 'Bombe régressive',
  'Smart Bomb': 'Bombe ciblée', 'Neutron Bomb': 'Bombe à neutrons', 'Enriched Neutron Bomb': 'Neutrons enrichis', 'Peerless Bomb': 'Bombe parfaite',
  'Annihilator Bomb': 'Annihilatrice',
  // ship scanners
  'Bat Scanner': 'Veilleur', 'Rhino Scanner': 'Guetteur', 'Mole Scanner': 'Sondeur', 'DNA Scanner': 'Analyseur génétique', 'Possum Scanner': 'Vigile',
  'Pick Pocket Scanner': 'Chapardeur', 'Chameleon Scanner': 'Mimétique', 'Ferret Scanner': 'Fouineur', 'Dolphin Scanner': 'Sonar',
  'Gazelle Scanner': 'Coursier', 'RNA Scanner': 'Analyseur ARN', 'Cheetah Scanner': 'Éclair', 'Elephant Scanner': 'Colosse',
  'Eagle Eye Scanner': 'Œil de lynx', 'Robber Baron Scanner': 'Grand pillard', 'Peerless Scanner': 'Omniscient',
  // armor
  'Tritanium': 'Plaque de titane', 'Crobmnium': 'Alliage C', 'Carbonic Armor': 'Blindage carbone', 'Strobnium': 'Alliage S', 'Organic Armor': 'Blindage organique',
  'Kelarium': 'Kélaride', 'Fielded Kelarium': 'Kélaride à champ', 'Depleted Neutronium': 'Neutronium appauvri', 'Neutronium': 'Neutronium',
  'Mega Poly Shell': 'Coque polymère', 'Valanium': 'Valane', 'Superlatanium': 'Superlatane',
  // electrical
  'Holographic Decoy': 'Leurre holographique', 'Sovereignty Beacon': 'Balise de souveraineté', 'Transport Cloaking': 'Voile de cargo', 'Stealth Cloak': 'Voile furtif', 'Super-Stealth Cloak': 'Voile furtif supérieur', 'Ultra-Stealth Cloak': 'Voile d\'invisibilité',
  'Multi-Function Pod': 'Nacelle polyvalente', 'Battle Computer': 'Calculateur de tir', 'Battle Super Computer': 'Supercalculateur de tir', 'Battle Nexus': 'Nexus tactique',
  'Jammer 10': 'Brouilleur 10', 'Jammer 20': 'Brouilleur 20', 'Jammer 30': 'Brouilleur 30', 'Jammer 50': 'Brouilleur 50',
  'Energy Capacitor': 'Condensateur', 'Flux Capacitor': 'Amplificateur de flux', 'Energy Dampener': 'Amortisseur d\'énergie',
  'Tachyon Detector': 'Détecteur de tachyons', 'Anti-Matter Generator': 'Générateur d\'antimatière',
  // mine layers
  'Mine Dispenser 40': 'Lance-mines 40', 'Mine Dispenser 50': 'Lance-mines 50', 'Mine Dispenser 80': 'Lance-mines 80', 'Mine Dispenser 130': 'Lance-mines 130',
  'Heavy Dispenser 50': 'Lance-mines lourd 50', 'Heavy Dispenser 110': 'Lance-mines lourd 110', 'Heavy Dispenser 200': 'Lance-mines lourd 200',
  'Speed Trap 20': 'Herse 20', 'Speed Trap 30': 'Herse 30', 'Speed Trap 50': 'Herse 50',
  // mechanical
  'Colonization Module': 'Module de colonisation', 'Orbital Construction Module': 'Module de construction orbitale', 'Cargo Pod': 'Soute',
  'Super Cargo Pod': 'Grande soute', 'Multi Cargo Pod': 'Soute modulaire', 'Fuel Tank': 'Réservoir', 'Super Fuel Tank': 'Grand réservoir',
  'Maneuvering Jet': 'Tuyère de manœuvre', 'Overthruster': 'Surpropulseur', 'Jump Gate': 'Portail de saut', 'Beam Deflector': 'Déflecteur',
  // beam weapons
  'Laser': 'Laser', 'X-Ray Laser': 'Laser X', 'Mini Gun': 'Mitrailleuse', 'Yakimora Light Phaser': 'Phaseur léger', 'Blackjack': 'Matraque',
  'Phaser Bazooka': 'Bazooka à phase', 'Pulsed Sapper': 'Saboteur pulsé', 'Colloidal Phaser': 'Phaseur colloïdal', 'Gatling Gun': 'Canon rotatif',
  'Mini Blaster': 'Mini-désintégrateur', 'Bludgeon': 'Gourdin', 'Mark IV Blaster': 'Désintégrateur IV', 'Phased Sapper': 'Saboteur phasé',
  'Heavy Blaster': 'Désintégrateur lourd', 'Gatling Neutrino Cannon': 'Canon rotatif à neutrinos', 'Myopic Disruptor': 'Disrupteur myope',
  'Blunderbuss': 'Tromblon', 'Disruptor': 'Disrupteur', 'Multi Contained Munition': 'Munition multiple', 'Syncro Sapper': 'Saboteur synchrone',
  'Mega Disruptor': 'Mégadisrupteur', 'Big Mutha Cannon': 'Gros Calibre', 'Streaming Pulverizer': 'Pulvérisateur continu', 'Anti-Matter Pulverizer': 'Pulvérisateur d\'antimatière',
  // torpedoes
  'Alpha Torpedo': 'Torpille Alpha', 'Beta Torpedo': 'Torpille Bêta', 'Delta Torpedo': 'Torpille Delta', 'Epsilon Torpedo': 'Torpille Epsilon',
  'Rho Torpedo': 'Torpille Rhô', 'Upsilon Torpedo': 'Torpille Upsilon', 'Omega Torpedo': 'Torpille Oméga', 'Anti Matter Torpedo': 'Torpille d\'antimatière',
  'Jihad Missile': 'Missile Fureur', 'Juggernaut Missile': 'Missile Titan', 'Doomsday Missile': 'Missile Apocalypse', 'Armageddon Missile': 'Missile Cataclysme',
  // shields
  'Mole-skin Shield': 'Écran I', 'Cow-hide Shield': 'Écran II', 'Wolverine Diffuse Shield': 'Écran diffus', 'Croby Sharmor': 'Blindécran',
  'Shadow Shield': 'Écran d\'ombre', 'Bear Neutrino Barrier': 'Barrière à neutrinos', 'Langston Shell': 'Coquille de force', 'Gorilla Delagator': 'Égide',
  'Elephant Hide Fortress': 'Bastion', 'Complete Phase Shield': 'Bouclier de phase intégral',
  // planetary scanners
  'Viewer 50': 'Observatoire 50', 'Viewer 90': 'Observatoire 90', 'Scoper 150': 'Radar 150', 'Scoper 220': 'Radar 220', 'Scoper 280': 'Radar 280',
  'Snooper 320X': 'Scrutateur 320', 'Snooper 400X': 'Scrutateur 400', 'Snooper 500X': 'Scrutateur 500', 'Snooper 620X': 'Scrutateur 620',
  // planetary defenses
  'SDI': 'Défense orbitale', 'Missile Battery': 'Batterie de missiles', 'Laser Battery': 'Batterie laser', 'Planetary Shield': 'Bouclier planétaire', 'Neutron Shield': 'Bouclier à neutrons',
  // terraforming
  'Total Terraform ±3': 'Terraformation ±3', 'Total Terraform ±5': 'Terraformation ±5', 'Total Terraform ±7': 'Terraformation ±7', 'Total Terraform ±10': 'Terraformation ±10',
  'Total Terraform ±15': 'Terraformation ±15', 'Total Terraform ±20': 'Terraformation ±20', 'Total Terraform ±25': 'Terraformation ±25', 'Total Terraform ±30': 'Terraformation ±30',
  'Gravity Terraform ±3': 'Gravité ±3', 'Gravity Terraform ±7': 'Gravité ±7', 'Gravity Terraform ±11': 'Gravité ±11', 'Gravity Terraform ±15': 'Gravité ±15',
  'Temp Terraform ±3': 'Température ±3', 'Temp Terraform ±7': 'Température ±7', 'Temp Terraform ±11': 'Température ±11', 'Temp Terraform ±15': 'Température ±15',
  'Radiation Terraform ±3': 'Radiation ±3', 'Radiation Terraform ±7': 'Radiation ±7', 'Radiation Terraform ±11': 'Radiation ±11', 'Radiation Terraform ±15': 'Radiation ±15',
  'Genesis Device': 'Créateur de mondes',
};

/** Starting designs (keys = rule identifiers used when building the starting fleets). */
export const START_DESIGN_LABELS: Record<string, string> = {
  'Long Range Scout': 'Éclaireur Horizon', 'Santa Maria': 'Arche pionnière', 'Spore Cloud': 'Nuée de spores', 'Armed Probe': 'Sonde armée',
  'Gadfly': 'Taon', 'Change of Heart': 'Métamorphose', 'Little Hen': 'Pondeuse', 'Speed Turtle': 'Tortue', 'Swashbuckler': 'Flibustier',
  'Stalwart Defender': 'Sentinelle', 'Teamster': 'Transport Atlas', 'Cotton Picker': 'Glaneuse', 'Potato Bug': 'Doryphore', 'Starbase': 'Station mère',
  'Shadow Transport': 'Transport fantôme', 'Shadow Sleuth': 'Limier fantôme',
};

/** Display name of a hull or a component (identity for names that are not in the tables). */
export function tl(name: string | undefined): string {
  if (!name) return '';
  return COMPONENT_LABELS[name] ?? HULL_LABELS[name] ?? name;
}

export const TRADER_NAME = 'Marchand nomade';
