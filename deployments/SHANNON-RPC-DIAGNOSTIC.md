# Shannon RPC diagnostic — 4 September 2026

Read-only probes performed at 17:31–17:32 UTC (23:01–23:02 IST), directly from Node fetch, outside the application and wallet. No transactions were submitted by these probes.

## Findings

| Endpoint | Request | Result |
| --- | --- | --- |
| https://dream-rpc.somnia.network | eth_chainId, eth_getBlockByNumber latest, eth_blockNumber | HTTP 502, HTML “The server encountered a temporary error and could not complete your request.” |
| https://api.infra.testnet.somnia.network | Same three methods | Same HTTP 502 response |
| https://50312.rpc.thirdweb.com | eth_chainId | HTTP 200; correct chain ID 0xc488 / 50312 |
| https://50312.rpc.thirdweb.com | eth_getBlockByNumber latest, 17:31:38 UTC | Block 0x1c9780f7, timestamp 17:16:56 UTC; 883 seconds old |
| https://50312.rpc.thirdweb.com | eth_getBlockByNumber latest, 17:32:25 UTC | Block 479681999 / 0x1c975dcf, timestamp 17:01:55 UTC; 1,830 seconds old |
| https://50312.rpc.thirdweb.com | eth_getCode for V2 arena, latest | HTTP 200 with JSON-RPC error -32603: “node not ready” |

V2 arena queried: `0x7c0dd0d2aea196118dbca546bdc2c6ecf541dd1e`.

The later latest-block response went backward. This is consistent with inconsistent or lagging upstream nodes/caches, but does not establish the operators' underlying cause. Thirdweb response headers reported `cf-cache-status: DYNAMIC`; that does not exclude caching inside its RPC service. HTTP Date headers agreed with the local UTC clock within approximately one second.

The official explorer's `/api/v2/stats` returned HTTP 200 and a recently updated gas-price timestamp, but its total_blocks was 478697217. Its `/api/v2/blocks?type=block` returned an August 14 block (461768128) as its first item. These inconsistent results cannot establish the live chain head. The alternative Socialscan explorer fetch failed. No confirmed current outage announcement was found in the public sources checked; absence of an announcement does not imply health.

## Application behavior

`lib/testnet/server.ts` rejects a latest block more than 90 seconds from the local clock. This produces the displayed stale-block message and pauses transaction actions. The observed blocks exceed that threshold by a wide margin. The failures happen on generic RPC calls before contract execution, so they do not indicate a Market Royale contract revert, insufficient gas, or a wallet permission problem.

The transport tries Thirdweb first, then the official endpoints on request errors. A successful but stale block response does not itself trigger provider fallback; the application rejects it afterward. This is a recovery limitation to harden, but both alternative endpoints were also failing during these probes, so changing the order would not restore service in this observation window.

Conclusion: public Shannon RPC access is degraded from this environment. A provider/backend or routing problem is likely; a chain-wide halt is unconfirmed. The two official hostnames may share infrastructure, so their failures are not independent proof of a chain-wide issue.

## Message to send Somnia / dreamDEX support

We are testing Market Royale on Shannon (chain 50312). On 4 September 2026 at 17:31–17:32 UTC, both dream-rpc.somnia.network and api.infra.testnet.somnia.network returned HTTP 502 even for eth_chainId and eth_blockNumber. Thirdweb's 50312.rpc.thirdweb.com returned the correct chain ID, but latest block timestamps were 15–30 minutes behind, and successive latest responses went backward (0x1c9780f7 to 0x1c975dcf). eth_getCode returned JSON-RPC -32603 “node not ready.” Local time matches response Date headers. These reproduce with direct HTTP calls outside our app. Is there a known Shannon node/RPC incident or maintenance? Can you confirm the current canonical head and provide a healthy Shannon RPC endpoint? Our app pauses writes on stale blocks, so we cannot finish testing settlement/refunds until reads are reliable.

## Minimal read-only reproduction

```sh
curl -i --max-time 20 https://dream-rpc.somnia.network \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

curl -i --max-time 20 https://50312.rpc.thirdweb.com \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}'
```

Official configuration reference: https://docs.somnia.network/developer/network-info

Explorer API reference: https://docs.somnia.network/developer/deployment-and-production/explorer-api-health-and-monitoring
