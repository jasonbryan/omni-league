export const compareNames = (x: string, y: string) => {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
};
