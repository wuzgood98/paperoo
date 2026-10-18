/**
 * Pages as the file name shows them: 1-based positions, runs collapsed,
 * e.g. [1, 2, 3, 5] → "1-3,5".
 */
export const pageRangeLabel = (positions: readonly number[]): string => {
  const sorted = [...new Set(positions)].toSorted((a, b) => a - b);
  const parts: string[] = [];
  let [start] = sorted;
  let end = start;
  for (const position of [...sorted.slice(1), Number.NaN]) {
    if (start === undefined || end === undefined) {
      break;
    }
    if (position === end + 1) {
      end = position;
      continue;
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    start = position;
    end = position;
  }
  return parts.join(",");
};
