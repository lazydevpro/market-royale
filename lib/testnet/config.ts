import {
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
export const CHAIN_ID = 50312;
export const RPC = "https://dream-rpc.somnia.network";
export const EXPLORER = "https://shannon-explorer.somnia.network";
export const PROGRESSION = process.env.NEXT_PUBLIC_PROGRESSION_ADDRESS as
  Address | undefined;
export const TEST_BOTS = (process.env.NEXT_PUBLIC_TEST_BOTS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => isAddress(value)) as Address[];
export const COLLATERAL: Address = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
export const OUTCOME_TOKEN: Address =
  "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9";
export const MODULE: Address = "0x3ecC694Cef705358864a646142ac17A90E29e388";
export const SETTLEMENT: Address = "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23";
// Rolling creator discovered from live events, confirmed against the module record.
export const CREATOR: Address = "0x94D963B6670AB96E78C8d0C46ca35D196d606EFE";
export const VENUE: Hex =
  "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function faucet(uint256)",
  "function decimals() view returns(uint8)",
]);
export const settlementAbi = parseAbi([
  "function isFinalized(uint256) view returns(bool)",
]);
export const moduleAbi = parseAbi([
  "function finalizeMarket(bytes32)",
  "function markets(bytes32) view returns(uint256 question,uint8 slots,uint8 voidPolicy,address collateral,uint32 operatorId,bytes32 venue,address oracle,address creator,address market,address pool,uint256 yesId,uint256 noId,uint64 start,uint64 expiry)",
  "function pokeOracle(uint256 oracleQuestionId)",
  "function redeem(uint32 operatorId,bytes32 venueId,bytes32 marketId,uint8 outcomeIdx,uint256 amount)",
]);
export const marketAbi = parseAbi([
  "function status() view returns(uint8)",
  "function outcomeToken() view returns(address)",
  "function isResolved() view returns(bool)",
  "function isVoided() view returns(bool)",
  "function payoutNumerators() view returns(uint256[])",
  "function voidExpired()",
]);
export const poolAbi = parseAbi([
  "function getBookLevels(bool isBid,uint64 numLevels) view returns((uint256 price,uint256 quantity)[])",
  "function getOrderBookParameters() view returns((uint256 tickSize,uint256 minQuantity,uint256 lotSize))",
  "function marketExpiryNs() view returns(uint64)",
]);
export const liquidityAbi = parseAbi([
  "function mintSet(address yesTo,address noTo,uint256 amount)",
  "function placeBinaryOrder(uint8 kind,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k,uint64 userData) payable returns(bool success,uint128 id)",
  "function cancelOrder(uint128 orderId)",
  "function getAllOpenOrdersOffChain(bool isBid,uint256 maxCount,uint64 startCursor) view returns((uint128 orderId,bool isBid,address owner,uint64 userData,uint256 price,uint256 fullQuantity,uint256 quantityRemaining,uint64 expireTimestampNs)[] orders,bool hasMoreOrders,uint64 nextCursor)",
]);
export const outcomeAbi = parseAbi([
  "function balanceOf(address,uint256) view returns(uint256)",
  "function setOperator(address,bool) returns(bool)",
]);
export const createdEvent = parseAbiItem(
  "event MarketCreated(bytes32 indexed marketId,address indexed market,address indexed pool,uint256 yesId,uint256 noId,address collateral,string asset,uint256 strike,uint64 tradingStart,uint64 expiry,uint256 oracleQuestionId,string question,uint64 intervalSec)",
);
export type Level = { price: string; quantity: string };
export type LiveMarket = {
  id: Hex;
  market: Address;
  pool: Address;
  creator: Address;
  venue: Hex;
  asset: string;
  question: string;
  questionId: string;
  start: number;
  expiry: number;
  interval: number;
  yesId: string;
  noId: string;
  outcomeToken: Address;
  status: number;
  resolved: boolean;
  voided: boolean;
  payouts: string[];
  bids: Level[];
  asks: Level[];
  tick: string;
  lot: string;
  min: string;
  bookError?: string;
  recycled: boolean;
};
export const CANCEL_TIMEOUT = 900;
export const START_GRACE = 120;
export const CANCEL_REASONS = [
  "",
  "Not enough players",
  "Start window expired",
  "No trades executed",
  "Oracle timeout",
  "Next-round timeout",
  "Insufficient liquidity",
  "Host cancelled",
  "Market voided",
];
export type Tournament = {
  minPlayers: number;
  roundTrades: number;
  cancelReason: number;
  scheduled: boolean;
  id: number;
  host: Address;
  creator: Address;
  venue: Hex;
  marketId: Hex;
  joinDeadline: number;
  expiry: number;
  updatedAt: number;
  duration: number;
  capacity: number;
  maxRounds: number;
  round: number;
  activeCount: number;
  settleCursor: number;
  phase: number;
  prizePool: string;
  finalized: boolean;
  entryFee: string;
  bankroll: string;
};
export type Player = {
  wallet: Address;
  vault: Address;
  active: boolean;
  eliminatedRound: number;
  rank: number;
  prizeClaimed: boolean;
  prize: string;
  cash: string;
  yesShares: string;
  noShares: string;
  actions: number;
  settled: boolean;
  withdrawn: boolean;
};
export type Snapshot = {
  account: Address | null;
  version: number;
  chainId: number;
  block: string;
  timestamp: number;
  registry: Address | null;
  tournaments: Tournament[];
  selected: Tournament | null;
  players: Player[];
  market: LiveMarket | null;
  balance: string;
  gas: string;
  allowance: string;
  hasOlder: boolean;
  nextBefore: number | null;
};
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export const units = (s: string | bigint | undefined) => Number(s ?? 0) / 1e6;
export const cashFormat = (s: string | bigint | undefined) =>
  units(s).toLocaleString(undefined, { maximumFractionDigits: 4 });
