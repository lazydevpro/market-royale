import fs from 'node:fs';
import {createPublicClient,createWalletClient,http,encodeDeployData,parseEther,formatEther} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {somniaTestnet} from 'viem/chains';
const root=new URL('../',import.meta.url),path=n=>new URL(n,root);
const saved=JSON.parse(fs.readFileSync(path('.testnet/wallets.json'),'utf8'));
if(!saved[3]){const key=generatePrivateKey();saved.push({address:privateKeyToAccount(key).address,privateKey:key});fs.writeFileSync(path('.testnet/wallets.json'),JSON.stringify(saved,null,2),{mode:0o600});}
const host=privateKeyToAccount(saved[0].privateKey),keeper=privateKeyToAccount(saved[3].privateKey);
const rpc='https://dream-rpc.somnia.network',pub=createPublicClient({chain:somniaTestnet,transport:http(rpc),pollingInterval:1000}),wallet=createWalletClient({account:host,chain:somniaTestnet,transport:http(rpc)});
const TOKEN='0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E',MODULE='0x3ecC694Cef705358864a646142ac17A90E29e388',CREATOR='0x94D963B6670AB96E78C8d0C46ca35D196d606EFE',VENUE='0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c';
if(await pub.getChainId()!==50312)throw Error('Shannon only');
const file=path('deployments/shannon-v2.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{chainId:50312,version:2,host:host.address,keeper:keeper.address,transactions:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
async function confirm(hash,label){report.transactions.push({hash,label,status:'pending'});save();const r=await pub.waitForTransactionReceipt({hash,timeout:180000});Object.assign(report.transactions.at(-1),{status:r.status,gasUsed:String(r.gasUsed),block:String(r.blockNumber)});save();if(r.status!=='success')throw Error(label+' reverted');console.log(label,hash);return r;}
async function deploy(name,args,field){if(report[field])return;const artifact=JSON.parse(fs.readFileSync(path('lib/testnet/'+name+'.json'),'utf8'));const data=encodeDeployData({...artifact,args});const gas=await pub.estimateGas({account:host,data});const r=await confirm(await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode,args,gas:gas*150n/100n+100000n,gasPrice:await pub.getGasPrice()}),'Deploy '+name);report[field]=r.contractAddress;save();}
await deploy('MarketRoyale',[TOKEN,MODULE,CREATOR,VENUE],'arena');
await deploy('LiquiditySponsor',[TOKEN,MODULE,keeper.address,CREATOR,VENUE],'sponsor');
if(await pub.getBalance({address:keeper.address})<parseEther('1'))await confirm(await wallet.sendTransaction({to:keeper.address,value:parseEther('3'),gasPrice:await pub.getGasPrice()}),'Fund dedicated keeper gas');
let env=fs.existsSync(path('.env.local'))?fs.readFileSync(path('.env.local'),'utf8'):'';env=env.split('\n').filter(l=>!l.startsWith('NEXT_PUBLIC_ROYALE_ADDRESS=')&&!l.startsWith('LOCAL_TEST_WALLETS=')).join('\n');fs.writeFileSync(path('.env.local'),env+'\nNEXT_PUBLIC_ROYALE_ADDRESS='+report.arena+'\nLOCAL_TEST_WALLETS=1\n');
const config=JSON.parse(fs.readFileSync(path('workers/wrangler.jsonc'),'utf8'));config.vars.ROYALE_ADDRESS=report.arena;config.vars.LIQUIDITY_SPONSOR=report.sponsor;fs.writeFileSync(path('workers/wrangler.jsonc'),JSON.stringify(config,null,2)+'\n');fs.writeFileSync(path('workers/.dev.vars'),'KEEPER_PRIVATE_KEY="'+saved[3].privateKey+'"\n',{mode:0o600});
console.log(JSON.stringify({arena:report.arena,sponsor:report.sponsor,keeper:keeper.address,hostSTT:formatEther(await pub.getBalance({address:host.address}))}));
