import fs from 'node:fs';
import {createPublicClient,createWalletClient,http,decodeEventLog,parseAbi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';import {somniaTestnet} from 'viem/chains';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root),'utf8'));
const deployment=read('deployments/shannon-v2.json'),arena=read('lib/testnet/MarketRoyale.json'),vault=read('lib/testnet/TraderVault.json');
const accounts=read('.testnet/wallets.json').map(w=>privateKeyToAccount(w.privateKey));const pub=createPublicClient({chain:somniaTestnet,transport:http('https://dream-rpc.somnia.network'),pollingInterval:1000});
const TOKEN='0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E',tokenAbi=parseAbi(['function faucet(uint256)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)']);
const reportFile=new URL('deployments/v2-edge-cases.json',root),report=fs.existsSync(reportFile)?read('deployments/v2-edge-cases.json'):{transactions:[],cases:[]};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
async function send(i,address,abi,fn,args){const account=accounts[i],wallet=createWalletClient({account,chain:somniaTestnet,transport:http('https://dream-rpc.somnia.network')});const p={account,address,abi,functionName:fn,args};const {request}=await pub.simulateContract(p);const gas=await pub.estimateContractGas(p);const hash=await wallet.writeContract({...request,gas:gas*150n/100n+100000n,gasPrice:await pub.getGasPrice()});report.transactions.push({hash,fn,status:'pending'});save();const r=await pub.waitForTransactionReceipt({hash});report.transactions.at(-1).status=r.status;save();if(r.status!=='success')throw Error(fn+' reverted');console.log(fn,hash);return r;}
if(process.argv[2]==='fund'){await send(2,TOKEN,tokenAbi,'faucet',[100_000_000n]);process.exit(0);}
for(const [name,entrants] of [['zero-turnout',[]],['one-player',[0]],['no-trades',[0,1]]]){
 if(report.cases.some(c=>c.name===name))continue;
 const receipt=await send(0,deployment.arena,arena.abi,'schedule',[(await pub.getBlock()).timestamp+150n,8,1,2,300n]);
 let id;for(const log of receipt.logs){try{const e=decodeEventLog({abi:arena.abi,data:log.data,topics:log.topics});if(e.eventName==='Created')id=Number(e.args.id);}catch{}}
 report.cases.push({name,id,expectedReason:name==='no-trades'?3:1});save();
 for(const i of entrants){await send(i,TOKEN,tokenAbi,'faucet',[50_000_000n]);await send(i,TOKEN,tokenAbi,'approve',[deployment.arena,12_000_000n]);await send(i,deployment.arena,arena.abi,'join',[BigInt(id)]);}
}
