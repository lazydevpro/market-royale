import { isAddress, type Abi, type Address } from "viem";
import { head, scopedClient } from "../../../../lib/testnet/server";
import { PROGRESSION } from "../../../../lib/testnet/config";
import artifact from "../../../../lib/testnet/MarketRoyaleProgression.json";

export const dynamic = "force-dynamic";
const abi = artifact.abi as Abi;
type ProfileResult = {
  rating: number;
  careerXp: number;
  completed: number;
  wins: number;
  podiums: number;
  topHalfFinishes: number;
  survivals: number;
  protectedGames: number;
};
type PreviewResult = readonly [
  boolean,
  number,
  bigint,
  number,
  bigint,
  number,
  number,
  boolean,
  bigint,
];
const serial = <T>(value: unknown): T =>
  JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );

export async function GET(request: Request) {
  try {
    const client = scopedClient();
    await head(client);
    if (!PROGRESSION || !isAddress(PROGRESSION))
      return Response.json(
        { configured: false },
        { headers: { "Cache-Control": "no-store" } },
      );
    const query = new URL(request.url).searchParams;
    const rawAccount = query.get("account");
    const account =
      rawAccount && isAddress(rawAccount) ? (rawAccount as Address) : null;
    const match = Number(query.get("match") ?? 0);
    if (!Number.isSafeInteger(match) || match < 0)
      throw new Error("Invalid match number");

    const [version, season, seasonEnds, reserve] = await Promise.all([
      client.readContract({
        address: PROGRESSION,
        abi,
        functionName: "VERSION",
      }),
      client.readContract({
        address: PROGRESSION,
        abi,
        functionName: "currentSeason",
      }),
      client.readContract({
        address: PROGRESSION,
        abi,
        functionName: "seasonEnds",
      }),
      client.readContract({
        address: PROGRESSION,
        abi,
        functionName: "sponsorReserve",
      }),
    ]);
    if (!account)
      return Response.json(
        serial({
          configured: true,
          address: PROGRESSION,
          version,
          season,
          seasonEnds,
          reserve,
          profile: null,
          badges: [],
          preview: null,
        }),
        { headers: { "Cache-Control": "no-store" } },
      );

    const badgeIds = Array.from({ length: 8 }, (_, index) => BigInt(index + 1));
    const [profile, xp, level, league, verified, badges, rawPreview] =
      await Promise.all([
        client.readContract({
          address: PROGRESSION,
          abi,
          functionName: "profileOf",
          args: [account],
        }),
        client.readContract({
          address: PROGRESSION,
          abi,
          functionName: "seasonXp",
          args: [season, account],
        }),
        client.readContract({
          address: PROGRESSION,
          abi,
          functionName: "levelOf",
          args: [account],
        }),
        client.readContract({
          address: PROGRESSION,
          abi,
          functionName: "leagueOf",
          args: [account],
        }),
        client.readContract({
          address: PROGRESSION,
          abi,
          functionName: "verifiedForProtection",
          args: [account],
        }),
        client.readContract({
          address: PROGRESSION,
          abi,
          functionName: "balanceOfBatch",
          args: [badgeIds.map(() => account), badgeIds],
        }),
        match > 0
          ? client
              .readContract({
                address: PROGRESSION,
                abi,
                functionName: "preview",
                args: [BigInt(match), account],
              })
              .catch(() => null)
          : Promise.resolve(null),
      ]);
    const playerProfile = profile as unknown as ProfileResult;
    const preview = rawPreview as unknown as PreviewResult | null;
    return Response.json(
      serial({
        configured: true,
        address: PROGRESSION,
        version,
        season,
        seasonEnds,
        reserve,
        profile: { ...playerProfile, seasonXp: xp, level, league, verified },
        badges,
        preview: preview
          ? {
              canRecord: preview[0],
              rank: preview[1],
              playerCount: preview[2],
              actions: preview[3],
              finalCash: preview[4],
              delta: preview[5],
              xp: preview[6],
              protectionAvailable: preview[7],
              protectionAmount: preview[8],
            }
          : null,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Progression read:",
      error instanceof Error ? error.message : error,
    );
    return Response.json(
      {
        error: "Unable to verify player progression on Shannon. Retry shortly.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
