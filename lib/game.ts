export type Side = 'UP' | 'DOWN';
export type Position = { side: Side; quote: number; cost: number; shares: number };
export type Racer = { id: string; name: string; score: number; active: boolean; color: string };
export type Match = { id: string; name: string; entry: number; pool: number; capacity: number; joined: number; duration: number; asset: string; color: string };
export type Result = { id: string; match: string; rank: number; players: number; pnl: number; reward: number; date: string; entry: number };
export const MATCHES: Match[] = [
 {id:'royale',name:'LIVE ROYALE',entry:2,pool:128,capacity:64,joined:46,duration:15,asset:'BTC',color:'blue'},
 {id:'duel',name:'1v1 DUEL',entry:2,pool:4,capacity:2,joined:1,duration:15,asset:'BTC',color:'purple'},
 {id:'32player',name:'32 PLAYER',entry:2,pool:64,capacity:32,joined:24,duration:30,asset:'ETH',color:'orange'},
 {id:'practice',name:'PRACTICE',entry:0,pool:0,capacity:64,joined:46,duration:15,asset:'BTC',color:'blue'},
];
const NAMES=['NEO','KAI','FOX','MIKA','REX','LUNA','ZED','RAY','MARS','JAX','NOVA','ACE','PIXEL','BLAZE','ONYX','ECHO'];
export const money = (value: number, digits=2) => value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
export const signed = (value: number) => `${value>=0?'+':'−'}${money(Math.abs(value))}`;
export function makeRacers(name: string,count=64): Racer[] { return [{id:'you',name,score:0,active:true,color:'purple'},...Array.from({length:count-1},(_,i)=>({id:`r${i}`,name:NAMES[i%NAMES.length]+(i>=NAMES.length?` ${Math.floor(i/NAMES.length)+1}`:''),score:0,active:true,color:['blue','purple','orange'][i%3]}))]; }
export function rankRacers(racers: Racer[]) { return [...racers].sort((a,b)=>Number(b.active)-Number(a.active)||b.score-a.score||a.id.localeCompare(b.id)); }
export function applyCut(racers: Racer[],survivors:number) { const keep=new Set(rankRacers(racers).filter(r=>r.active).slice(0,survivors).map(r=>r.id)); return racers.map(r=>({...r,active:keep.has(r.id)})); }
export function quoteFor(side: Side,up:number) { return side==='UP'?up:1-up; }
export function positionValue(position:Position|null,up:number) { return position?position.shares*quoteFor(position.side,up):0; }
export function payout(pool:number,rank:number,count:number) { if(count===2)return rank===1?pool:0; return pool*([.625,.234375,.140625][rank-1]??0); }
export type Game = { id:string; match:Match; phase:'lobby'|'playing'|'round'|'eliminated'|'finished'; round:number; totalRounds:number; remaining:number; tick:number; price:number; opening:number; up:number; prices:number[]; cash:number; position:Position|null; racers:Racer[]; actions:number; log:string[]; error:string; finalRank:number|null; spectating:boolean; exhibition?:boolean; finalStandings?:Racer[] };
export type Action = {type:'tick'}|{type:'start'}|{type:'settle'}|{type:'next'}|{type:'spectate'}|{type:'buy';side:Side;amount:number;cap:number}|{type:'exit'}|{type:'clear-error'};
export function createGame(match:Match,name:string,id:string):Game { const price=match.asset==='BTC'?67432.8:3512.4; return {id,match,phase:'lobby',round:1,totalRounds:match.capacity===2?1:4,remaining:10,tick:0,price,opening:price,up:.54,prices:[price],cash:10,position:null,racers:makeRacers(name,match.capacity),actions:3,log:['Demo entry confirmed. Your seat is locked.'],error:'',finalRank:null,spectating:false}; }
export function gameReducer(g:Game,a:Action):Game {
 if(a.type==='clear-error')return {...g,error:''};
 if(a.type==='start'&&g.phase==='lobby')return {...g,phase:'playing',remaining:30};
 if(a.type==='next'&&g.phase==='round')return {...g,phase:'playing',round:g.round+1,remaining:30,opening:g.price,up:.54,actions:3,error:''};
 if(a.type==='spectate'&&g.phase==='eliminated')return {...g,phase:'round',spectating:true};
 if(a.type==='buy') {
  if(g.phase!=='playing'||g.spectating)return g;
  if(g.position)return {...g,error:'Exit your current position before placing another order.'};
  if(g.actions===0)return {...g,error:'No actions left this round. Your position settles at the cut.'};
  if(!Number.isFinite(a.amount)||a.amount<=0||a.amount>Math.min(g.cash,a.cap,10))return {...g,error:'Enter an amount within your available bankroll and exposure limit.'};
  const quote=quoteFor(a.side,g.up);
  return {...g,cash:g.cash-a.amount,position:{side:a.side,quote,cost:a.amount,shares:a.amount/quote},actions:g.actions-1,error:'',log:[`Bought ${money(a.amount/quote)} ${a.side} shares for ${money(a.amount)} USDso.`,...g.log]};
 }
 if(a.type==='exit') {
  if(g.phase!=='playing'||!g.position||g.spectating)return g;
  if(g.actions===0)return {...g,error:'No actions left. Your position settles automatically at the cut.'};
  const value=positionValue(g.position,g.up);
  return {...g,cash:g.cash+value,position:null,actions:g.actions-1,error:'',log:[`Exited ${g.position.side}: ${signed(value-g.position.cost)} USDso.`,...g.log]};
 }
 if(a.type==='tick') {
  if(g.phase==='lobby')return g.remaining<=1?{...g,phase:'playing',remaining:30}:{...g,remaining:g.remaining-1};
  if(g.phase!=='playing')return g;
  if(g.remaining<=1)return gameReducer(g,{type:'settle'});
  const tick=g.tick+1;
  const price=g.price+g.opening*(Math.sin(tick*.79)*.0009+Math.cos(tick*.31)*.0006);
  const up=Math.max(.08,Math.min(.92,.5+(price-g.opening)/g.opening*100));
  const score=(g.cash+positionValue(g.position,up)-10)*10;
  const racers=g.racers.map((r,i)=>!r.active?r:{...r,score:r.id==='you'?score:r.score+Math.sin(tick*.4+i)*.42+Math.cos(i*1.8)*.12});
  return {...g,tick,remaining:g.remaining-1,price,up,prices:[...g.prices.slice(-49),price],racers};
 }
 if(a.type==='settle'&&g.phase==='playing') {
  const won=g.position && (g.position.side==='UP'?g.price>=g.opening:g.price<g.opening);
  const cash=g.cash+(g.position?(won?g.position.shares:0):0);
  const racers=g.racers.map(r=>r.id==='you'&&!g.spectating?{...r,score:(cash-10)*10}:r);
  const rank=g.finalRank??rankRacers(racers).findIndex(r=>r.id==='you')+1;
  const last=g.round===g.totalRounds;
  const cut=last?1:Math.ceil(racers.filter(r=>r.active).length/2);
  const next=applyCut(racers,cut);
  const survived=next.find(r=>r.id==='you')!.active;
  return {...g,cash,position:null,racers:next,finalStandings:last?rankRacers(racers):g.finalStandings,remaining:0,error:'',phase:last?'finished':survived||g.spectating?'round':'eliminated',finalRank:!survived||last?rank:g.finalRank,log:[`Round ${g.round} settled. ${cut} ${cut===1?'champion':'players remain'}.`,...g.log]};
 }
 return g;
}
