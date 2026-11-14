import { createHmac } from "node:crypto";

export interface ActorQuery {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: unknown[] }>;
}
export type VerifiedActor = { accountId: string; sessionId: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Only invoke with a server-verified actor, using a dedicated connection and transaction. */
export class TransactionActorContext {
  private readonly key: Buffer;
  constructor(key: Buffer) {
    if (key.length < 32) throw new Error("Actor context key is too short");
    this.key = Buffer.from(key);
  }
  async bind(connection: ActorQuery, actor: VerifiedActor): Promise<void> {
    if (!uuid.test(actor.accountId) || !uuid.test(actor.sessionId))
      throw new Error("Invalid actor context");
    const result = await connection.query("SELECT txid_current()::text AS id");
    const transactionId = (result.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof transactionId !== "string" || !/^\d+$/.test(transactionId))
      throw new Error("Invalid transaction identifier");
    const signature = createHmac("sha256", this.key)
      .update(`${actor.accountId}:${actor.sessionId}:${transactionId}`, "utf8")
      .digest("hex");
    await connection.query(
      "SELECT set_config('agri.actor',$1,true), set_config('agri.session',$2,true), set_config('agri.signature',$3,true)",
      [actor.accountId, actor.sessionId, signature],
    );
  }
  /** Owns this transaction; never share the connection with concurrent requests. */
  async run<T>(
    connection: ActorQuery,
    actor: VerifiedActor,
    work: (connection: ActorQuery) => Promise<T>,
  ): Promise<T> {
    await connection.query("BEGIN");
    try {
      await this.bind(connection, actor);
      const value = await work(connection);
      await connection.query("COMMIT");
      return value;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    }
  }
}
