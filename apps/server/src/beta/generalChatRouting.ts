const words = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A unique full name narrows the search; mentioning two destinations remains ambiguous. */
export function namedDestination<T extends { readonly id: string; readonly title: string }>(
  text: string,
  candidates: ReadonlyArray<T>,
): T | null {
  const question = ` ${words(text)} `;
  const matches = candidates.filter((candidate) => {
    const name = words(candidate.title);
    return name.length >= 3 && question.includes(` ${name} `);
  });
  return matches.length === 1 ? matches[0]! : null;
}
