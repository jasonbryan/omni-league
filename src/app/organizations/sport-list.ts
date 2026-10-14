function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function sentenceCase(names: readonly string[]): string[] {
  return names.map((name, index) => (index === 0 ? name : lowerFirst(name)));
}

export function sportsCommaList(names: readonly string[]): string {
  return sentenceCase(names).join(', ');
}

export function sportsInSentence(names: readonly string[]): string {
  const words = sentenceCase(names);
  if (words.length < 3) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
}
