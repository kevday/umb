import { createInterface, type Interface } from "node:readline";
import { Writable } from "node:stream";

export interface AskOpts {
  help?: string;      // o que está sendo pedido e por quê
  example?: string;   // exemplo de resposta
  def?: string;       // valor padrão (Enter aceita)
  secret?: boolean;   // oculta a digitação
  optional?: boolean; // Enter pula
  validate?: (v: string) => string | null; // devolve o motivo se for inválido
}

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
  /** O texto da pergunta é entregue ao readline (para ele redesenhar a linha sem apagá-lo); só a digitação é ocultada. */
  private async line(prompt: string, secret: boolean): Promise<string> {
    if (this.tty) {
      const answer = new Promise<string>((res) => this.rl.question(prompt, res));
      this.muted = secret;
      const v = await answer;
      this.muted = false;
      if (secret) process.stdout.write("\n");
      return v;
    }
    process.stdout.write(`${prompt}\n`);
    const r = await this.it!.next();
    if (r.done) throw new Error("entrada encerrada antes de terminar as perguntas");
    return r.value;
  }
  say(msg = "") { console.log(msg); }
  warn(msg: string) { console.log(`  ⚠ ${msg}`); }

  async ask(q: string, o: AskOpts = {}): Promise<string> {
    console.log(`\n${q}`);
    if (o.help) console.log(`  ${o.help}`);
    if (o.example) console.log(`  Exemplo: ${o.example}`);
    for (;;) {
      const hint = o.def ? `[Enter = ${o.secret ? "manter atual" : o.def}] ` : o.optional ? "[Enter para pular] " : "";
      const raw = (await this.line(`  ${hint}> `, !!o.secret)).trim();
      const v = raw || o.def || "";
      if (!v && !o.optional) { this.warn("Esta resposta é obrigatória."); continue; }
      const err = v && o.validate ? o.validate(v) : null;
      if (err) { this.warn(err); continue; }
      return v;
    }
  }
  async confirm(q: string, def = true, help?: string): Promise<boolean> {
    console.log(`\n${q}`);
    if (help) console.log(`  ${help}`);
    const v = (await this.line(`  [${def ? "S/n" : "s/N"}] > `, false)).trim().toLowerCase();
    return v ? ["s", "sim", "y", "yes"].includes(v) : def;
  }
  close() { this.rl.close(); }
}
