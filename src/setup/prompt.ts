import { createInterface, type Interface } from "node:readline";
import { Writable } from "node:stream";

/** Perguntas no terminal. Em TTY esconde senhas; com entrada redirecionada (pipe) lê uma linha por pergunta. */
export class Prompter {
  readonly tty = !!process.stdin.isTTY;
  private muted = false;
  private rl: Interface;
  private it?: AsyncIterator<string>;
  constructor() {
    const out = new Writable({ write: (c, _e, cb) => { if (!this.muted) process.stdout.write(c); cb(); } });
    this.rl = createInterface({ input: process.stdin, output: out, terminal: this.tty });
    if (!this.tty) this.it = this.rl[Symbol.asyncIterator]();
  }
  private async line(prompt: string, secret: boolean): Promise<string> {
    process.stdout.write(prompt);
    if (this.tty) {
      this.muted = secret;
      const v = await new Promise<string>((res) => this.rl.question("", res));
      this.muted = false;
      if (secret) process.stdout.write("\n");
      return v;
    }
    process.stdout.write("\n");
    const r = await this.it!.next();
    if (r.done) throw new Error("entrada encerrada antes de terminar as perguntas");
    return r.value;
  }
  async ask(q: string, o: { def?: string; secret?: boolean; optional?: boolean; validate?: (v: string) => string | null } = {}): Promise<string> {
    for (;;) {
      const hint = o.def ? ` [${o.secret ? "••••" : o.def}]` : o.optional ? " (opcional)" : "";
      const raw = (await this.line(`${q}${hint}: `, !!o.secret)).trim();
      const v = raw || o.def || "";
      if (!v && !o.optional) { console.log("  ↳ obrigatório"); continue; }
      const err = v && o.validate ? o.validate(v) : null;
      if (err) { console.log(`  ↳ ${err}`); continue; }
      return v;
    }
  }
  async confirm(q: string, def = true): Promise<boolean> {
    const v = (await this.line(`${q} [${def ? "S/n" : "s/N"}]: `, false)).trim().toLowerCase();
    return v ? ["s", "sim", "y", "yes"].includes(v) : def;
  }
  close() { this.rl.close(); }
}
