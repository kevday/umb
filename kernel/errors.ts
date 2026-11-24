/** Operação negada. A camada HTTP responde 404 para recursos e 403 para ações. */
export class Forbidden extends Error { constructor(public reason = "acesso negado") { super(reason); this.name = "Forbidden"; } }
export class NotFound extends Error { constructor(what = "recurso") { super(`${what} não encontrado`); this.name = "NotFound"; } }
/** Entrada inválida (mensagem segura para mostrar ao usuário). */
export class Invalid extends Error { constructor(message: string) { super(message); this.name = "Invalid"; } }
