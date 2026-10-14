function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function sentenceCase(names: readonly string[]): string[] {
  return names.map((name, index) => (index === 0 ? name : lowerFirst(name)));
}

/** "Soccer, softball": sport names in a row, only the first capitalised. */
export function sportList(names: readonly string[]): string {
  return sentenceCase(names).join(', ');
}

/** "Beach volleyball, soccer, and softball": the same names as a phrase. */
export function sportPhrase(names: readonly string[]): string {
  const words = sentenceCase(names);
  if (words.length < 3) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
}
