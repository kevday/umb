/** Negado por autorização. A camada HTTP responde 404 para recursos ocultos e 403 para ações. */
export class Forbidden extends Error {
  constructor(public reason: string) { super(reason); this.name = "Forbidden"; }
}
export class NotFound extends Error {
  constructor(what = "recurso") { super(`${what} não encontrado`); this.name = "NotFound"; }
}
export class Invalid extends Error {
  constructor(message: string) { super(message); this.name = "Invalid"; }
}
