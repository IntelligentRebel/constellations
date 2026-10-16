// Small French phrasing helpers for reports (no imports: usable anywhere in the engine).

/** 3.6: a colonist of the rules stands for a thousand people when the game shows populations in millions (display only). */
export const popScale = (game: { settings: { popUnits?: string } }) => game.settings.popUnits === 'millions' ? 1000 : 1;
/** A number of colonists (the rules' unit) as people, with the thousands separator of the language. */
export const people = (game: { settings: { popUnits?: string } }, n: number) => Math.round(n * popScale(game)).toLocaleString('fr-FR');

/** "2,4 fois", "35 fois", "plus de cent fois" */
export function timesWord(r: number): string {
  if (!Number.isFinite(r) || r >= 100) return 'plus de cent fois';
  if (r >= 10) return `${Math.round(r)} fois`;
  return `${r.toFixed(1).replace('.', ',')} fois`;
}

/** A strength relative to another one: "2,4 fois sa force", "35 % de sa force", "moins de 1 % de sa force". */
export function shareOf(r: number): string {
  if (r >= 1) return `${timesWord(r)} sa force`;
  if (r >= 0.01) return `${Math.round(r * 100)} % de sa force`;
  return 'moins de 1 % de sa force';
}


/** The first letter in capital (a name that starts a sentence: « le Linceul » → « Le Linceul »). */
export const upperFirst = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
