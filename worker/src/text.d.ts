// Wrangler bundles .txt imports as strings (its default Text rule); vitest does the same via textFiles().
declare module '*.txt' {
  const text: string;
  export default text;
}
