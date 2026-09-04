import kleur from "kleur";

export const log = {
  info: (msg: string) => console.error(kleur.gray("· ") + msg),
  success: (msg: string) => console.error(kleur.green("✓ ") + msg),
  warn: (msg: string) => console.error(kleur.yellow("! ") + msg),
  error: (msg: string) => console.error(kleur.red("✗ ") + msg),
  hint: (msg: string) => console.error(kleur.gray("  " + msg)),
  stat: (label: string, value: string | number) =>
    console.error(kleur.gray(`  ${label.padEnd(20)} ${kleur.white(String(value))}`)),
};
