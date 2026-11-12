export function greeting(name: string | undefined): string {
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? `Hi, ${firstName}` : 'Hi';
}
