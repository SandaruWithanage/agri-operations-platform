/**
 * Finds leftover merge-conflict markers in text, including the forms a formatter produces from them: a marker
 * line inside a Markdown table becomes a table row, and a closing marker becomes spaced block-quote characters.
 * A bare line of equals signs is only reported when the same text also has an opening or closing marker, because
 * it is a valid Markdown heading underline on its own.
 */
const opening = /^(?:\|\s*)?<{7}(?:\s|$)/;
const closing = /^(?:\|\s*)?>{7}(?:\s|$)/;
const spacedClosing = /^(?:>\s*){7}\S/;
const separator = /^(?:\|\s*)?={7}(?:\s*\|?\s*)$/;

export function findConflictMarkers(text) {
  const lines = text.split("\n");
  const hits = [];
  let marked = false;
  lines.forEach((line, index) => {
    if (opening.test(line) || closing.test(line) || spacedClosing.test(line)) {
      hits.push(index + 1);
      marked = true;
    }
  });
  if (marked)
    lines.forEach((line, index) => {
      if (separator.test(line) && !hits.includes(index + 1))
        hits.push(index + 1);
    });
  return hits.sort((a, b) => a - b);
}
