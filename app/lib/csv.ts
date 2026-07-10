export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((f) => (/[",\n\r]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
        .join(','),
    )
    .join('\r\n')
}
