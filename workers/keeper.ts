import { shannonTransport } from "../lib/testnet/transport";
import { DurableObject } from "cloudflare:workers";
import {
  createWalletClient,
  http,
  encodeFunctionData,
  isAddress,
  keccak256,
  maxUint256,
  parseEther,
  zeroAddress,
  zeroHash,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "viem/chains";
import {
  client,
  head,
  markets,
  readMarket,
  verifyRegistry,
} from "../lib/testnet/server";
import {
  RPC,
  MODULE,
  SETTLEMENT,
  settlementAbi,
  COLLATERAL,
  CREATOR,
  VENUE,
  tokenAbi,
  moduleAbi,
  type Tournament,
  type Player,
  CANCEL_TIMEOUT,
  START_GRACE,
} from "../lib/testnet/config";
import arenaArtifact from "../lib/testnet/MarketRoyale.json";
import vaultArtifact from "../lib/testnet/TraderVault.json";
import sponsorArtifact from "../lib/testnet/LiquiditySponsor.json";
import progressionArtifact from "../lib/testnet/MarketRoyaleProgression.json";
const abi = arenaArtifact.abi as Abi;
const progressionAbi = progressionArtifact.abi as Abi;
type Pending = { hash: Hex; raw: Hex; label: string; createdAt: number };
type Journal = { time: number; label: string; hash: Hex; status: string };
type FaucetResult = {
  status: number;
  body: {
    ok: boolean;
    error?: string;
    hash?: Hex;
    amount?: string;
    funder?: Address;
    nextEligibleAt?: number;
  };
};
type State = {
  lastRun: number;
  lastSuccess: number;
  error: string;
  pending: Pending | null;
  cursor: number;
  day: string;
  spent: string;
  log: Journal[];
  issues?: Record<string, { error: string; retryAt: number }>;
  botCursor?: number;
  fastUntil?: number;
  registry?: string;
};
const initial: State = {
  lastRun: 0,
  lastSuccess: 0,
  error: "",
  pending: null,
  cursor: 0,
  day: "",
  spent: "0",
  log: [],
};
function serial<T>(value: unknown): T {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
}
export class EventKeeper extends DurableObject<KeeperEnv> {
  constructor(ctx: DurableObjectState, env: KeeperEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS managed (id INTEGER PRIMARY KEY, asset TEXT)",
      );
      const managedColumns = ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(managed)")
        .toArray()
        .map((column) => column.name);
      if (!managedColumns.includes("asset"))
        ctx.storage.sql.exec("ALTER TABLE managed ADD COLUMN asset TEXT");
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS gas_claims (address TEXT PRIMARY KEY, claimed_at INTEGER NOT NULL, hash TEXT, raw TEXT, confirmed INTEGER NOT NULL DEFAULT 0)",
      );
      const claimColumns = ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(gas_claims)")
        .toArray()
        .map((column) => column.name);
      if (!claimColumns.includes("raw"))
        ctx.storage.sql.exec("ALTER TABLE gas_claims ADD COLUMN raw TEXT");
      if (!claimColumns.includes("confirmed"))
        ctx.storage.sql.exec(
          "ALTER TABLE gas_claims ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0",
        );
      ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO state VALUES (1, ?)",
        JSON.stringify(initial),
      );
      ctx.storage.sql.exec("INSERT OR IGNORE INTO lease VALUES (1, '', 0)");
    });
  }
  private state() {
    return JSON.parse(
      this.ctx.storage.sql
        .exec<{ data: string }>("SELECT data FROM state WHERE id=1")
        .one().data,
    ) as State;
  }
  private save(s: State) {
    this.ctx.storage.sql.exec(
      "UPDATE state SET data=? WHERE id=1",
      JSON.stringify(s),
    );
  }
  async status() {
    const s = this.state();
    const managedRows = this.ctx.storage.sql
      .exec<{ id: number; asset: string | null }>(
        "SELECT id,asset FROM managed ORDER BY id",
      )
      .toArray();
    const managed = managedRows.map((row) => row.id);
    const issues = Object.fromEntries(
      Object.entries(s.issues ?? {}).filter(([id]) =>
        managed.includes(Number(id)),
      ),
    );
    return {
      ...s,
      issues,
      pending: s.pending
        ? {
            hash: s.pending.hash,
            label: s.pending.label,
            createdAt: s.pending.createdAt,
          }
        : null,
      registry: this.env.ROYALE_ADDRESS,
      progression: this.env.PROGRESSION_ADDRESS,
      host: this.env.OFFICIAL_HOST,
      sponsor: this.env.LIQUIDITY_SPONSOR,
      enabled: !!this.env.KEEPER_PRIVATE_KEY,
      faucetEnabled: !!this.env.GAS_FAUCET_PRIVATE_KEY,
      faucet: this.env.GAS_FAUCET_ADDRESS,
      gasGrant: this.env.GAS_GRANT_STT,
      botBackfill: this.env.BOT_BACKFILL === "1" && !!this.env.BOT_PRIVATE_KEYS,
      bots: (this.env.BOT_ADDRESSES ?? "").split(",").filter(Boolean),
      keeper: this.env.KEEPER_PRIVATE_KEY
        ? privateKeyToAccount(this.env.KEEPER_PRIVATE_KEY as Hex).address
        : null,
      managed,
      assetPreferences: Object.fromEntries(
        managedRows
          .filter((row) => row.asset)
          .map((row) => [String(row.id), row.asset]),
      ),
    };
  }
  async requestGas(recipient: string): Promise<FaucetResult> {
    if (!isAddress(recipient) || recipient.toLowerCase() === zeroAddress)
      return {
        status: 400,
        body: { ok: false, error: "Enter a valid wallet address." },
      };
    if (!this.env.GAS_FAUCET_PRIVATE_KEY)
      return {
        status: 503,
        body: { ok: false, error: "The gas faucet is not configured yet." },
      };
    const account = privateKeyToAccount(this.env.GAS_FAUCET_PRIVATE_KEY as Hex);
    if (
      account.address.toLowerCase() !==
      this.env.GAS_FAUCET_ADDRESS.toLowerCase()
    )
      return {
        status: 503,
        body: { ok: false, error: "The gas faucet configuration is invalid." },
      };
    const address = recipient.toLowerCase();
    const now = Date.now();
    const cooldown = 24 * 60 * 60 * 1000;
    const previous = this.ctx.storage.sql
      .exec<{
        claimed_at: number;
        hash: string | null;
        raw: string | null;
        confirmed: number;
      }>(
        "SELECT claimed_at, hash, raw, confirmed FROM gas_claims WHERE address=?",
        address,
      )
      .toArray()[0];
    if (previous && now - previous.claimed_at < cooldown) {
      if (previous.confirmed || !previous.hash || !previous.raw)
        return {
          status: 429,
          body: {
            ok: false,
            error: previous.confirmed
              ? "This wallet already received its daily STT grant."
              : "This wallet's STT grant is already processing.",
            hash: (previous.hash as Hex | null) ?? undefined,
            nextEligibleAt: previous.claimed_at + cooldown,
          },
        };
      try {
        const pendingHash = previous.hash as Hex;
        let receipt;
        try {
          receipt = await client.getTransactionReceipt({ hash: pendingHash });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.name !== "TransactionReceiptNotFoundError"
          )
            throw error;
          await client
            .sendRawTransaction({ serializedTransaction: previous.raw as Hex })
            .catch((sendError) => {
              if (!String(sendError).includes("already known")) throw sendError;
            });
          receipt = await client.waitForTransactionReceipt({
            hash: pendingHash,
            timeout: 120_000,
          });
        }
        if (receipt.status === "success") {
          this.ctx.storage.sql.exec(
            "UPDATE gas_claims SET confirmed=1 WHERE address=? AND hash=?",
            address,
            pendingHash,
          );
          return {
            status: 200,
            body: {
              ok: true,
              hash: pendingHash,
              amount: this.env.GAS_GRANT_STT,
              funder: account.address,
              nextEligibleAt: previous.claimed_at + cooldown,
            },
          };
        }
        this.ctx.storage.sql.exec(
          "DELETE FROM gas_claims WHERE address=? AND hash=?",
          address,
          pendingHash,
        );
      } catch {
        return {
          status: 503,
          body: {
            ok: false,
            error:
              "The STT transfer was submitted but confirmation is delayed. It will be safely retried with the same transaction.",
            hash: previous.hash as Hex,
            nextEligibleAt: previous.claimed_at + cooldown,
          },
        };
      }
    }
    const dayStart = Date.parse(new Date(now).toISOString().slice(0, 10));
    const issuedToday = this.ctx.storage.sql
      .exec<{ total: number }>(
        "SELECT COUNT(*) AS total FROM gas_claims WHERE claimed_at>=?",
        dayStart,
      )
      .one().total;
    if (issuedToday >= Number(this.env.FAUCET_DAILY_GRANTS))
      return {
        status: 429,
        body: {
          ok: false,
          error:
            "Today's sponsored gas budget has been claimed. Try again after 00:00 UTC.",
          nextEligibleAt: dayStart + cooldown,
        },
      };
    // Reserve the address before the first await so concurrent requests cannot
    // receive duplicate transfers while the Shannon transaction is pending.
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO gas_claims (address, claimed_at, hash, raw, confirmed) VALUES (?, ?, NULL, NULL, 0)",
      address,
      now,
    );
    let submittedHash: Hex | undefined;
    try {
      await head();
      if ((await client.getChainId()) !== 50312)
        throw new Error("The Shannon RPC returned the wrong network.");
      const code = await client.getCode({ address: recipient });
      if (code && code !== "0x")
        throw new Error(
          "Sponsored gas is available for wallet addresses only.",
        );
      const value = parseEther(this.env.GAS_GRANT_STT);
      const estimate = await client.estimateGas({
        account,
        to: recipient,
        value,
      });
      const gas = (estimate * 150n) / 100n + 100_000n;
      const gasPrice = await client.getGasPrice();
      const balance = await client.getBalance({ address: account.address });
      if (balance < value + gas * gasPrice)
        throw new Error(
          `The gas faucet treasury needs at least ${this.env.GAS_GRANT_STT} STT plus network fees.`,
        );
      const wallet = createWalletClient({
        account,
        chain: somniaTestnet,
        transport: shannonTransport(),
      });
      const nonce = await client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      const raw = await wallet.signTransaction({
        account,
        chain: somniaTestnet,
        to: recipient,
        value,
        gas,
        gasPrice,
        nonce,
        type: "legacy",
      });
      const hash = keccak256(raw);
      submittedHash = hash;
      this.ctx.storage.sql.exec(
        "UPDATE gas_claims SET hash=?, raw=? WHERE address=? AND claimed_at=?",
        hash,
        raw,
        address,
        now,
      );
      await client.sendRawTransaction({ serializedTransaction: raw });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });
      if (receipt.status !== "success")
        throw new Error("The sponsored gas transfer reverted.");
      this.ctx.storage.sql.exec(
        "UPDATE gas_claims SET confirmed=1 WHERE address=? AND claimed_at=? AND hash=?",
        address,
        now,
        hash,
      );
      return {
        status: 200,
        body: {
          ok: true,
          hash,
          amount: this.env.GAS_GRANT_STT,
          funder: account.address,
          nextEligibleAt: now + cooldown,
        },
      };
    } catch (error) {
      if (!submittedHash)
        this.ctx.storage.sql.exec(
          "DELETE FROM gas_claims WHERE address=? AND claimed_at=? AND hash IS NULL",
          address,
          now,
        );
      const message =
        error instanceof Error && "shortMessage" in error
          ? String(error.shortMessage)
          : error instanceof Error
            ? error.message
            : "The sponsored gas transfer failed.";
      return {
        status: 503,
        body: {
          ok: false,
          error: submittedHash
            ? `${message} The same transaction will be retried safely.`
            : message,
          hash: submittedHash,
          nextEligibleAt: submittedHash ? now + cooldown : undefined,
        },
      };
    }
  }
  async wake(matchId?: number, asset?: string) {
    const preferredAsset = ["BTC", "ETH"].includes(asset ?? "")
      ? asset
      : null;
    if (Number.isSafeInteger(matchId) && Number(matchId) > 0) {
      this.ctx.storage.sql.exec(
        "INSERT INTO managed (id,asset) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET asset=COALESCE(excluded.asset,managed.asset)",
        Number(matchId),
        preferredAsset,
      );
      const state = this.state();
      state.fastUntil = Math.max(
        state.fastUntil ?? 0,
        Date.now() + 2 * 60 * 1000,
      );
      this.save(state);
    }
    const alarm = await this.ctx.storage.getAlarm();
    if (
      alarm === null ||
      alarm < Date.now() - 30000 ||
      alarm > Date.now() + 1000
    )
      await this.ctx.storage.setAlarm(Date.now() + 100);
    return { armed: true, matchId: matchId ?? null };
  }
  async alarm() {
    const owner = crypto.randomUUID();
    const acquired = this.ctx.storage.sql.exec(
      "UPDATE lease SET owner=?,expires=? WHERE id=1 AND expires<?",
      owner,
      Date.now() + 120000,
      Date.now(),
    ).rowsWritten;
    if (!acquired) {
      const rapid = (this.state().fastUntil ?? 0) > Date.now();
      await this.ctx.storage.setAlarm(Date.now() + (rapid ? 3000 : 15000));
      return;
    }
    const assertLease = () => {
      if (
        this.ctx.storage.sql
          .exec<{ owner: string }>("SELECT owner FROM lease WHERE id=1")
          .one().owner !== owner
      )
        throw new Error("Keeper lease expired; retrying safely.");
    };
    try {
      await this.tick(assertLease);
    } catch (error) {
      const s = this.state();
      s.error =
        error instanceof Error
          ? "shortMessage" in error
            ? String(error.shortMessage)
            : error.message
          : "Keeper unavailable";
      this.save(s);
      console.error(
        JSON.stringify({ service: "event-keeper", error: s.error }),
      );
    } finally {
      this.ctx.storage.sql.exec(
        "UPDATE lease SET owner='',expires=0 WHERE id=1 AND owner=?",
        owner,
      );
      const rapid = (this.state().fastUntil ?? 0) > Date.now();
      await this.ctx.storage.setAlarm(Date.now() + (rapid ? 3000 : 15000));
    }
  }
  private async tick(assertLease: () => void) {
    const s = this.state();
    s.lastRun = Date.now();
    this.save(s);
    if (!this.env.KEEPER_PRIVATE_KEY)
      throw new Error(
        "Keeper signer is not configured. Manual player controls remain available.",
      );
    await head();
    const registry = this.env.ROYALE_ADDRESS as Address;
    const version = await verifyRegistry(registry);
    if ((await client.getChainId()) !== 50312 || ![2, 3, 4, 5].includes(version))
      throw new Error("Keeper requires a verified Shannon arena.");
    const account = privateKeyToAccount(this.env.KEEPER_PRIVATE_KEY as Hex);
    const progression = this.env.PROGRESSION_ADDRESS as Address;
    if (!isAddress(progression))
      throw new Error("Progression sidecar is not configured.");
    const [progressionVersion, progressionArena] = await Promise.all([
      client.readContract({
        address: progression,
        abi: progressionAbi,
        functionName: "VERSION",
      }),
      client.readContract({
        address: progression,
        abi: progressionAbi,
        functionName: "arena",
      }),
    ]);
    if (
      Number(progressionVersion) < 4 ||
      String(progressionArena).toLowerCase() !== registry.toLowerCase()
    )
      throw new Error("Unexpected progression sidecar configuration.");
    const botBackfill = this.env.BOT_BACKFILL === "1";
    const botKeys = (this.env.BOT_PRIVATE_KEYS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean) as Hex[];
    const bots = botKeys.map((key) => privateKeyToAccount(key));
    const expectedBots = (this.env.BOT_ADDRESSES ?? "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean);
    if (
      botBackfill &&
      (!bots.length ||
        bots.length !== expectedBots.length ||
        bots.some(
          (bot, index) => bot.address.toLowerCase() !== expectedBots[index],
        ))
    )
      throw new Error("Training bot signer configuration is invalid.");
    const today = new Date().toISOString().slice(0, 10);
    if (s.day !== today) {
      s.day = today;
      s.spent = "0";
    }
    if (s.pending) {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: s.pending.hash });
      } catch (e) {
        if (
          !(e instanceof Error) ||
          e.name !== "TransactionReceiptNotFoundError"
        )
          throw e;
        assertLease();
        await client
          .sendRawTransaction({ serializedTransaction: s.pending.raw })
          .catch((e) => {
            if (!String(e).includes("already known")) throw e;
          });
        return;
      }
      assertLease();
      s.spent = String(
        BigInt(s.spent) + receipt.gasUsed * receipt.effectiveGasPrice,
      );
      s.log = [
        {
          time: Date.now(),
          label: s.pending.label,
          hash: s.pending.hash,
          status: receipt.status,
        },
        ...s.log,
      ].slice(0, 100);
      s.pending = null;
      s.lastSuccess = Date.now();
      this.save(s);
    }
    if (s.registry?.toLowerCase() !== registry.toLowerCase()) {
      this.ctx.storage.sql.exec("DELETE FROM managed");
      s.registry = registry;
      s.cursor = 0;
      s.botCursor = 0;
      s.issues = {};
      this.save(s);
    }
    if (BigInt(s.spent) >= parseEther(this.env.DAILY_GAS_BUDGET_STT))
      throw new Error(
        "Keeper daily gas budget reached. Manual actions remain available.",
      );
    const sendFrom = async (
      signer: typeof account,
      address: Address,
      contractAbi: Abi,
      fn: string,
      args: unknown[],
      label: string,
    ) => {
      await client.simulateContract({
        account: signer,
        address,
        abi: contractAbi,
        functionName: fn,
        args,
      });
      const estimate = await client.estimateContractGas({
        account: signer,
        address,
        abi: contractAbi,
        functionName: fn,
        args,
      });
      const gas = (estimate * 150n) / 100n + 100000n,
        gasPrice = await client.getGasPrice();
      if (
        gas * gasPrice + BigInt(s.spent) >
        parseEther(this.env.DAILY_GAS_BUDGET_STT)
      )
        throw new Error("Next keeper action exceeds the daily gas budget.");
      let signerGas = await client.getBalance({ address: signer.address });
      if (signerGas < gas * gasPrice) {
        const grant = await this.requestGas(signer.address);
        if (!grant.body.ok)
          throw new Error(
            grant.body.error ??
              "An automatic testnet signer needs STT for gas.",
          );
        signerGas = await client.getBalance({ address: signer.address });
      }
      if (signerGas < gas * gasPrice)
        throw new Error("The automatic STT grant is too small for this action.");
      const nonce = await client.getTransactionCount({
        address: signer.address,
        blockTag: "pending",
      });
      const signerWallet = createWalletClient({
        account: signer,
        chain: somniaTestnet,
        transport: shannonTransport(),
      });
      const raw = await signerWallet.signTransaction({
        account: signer,
        chain: somniaTestnet,
        to: address,
        data: encodeFunctionData({ abi: contractAbi, functionName: fn, args }),
        gas,
        gasPrice,
        nonce,
        type: "legacy",
      });
      assertLease();
      s.pending = { hash: keccak256(raw), raw, label, createdAt: Date.now() };
      s.error = "";
      this.save(s);
      // Persist signed bytes before broadcasting. An alarm retry resends exactly the same transaction.
      await client.sendRawTransaction({ serializedTransaction: raw });
    };
    const send = (
      address: Address,
      contractAbi: Abi,
      fn: string,
      args: unknown[],
      label: string,
    ) => sendFrom(account, address, contractAbi, fn, args, label);
    const sponsor = this.env.LIQUIDITY_SPONSOR as Address,
      sponsorAbi = sponsorArtifact.abi as Abi;
    // This sponsor was deployed before the progression source joined the solc
    // input, which changes metadata bytes without changing executable logic.
    // Pin its address and verify every immutable binding below.
    if (sponsor.toLowerCase() !== "0x24a43ad7e9318cf515867477bf9c489989dcc701")
      throw new Error("Unrecognized liquidity sponsor.");
    const [
      sponsorOwner,
      sponsorToken,
      sponsorModule,
      sponsorCreator,
      sponsorVenue,
    ] = await Promise.all(
      ["treasury", "token", "module", "creator", "venue"].map((functionName) =>
        client.readContract({
          address: sponsor,
          abi: sponsorAbi,
          functionName,
        }),
      ),
    );
    if (
      String(sponsorOwner).toLowerCase() !== account.address.toLowerCase() ||
      String(sponsorToken).toLowerCase() !== COLLATERAL.toLowerCase() ||
      String(sponsorModule).toLowerCase() !== MODULE.toLowerCase() ||
      String(sponsorCreator).toLowerCase() !== CREATOR.toLowerCase() ||
      sponsorVenue !== VENUE
    )
      throw new Error("Unexpected liquidity treasury configuration.");
    const seedCount = Number(
      await client.readContract({
        address: sponsor,
        abi: sponsorAbi,
        functionName: "count",
      }),
    );
    for (let i = 0; i < seedCount; i++) {
      const seed = (await client.readContract({
        address: sponsor,
        abi: sponsorAbi,
        functionName: "getSeed",
        args: [BigInt(i)],
      })) as { marketId: Hex; closed: boolean };
      if (seed.closed) continue;
      const m = await readMarket(seed.marketId);
      if (m.resolved || m.voided) {
        if (
          !(await client.readContract({
            address: SETTLEMENT,
            abi: settlementAbi,
            functionName: "isFinalized",
            args: [BigInt(m.yesId)],
          }))
        ) {
          await send(
            MODULE,
            moduleAbi,
            "finalizeMarket",
            [m.id],
            "Finalize treasury market",
          );
          return;
        }
        await send(
          sponsor,
          sponsorAbi,
          "recover",
          [BigInt(i)],
          "Recover expired treasury liquidity",
        );
        return;
      }
    }
    const ensureLiquidity = async (
      m: Awaited<ReturnType<typeof readMarket>>,
      players: number,
      bankroll: bigint,
    ) => {
      if (
        await client.readContract({
          address: registry,
          abi,
          functionName: "liquidityReady",
          args: [m.id, BigInt(players), bankroll],
        })
      )
        return false;
      if (
        await client.readContract({
          address: sponsor,
          abi: sponsorAbi,
          functionName: "seeded",
          args: [m.id],
        })
      )
        return false;
      if (m.recycled || m.status !== 1 || m.bookError || BigInt(m.tick) === 0n)
        return false;
      const depthPerPlayer = bankroll / 5n > 1_000_000n ? bankroll / 5n : 1_000_000n;
      const requiredDepth = BigInt(players) * depthPerPlayer;
      const amount = requiredDepth > 20_000_000n ? requiredDepth : 20_000_000n;
      const balance = await client.readContract({
        address: COLLATERAL,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (balance < amount) {
        await send(
          COLLATERAL,
          tokenAbi,
          "faucet",
          [100_000_000n],
          "Fund testnet liquidity treasury",
        );
        return true;
      }
      const allowance = await client.readContract({
        address: COLLATERAL,
        abi: tokenAbi,
        functionName: "allowance",
        args: [account.address, sponsor],
      });
      if (allowance < amount) {
        await send(
          COLLATERAL,
          tokenAbi,
          "approve",
          [sponsor, amount],
          "Approve treasury liquidity",
        );
        return true;
      }
      const tick = BigInt(m.tick),
        bestBid = m.bids[0] ? BigInt(m.bids[0].price) : null,
        bestAsk = m.asks[0] ? BigInt(m.asks[0].price) : null;
      const mid =
        bestBid !== null && bestAsk !== null
          ? (bestBid + bestAsk) / 2n
          : bestBid !== null
            ? bestBid + 50000n
            : bestAsk !== null
              ? bestAsk - 50000n
              : 500000n;
      let bid = ((mid - 50000n) / tick) * tick,
        ask = ((mid + 50000n + tick - 1n) / tick) * tick;
      // Join the best level when existing quotes are tighter, so added depth actually satisfies the start guard.
      if (bestBid !== null && bestBid > bid) bid = bestBid;
      if (bestAsk !== null && bestAsk < ask) ask = bestAsk;
      if (bid <= 0n) bid = tick;
      if (ask >= 1_000_000n) ask = 1_000_000n - tick;
      if (bestAsk !== null && bid >= bestAsk) bid = bestAsk - tick;
      if (bestBid !== null && ask <= bestBid) ask = bestBid + tick;
      if (bid <= 0n || ask >= 1_000_000n || ask <= bid || ask - bid > 200000n)
        return false;
      await send(
        sponsor,
        sponsorAbi,
        "seed",
        [m.id, amount, bid, ask],
        `Provide real treasury liquidity · ${m.asset}`,
      );
      return true;
    };
    const count = Number(
      await client.readContract({
        address: registry,
        abi,
        functionName: "tournamentCount",
      }),
    );
    for (let id = s.cursor + 1; id <= Math.min(count, s.cursor + 20); id++) {
      const t = (await client.readContract({
        address: registry,
        abi,
        functionName: "getTournament",
        args: [BigInt(id)],
      })) as Tournament;
      if (t.host.toLowerCase() === this.env.OFFICIAL_HOST.toLowerCase())
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO managed (id) VALUES (?)",
          id,
        );
    }
    s.cursor = Math.min(count, s.cursor + 20);
    if (botBackfill && count) {
      const start = (s.botCursor ?? 0) >= count ? 1 : (s.botCursor ?? 0) + 1;
      const end = Math.min(count, start + 19);
      for (let id = start; id <= end; id++) {
        const tournament = (await client.readContract({
          address: registry,
          abi,
          functionName: "getTournament",
          args: [BigInt(id)],
        })) as Tournament;
        if (tournament.phase < 3)
          this.ctx.storage.sql.exec(
            "INSERT OR IGNORE INTO managed (id) VALUES (?)",
            id,
          );
      }
      s.botCursor = end >= count ? 0 : end;
    }
    assertLease();
    this.save(s);
    const ids = this.ctx.storage.sql
      .exec<{ id: number }>("SELECT id FROM managed ORDER BY id")
      .toArray()
      .map((r) => r.id);
    let live: Awaited<ReturnType<typeof markets>> | undefined;
    const upcoming = await Promise.all(
      ids.map(async (id) => {
        const raw = serial<Tournament>(
          await client.readContract({
            address: registry,
            abi,
            functionName: "getTournament",
            args: [BigInt(id)],
          }),
        );
        return {
          id,
          t: {
            ...raw,
            joinDeadline: Number(raw.joinDeadline),
            expiry: Number(raw.expiry),
            updatedAt: Number(raw.updatedAt),
            duration: Number(raw.duration),
          },
        };
      }),
    );
    const clock = Number((await client.getBlock()).timestamp);
    const priority = (t: Tournament) =>
      t.phase === 0 &&
      t.activeCount >= t.minPlayers &&
      clock <= t.joinDeadline + START_GRACE
        ? 0
        : t.phase === 1
          ? 1
          : t.phase === 0
            ? 2
            : 3;
    upcoming.sort(
      (a, b) =>
        priority(a.t) - priority(b.t) || a.t.joinDeadline - b.t.joinDeadline,
    );
    s.issues ??= {};
      for (const { id, t } of upcoming) {
      if ((s.issues[id]?.retryAt ?? 0) > Date.now()) continue;
      try {
        const ps = serial<Player[]>(
          await client.readContract({
            address: registry,
            abi,
            functionName: "getPlayers",
            args: [BigInt(id)],
          }),
        );
        const preferredAsset = this.ctx.storage.sql
          .exec<{ asset: string | null }>(
            "SELECT asset FROM managed WHERE id=?",
            id,
          )
          .toArray()[0]?.asset;
        const now = Number((await client.getBlock()).timestamp);
        if (t.phase >= 2) {
          const due = [];
          for (let index = 0; index < ps.length; index++)
            if (t.phase >= 3 || !ps[index].active) {
              const withdrawn = await client.readContract({
                address: ps[index].vault,
                abi: vaultArtifact.abi as Abi,
                functionName: "withdrawn",
              });
              if (!withdrawn || (t.phase >= 3 && !ps[index].prizeClaimed))
                due.push(index);
            }
          if (due.length) {
            s.issues[id] = {
              error:
                "Payout is being processed; deferred recipients will retry.",
              retryAt: Date.now() + 60000,
            };
            await send(
              registry,
              abi,
              "payoutBatch",
              [BigInt(id), BigInt(due[0]), 8n],
              `Pay entrants · royale ${id}`,
            );
            return;
          }
          if (t.phase >= 3) {
            for (const player of ps) {
              const recorded = await client.readContract({
                address: progression,
                abi: progressionAbi,
                functionName: "resultRecorded",
                args: [BigInt(id), player.wallet],
              });
              if (!recorded) {
                await send(
                  progression,
                  progressionAbi,
                  "recordResult",
                  [BigInt(id), player.wallet],
                  `Record progression · royale ${id} · ${player.wallet.slice(0, 8)}`,
                );
                return;
              }
            }
            delete s.issues[id];
            this.ctx.storage.sql.exec("DELETE FROM managed WHERE id=?", id);
            continue;
          }
        }
        if (
          botBackfill &&
          t.phase === 0 &&
          now < t.joinDeadline &&
          now + 600 >= t.joinDeadline &&
          now >= t.joinDeadline - Number(this.env.BOT_JOIN_LEAD_SECONDS)
        ) {
          const target = Math.min(
            t.capacity,
            Math.max(t.minPlayers, Number(this.env.BOT_TARGET_PLAYERS)),
          );
          const joined = new Set(
            ps.map((player) => player.wallet.toLowerCase()),
          );
          const bot = bots.find(
            (candidate) => !joined.has(candidate.address.toLowerCase()),
          );
          if (ps.length < target && bot) {
            const botBalance = await client.readContract({
              address: COLLATERAL,
              abi: tokenAbi,
              functionName: "balanceOf",
              args: [bot.address],
            });
            const requiredSeat = BigInt(t.entryFee) + BigInt(t.bankroll);
            if (botBalance < requiredSeat) {
              await sendFrom(
                bot,
                COLLATERAL,
                tokenAbi,
                "faucet",
                [requiredSeat > 100_000_000n ? requiredSeat : 100_000_000n],
                `Fund training bot · ${bot.address.slice(0, 8)}`,
              );
              return;
            }
            const allowance = await client.readContract({
              address: COLLATERAL,
              abi: tokenAbi,
              functionName: "allowance",
              args: [bot.address, registry],
            });
            if (allowance < requiredSeat) {
              await sendFrom(
                bot,
                COLLATERAL,
                tokenAbi,
                "approve",
                [registry, maxUint256],
                `Approve training bot · ${bot.address.slice(0, 8)}`,
              );
              return;
            }
            await sendFrom(
              bot,
              registry,
              abi,
              "join",
              [BigInt(id)],
              `Backfill training bot · royale ${id}`,
            );
            return;
          }
        }
        if (botBackfill && t.phase === 1 && now < t.expiry - 20) {
          const candidates = ps.filter(
            (player) =>
              player.active &&
              bots.some(
                (bot) =>
                  bot.address.toLowerCase() === player.wallet.toLowerCase(),
              ),
          );
          for (const player of candidates) {
            const [actions, settled, yesShares, noShares, cash] = await Promise.all([
              client.readContract({
                address: player.vault,
                abi: vaultArtifact.abi as Abi,
                functionName: "actions",
              }),
              client.readContract({
                address: player.vault,
                abi: vaultArtifact.abi as Abi,
                functionName: "settled",
              }),
              client.readContract({
                address: player.vault,
                abi: vaultArtifact.abi as Abi,
                functionName: "yesShares",
              }),
              client.readContract({
                address: player.vault,
                abi: vaultArtifact.abi as Abi,
                functionName: "noShares",
              }),
              client.readContract({
                address: player.vault,
                abi: vaultArtifact.abi as Abi,
                functionName: "cash",
              }),
            ]);
            const actionCount = Number(actions);
            const stepSeconds = Math.max(
              30,
              Math.min(120, Math.floor(t.duration / 8)),
            );
            const targetActions = Math.min(
              6,
              Math.floor(Math.max(0, now - t.updatedAt) / stepSeconds) + 1,
            );
            if (actionCount >= targetActions || settled) continue;
            const market = await readMarket(t.marketId);
            if (
              market.status !== 1 ||
              market.recycled ||
              market.bookError ||
              !market.asks[0] ||
              !market.bids[0]
            )
              break;
            const botIndex = bots.findIndex(
              (bot) =>
                bot.address.toLowerCase() === player.wallet.toLowerCase(),
            );
            const openingUp = (botIndex + t.round) % 2 === 0;
            const buying = actionCount % 2 === 0;
            const tradeUp = actionCount < 2 ? openingUp : !openingUp;
            let kind: number;
            let price: bigint;
            let quantity: bigint;
            if (buying) {
              kind = tradeUp ? 0 : 2;
              price = BigInt(
                tradeUp ? market.asks[0].price : market.bids[0].price,
              );
              const lot = BigInt(market.lot);
              const minimum = BigInt(market.min);
              quantity = 1_000_000n;
              if (quantity < minimum) quantity = minimum;
              quantity = ((quantity + lot - 1n) / lot) * lot;
              const affordable = ((cash as bigint) * 1_000_000n) / price;
              if (quantity > affordable)
                quantity = (affordable / lot) * lot;
              if (quantity < minimum) continue;
            } else {
              const upHolding = yesShares as bigint;
              const downHolding = noShares as bigint;
              const sellUp = tradeUp ? upHolding > 0n : downHolding === 0n;
              kind = sellUp ? 1 : 3;
              price = BigInt(
                sellUp ? market.bids[0].price : market.asks[0].price,
              );
              quantity = sellUp ? upHolding : downHolding;
              if (quantity === 0n) continue;
            }
            await sendFrom(
              bots[botIndex],
              player.vault,
              vaultArtifact.abi as Abi,
              "trade",
              [kind, price, quantity],
              `Training bot ${botIndex + 1} ${buying ? "buys" : "sells"} · royale ${id}`,
            );
            return;
          }
        }
        if (t.phase === 0) {
          if (now < t.joinDeadline) {
            if (ps.length >= t.minPlayers && now >= t.joinDeadline - 90) {
              live ??= await markets();
                  const candidate = t.scheduled
                ? live.markets.find(
                    (m) =>
                      m.interval === t.duration &&
                      (!preferredAsset || m.asset === preferredAsset) &&
                      m.start >= t.joinDeadline - 60 &&
                      m.expiry > t.joinDeadline + 150 &&
                      m.status === 1,
                  )
                : await readMarket(t.marketId);
              if (
                candidate &&
                (await ensureLiquidity(
                  candidate,
                  ps.length,
                  BigInt(t.bankroll),
                ))
              )
                return;
            }
            continue;
          }
          if (
            ps.length < t.minPlayers ||
            now > t.joinDeadline + START_GRACE ||
            (!t.scheduled && now >= t.expiry - 120)
          ) {
            await send(
              registry,
              abi,
              "cancel",
              [BigInt(id)],
              `Cancel unstarted event · royale ${id}`,
            );
            return;
          }
          if (!t.scheduled) {
            if (
              await ensureLiquidity(
                await readMarket(t.marketId),
                ps.length,
                BigInt(t.bankroll),
              )
            )
              return;
            const ready = await client.readContract({
              address: registry,
              abi,
              functionName: "liquidityReady",
              args: [t.marketId, BigInt(ps.length), BigInt(t.bankroll)],
            });
            if (ready) {
              await send(
                registry,
                abi,
                "start",
                [BigInt(id)],
                `Start event · royale ${id}`,
              );
              return;
            }
            continue;
          }
        }
        if (t.phase === 1 && now >= t.expiry) {
          if (t.roundTrades === 0) {
            await send(
              registry,
              abi,
              "settleBatch",
              [BigInt(id)],
              `Refund no-trade event · royale ${id}`,
            );
            return;
          }
          const m = await readMarket(t.marketId);
          if (m.resolved || m.voided) {
            await send(
              registry,
              abi,
              "settleBatch",
              [BigInt(id)],
              `Settle oracle result · royale ${id}`,
            );
            return;
          }
          if (now > t.expiry + CANCEL_TIMEOUT) {
            await send(
              registry,
              abi,
              "cancel",
              [BigInt(id)],
              `Cancel oracle timeout · royale ${id}`,
            );
            return;
          }
          try {
            await client.simulateContract({
              account,
              address: MODULE,
              abi: moduleAbi,
              functionName: "pokeOracle",
              args: [BigInt(m.questionId)],
            });
          } catch {
            continue;
          }
          await send(
            MODULE,
            moduleAbi,
            "pokeOracle",
            [BigInt(m.questionId)],
            `Sync oracle · royale ${id}`,
          );
          return;
        }
        if (t.phase === 2 && now > t.updatedAt + CANCEL_TIMEOUT) {
          await send(
            registry,
            abi,
            "cancel",
            [BigInt(id)],
            `Cancel stalled next round · royale ${id}`,
          );
          return;
        }
        if (
          (t.phase === 0 && t.scheduled && now >= t.joinDeadline) ||
          t.phase === 2
        ) {
          live ??= await markets();
          for (const m of live.markets) {
            if (
              m.interval !== t.duration ||
              (preferredAsset && m.asset !== preferredAsset) ||
              m.expiry <= Number((await client.getBlock()).timestamp) + 150 ||
              m.status !== 1 ||
              (t.phase === 0 && m.start < t.joinDeadline - 60) ||
              (t.phase === 2 && m.start < t.expiry)
            )
              continue;
            if (
              await ensureLiquidity(m, t.activeCount, BigInt(t.bankroll))
            )
              return;
            if (
              !(await client.readContract({
                address: registry,
                abi,
                functionName: "liquidityReady",
                args: [m.id, BigInt(t.activeCount), BigInt(t.bankroll)],
              }))
            )
              continue;
            await send(
              registry,
              abi,
              t.phase === 0 ? "startScheduled" : "nextRound",
              [BigInt(id), m.id],
              `${t.phase === 0 ? "Start scheduled event" : "Advance round"} · royale ${id}`,
            );
            return;
          }
        }
        delete s.issues[id];
      } catch (error) {
        // A bad market or one deferred payout must not block other tournaments.
        if (s.pending) throw error;
        const message =
          error instanceof Error && "shortMessage" in error
            ? String(error.shortMessage)
            : error instanceof Error
              ? error.message
              : "Event action failed";
        s.issues[id] = { error: message, retryAt: Date.now() + 30000 };
        this.save(s);
        console.error(
          JSON.stringify({
            service: "event-keeper",
            event: id,
            error: message,
          }),
        );
      }
    }
    if (botBackfill) {
      for (const bot of bots) {
        const nativeBalance = await client.getBalance({ address: bot.address });
        if (nativeBalance < parseEther("0.05")) {
          const grant = await this.requestGas(bot.address);
          if (!grant.body.ok)
            throw new Error(
              grant.body.error ?? "Unable to replenish training-bot gas.",
            );
          return;
        }
        const collateralBalance = await client.readContract({
          address: COLLATERAL,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [bot.address],
        });
        if (collateralBalance < 300_000_000n) {
          await sendFrom(
            bot,
            COLLATERAL,
            tokenAbi,
            "faucet",
            [100_000_000n],
            `Replenish training bot tUSDC · ${bot.address.slice(0, 8)}`,
          );
          return;
        }
      }
    }
    s.error = "";
    this.save(s);
  }
}
async function sameSecret(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a),
    right = new Uint8Array(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export default {
  async fetch(request: Request, env: KeeperEnv) {
    const stub = env.EVENT_KEEPER.getByName(env.ROYALE_ADDRESS.toLowerCase());
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/status")
      return Response.json(await stub.status(), {
        headers: { "Cache-Control": "no-store" },
      });
    if (request.method === "POST" && path === "/wake") {
      let matchId: number | undefined;
      let asset: string | undefined;
      try {
        const body = (await request.json()) as {
          matchId?: unknown;
          asset?: unknown;
        };
        if (typeof body.matchId === "number") matchId = body.matchId;
        if (typeof body.asset === "string") asset = body.asset;
      } catch {}
      return Response.json(await stub.wake(matchId, asset));
    }
    if (request.method === "POST" && path === "/faucet") {
      if (
        !(await sameSecret(
          request.headers.get("x-market-royale-faucet-token") ?? "",
          env.FAUCET_API_TOKEN,
        ))
      )
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      let body: { address?: string };
      try {
        body = (await request.json()) as { address?: string };
      } catch {
        return Response.json({ error: "Invalid JSON body." }, { status: 400 });
      }
      const result = await stub.requestGas(body.address ?? "");
      return Response.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: KeeperEnv) {
    await env.EVENT_KEEPER.getByName(env.ROYALE_ADDRESS.toLowerCase()).wake();
  },
} satisfies ExportedHandler<KeeperEnv>;
