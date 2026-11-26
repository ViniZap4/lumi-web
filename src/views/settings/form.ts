// Small helpers shared by the settings sections.

export function num(e: Event): number {
  return Number((e.currentTarget as HTMLInputElement).value);
}

export function checked(e: Event): boolean {
  return (e.currentTarget as HTMLInputElement).checked;
}

/** A row id is shown (search match, or its section is open). */
export type ShowRow = (id: string) => boolean;
