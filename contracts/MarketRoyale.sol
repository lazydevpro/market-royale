// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address,uint256) external returns(bool);
    function transferFrom(address,address,uint256) external returns(bool);
    function approve(address,uint256) external returns(bool);
    function decimals() external view returns(uint8);
}
interface IOutcome {
    function balanceOf(address,uint256) external view returns(uint256);
    function setOperator(address,bool) external returns(bool);
    function transfer(address,uint256,uint256) external returns(bool);
}
interface IModule {
    struct Market { uint256 question; uint8 slots; uint8 voidPolicy; address collateral; uint32 operatorId; bytes32 venue; address oracle; address creator; address market; address pool; uint256 yesId; uint256 noId; uint64 start; uint64 expiry; }
    function markets(bytes32) external view returns(Market memory);
    function redeem(uint32,bytes32,bytes32,uint8,uint256) external;
    function finalizeMarket(bytes32) external;
    function settlement() external view returns(address);
}
interface ISettlement { function isFinalized(uint256) external view returns(bool); }
interface IMarket {
    function outcomeToken() external view returns(address);
    function status() external view returns(uint8);
    function isResolved() external view returns(bool);
    function isVoided() external view returns(bool);
    function payoutNumerators() external view returns(uint256[] memory);
}
interface IPool {
    struct Level { uint256 price; uint256 quantity; }
    function getBookLevels(bool,uint64) external view returns(Level[] memory);
    function marketExpiryNs() external view returns(uint64);
    function placeBinaryOrder(uint8,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64) external returns(bool,uint128);
}
interface IArena {
    function canTrade(uint256,address) external view returns(bool);
    function canWithdraw(uint256,address) external view returns(bool);
    function recordTrade(uint256,address) external;
}
abstract contract Lock {
    uint256 private entered;
    modifier nonReentrant(){ require(entered==0,"Reentry"); entered=1; _; entered=0; }
}

/// Each entrant's only permitted strategy is IOC trading on the round's DreamDEX market.
/// Scores track transaction deltas, so unsolicited collateral/outcome donations cannot buy rank.
contract TraderVault is Lock {
    address public immutable owner;
    address public immutable arena;
    uint256 public immutable tournament;
    IERC20 public immutable token;
    IModule public immutable module;
    uint256 public cash;
    uint256 public yesShares;
    uint256 public noShares;
    uint32 public actions;
    uint64 public lifetimeActions;
    bytes32 public marketId;
    bool public settled = true;
    bool public withdrawn;
    event Trade(uint8 kind,uint256 shares,int256 cashDelta,uint256 cashAfter);
    event Settled(bytes32 indexed marketId,uint256 cashAfter);
    event Withdrawn(uint256 collateral,uint256 yes,uint256 no);
    modifier onlyArena(){require(msg.sender==arena,"Arena only");_;}
    constructor(address who,uint256 id,IERC20 collateral,IModule markets,address coordinator,uint256 startingCash){owner=who;arena=coordinator;tournament=id;token=collateral;module=markets;cash=startingCash;}
    function begin(bytes32 id) external onlyArena {require(settled&&!withdrawn,"Open position");marketId=id;actions=0;settled=false;}
    function trade(uint8 kind,uint256 price,uint256 quantity) external nonReentrant {
        require(msg.sender==owner&&IArena(arena).canTrade(tournament,owner),"Trading closed");
        require(!settled&&kind<4&&quantity>0&&price>0&&price<1_000_000,"Invalid order");
        IModule.Market memory m=module.markets(marketId);
        require(block.timestamp>=m.start&&block.timestamp<m.expiry&&IMarket(m.market).status()==1,"Market closed");
        require(IPool(m.pool).marketExpiryNs()==uint256(m.expiry)*1e9,"Recycled pool");
        IOutcome outcomes=IOutcome(IMarket(m.market).outcomeToken());
        bool buy=kind==0||kind==2; bool yes=kind<2;
        uint256 holdings=yes?yesShares:noShares;
        uint256 beforeCash=token.balanceOf(address(this));
        uint256 beforeShares=outcomes.balanceOf(address(this),yes?m.yesId:m.noId);
        if(buy){
            // Exact spending allowance is bounded by tracked cash. DreamDEX includes fees
            // in its pull; attempts exceeding the remaining bankroll revert atomically.
            require(token.approve(m.pool,cash),"Approve failed");
        }else{
            require(quantity<=holdings,"Insufficient shares");
            require(outcomes.setOperator(m.pool,true),"Operator failed");
        }
        IPool(m.pool).placeBinaryOrder(kind,price,quantity,IPool(m.pool).marketExpiryNs(),2,0,address(0),0,0);
        if(buy)require(token.approve(m.pool,0),"Reset approval failed");
        else require(outcomes.setOperator(m.pool,false),"Reset operator failed");
        uint256 afterCash=token.balanceOf(address(this));
        uint256 afterShares=outcomes.balanceOf(address(this),yes?m.yesId:m.noId);
        uint256 filled;
        if(buy){
            require(afterShares>beforeShares&&beforeCash>=afterCash,"No fill");
            filled=afterShares-beforeShares;
            require(beforeCash-afterCash<=cash,"Bankroll exceeded");
            cash-=beforeCash-afterCash; holdings+=filled;
        }else{
            require(beforeShares>afterShares&&afterCash>=beforeCash,"No fill");
            filled=beforeShares-afterShares; require(filled<=holdings,"Oversold");
            holdings-=filled;cash+=afterCash-beforeCash;
        }
        if(yes)yesShares=holdings;else noShares=holdings;
        actions++;
        lifetimeActions++;
        IArena(arena).recordTrade(tournament,owner);
        emit Trade(kind,filled,int256(afterCash)-int256(beforeCash),cash);
    }
    function settle() external onlyArena nonReentrant {
        require(!settled,"Already settled");
        IModule.Market memory m=module.markets(marketId);
        require(IMarket(m.market).isResolved()||IMarket(m.market).isVoided(),"Oracle pending");
        uint256 beforeCash=token.balanceOf(address(this));
        IOutcome outcomes=IOutcome(IMarket(m.market).outcomeToken());
        require(outcomes.setOperator(address(module),true),"Operator failed");
        uint256[] memory payouts=IMarket(m.market).payoutNumerators();
        if(yesShares>0&&payouts[0]>0)module.redeem(0,bytes32(0),marketId,0,yesShares);
        if(noShares>0&&payouts[1]>0)module.redeem(0,bytes32(0),marketId,1,noShares);
        require(outcomes.setOperator(address(module),false),"Reset operator failed");
        cash+=token.balanceOf(address(this))-beforeCash;yesShares=0;noShares=0;settled=true;
        emit Settled(marketId,cash);
    }
    function refundBeforeStart() external onlyArena nonReentrant {
        require(settled&&!withdrawn&&marketId==bytes32(0),"Already started");
        withdrawn=true;require(token.transfer(owner,cash),"Transfer failed");
        emit Withdrawn(cash,0,0);
    }
    function withdraw() external nonReentrant {
        require(!withdrawn&&IArena(arena).canWithdraw(tournament,owner),"Withdrawal locked");
        withdrawn=true;
        require(token.transfer(owner,cash),"Transfer failed");
        // A timed-out tournament returns unsettled outcome tokens to the player.
        // They retain their redemption rights in DreamDEX even if the oracle is delayed.
        if(yesShares+noShares>0){
            IModule.Market memory m=module.markets(marketId);
            IOutcome o=IOutcome(IMarket(m.market).outcomeToken());
            if(yesShares>0)require(o.transfer(owner,m.yesId,yesShares),"Yes transfer failed");
            if(noShares>0)require(o.transfer(owner,m.noId,noShares),"No transfer failed");
        }
        emit Withdrawn(cash,yesShares,noShares);
    }
}


/// Separate deployment factory keeps each contract below EIP-170's code size limit.
contract VaultFactory {
    address public immutable arena;
    constructor(){arena=msg.sender;}
    function create(address who,uint256 id,IERC20 token,IModule module,uint256 bankroll) external returns(TraderVault){
        require(msg.sender==arena,"Arena only");
        return new TraderVault(who,id,token,module,arena,bankroll);
    }
}

contract MarketRoyale is Lock {
    uint256 public constant VERSION=5;
    uint256 public constant MIN_ENTRY=1_000_000;
    uint256 public constant MAX_ENTRY=50_000_000;
    uint256 public constant MIN_BANKROLL=5_000_000;
    uint256 public constant MAX_BANKROLL=250_000_000;
    uint256 public constant TIMEOUT=15 minutes;
    uint256 public constant START_GRACE=120;
    uint256 public constant MIN_DEPTH_PER_PLAYER=1_000_000;
    IERC20 public immutable collateral;
    IModule public immutable module;
    address public immutable trustedCreator;
    bytes32 public immutable trustedVenue;
    VaultFactory public immutable vaultFactory;
    uint256 public tournamentCount;
    enum Phase { Lobby, Trading, BetweenRounds, Finished, Cancelled }
    enum CancelReason { None, LowTurnout, MissedStart, NoTrades, OracleTimeout, NextRoundTimeout, NoLiquidity, HostCancelled, Voided }
    struct Tournament {
        address host; address creator; bytes32 venue; bytes32 marketId;
        uint64 joinDeadline; uint64 expiry; uint64 updatedAt; uint64 duration;
        uint8 capacity; uint8 maxRounds; uint8 round; uint8 activeCount;
        uint8 settleCursor; Phase phase; uint256 prizePool; bool finalized;
        uint8 minPlayers; uint32 roundTrades; CancelReason cancelReason; bool scheduled;
        uint256 entryFee; uint256 bankroll;
    }
    struct Player { address wallet; address vault; bool active; uint8 eliminatedRound; uint8 rank; bool prizeClaimed; uint256 prize; }
    mapping(uint256=>Tournament) private tournaments;
    mapping(uint256=>Player[]) private entrants;
    mapping(uint256=>mapping(address=>uint256)) private playerIndex;
    event Created(uint256 indexed id,address indexed host,bytes32 indexed marketId,uint64 joinDeadline);
    event TermsSet(uint256 indexed id,uint256 entryFee,uint256 bankroll);
    event Joined(uint256 indexed id,address indexed player,address vault);
    event Left(uint256 indexed id,address indexed player,uint256 refund);
    event RoundStarted(uint256 indexed id,uint8 round,bytes32 indexed marketId);
    event RoundEnded(uint256 indexed id,uint8 round,uint8 survivors);
    event Finished(uint256 indexed id,address winner,uint256 prizePool);
    event Cancelled(uint256 indexed id,CancelReason reason);
    event PrizeClaimed(uint256 indexed id,address indexed player,uint256 amount);
    event PayoutDeferred(uint256 indexed id,address indexed player);
    constructor(address token,address markets,address creator,bytes32 venue){
        require(block.chainid==50312,"Shannon only");
        require(token.code.length>0&&markets.code.length>0&&IERC20(token).decimals()==6&&creator!=address(0),"Invalid contracts");
        collateral=IERC20(token);module=IModule(markets);trustedCreator=creator;trustedVenue=venue;
        vaultFactory=new VaultFactory();
    }
    function getTournament(uint256 id) external view returns(Tournament memory){require(id>0&&id<=tournamentCount,"Unknown royale");return tournaments[id];}
    function getPlayers(uint256 id) external view returns(Player[] memory){return entrants[id];}
    function _validMarket(bytes32 id,uint256 afterTime) internal view returns(IModule.Market memory m){
        m=module.markets(id);
        require(m.collateral==address(collateral)&&m.slots==2&&m.market.code.length>0&&m.pool.code.length>0&&m.creator==trustedCreator&&m.venue==trustedVenue,"Invalid market");
        require(m.expiry>afterTime+120&&m.start<=block.timestamp&&IMarket(m.market).status()==1,"Market not tradable");
        require(IPool(m.pool).marketExpiryNs()==uint256(m.expiry)*1e9,"Recycled pool");
    }
    function _create(uint64 deadline,uint8 capacity,uint8 rounds,uint8 minimum,uint256 entryFee,uint256 bankroll) internal returns(uint256 id){
        require(capacity>=2&&capacity<=64&&rounds>=1&&rounds<=4&&minimum>=2&&minimum<=capacity,"Invalid format");
        require(entryFee>=MIN_ENTRY&&entryFee<=MAX_ENTRY&&bankroll>=MIN_BANKROLL&&bankroll<=MAX_BANKROLL&&entryFee<=bankroll,"Invalid terms");
        require(entryFee%1_000_000==0&&bankroll%1_000_000==0,"Whole tUSDC terms");
        id=++tournamentCount;Tournament storage t=tournaments[id];
        t.host=msg.sender;t.creator=trustedCreator;t.venue=trustedVenue;t.joinDeadline=deadline;t.updatedAt=uint64(block.timestamp);
        t.capacity=capacity;t.maxRounds=rounds;t.minPlayers=minimum;t.entryFee=entryFee;t.bankroll=bankroll;
        emit TermsSet(id,entryFee,bankroll);
    }
    function create(bytes32 marketId,uint64 joinDeadline,uint8 capacity,uint8 rounds,uint256 entryFee,uint256 bankroll) external nonReentrant returns(uint256 id){
        require(joinDeadline>=block.timestamp+30&&joinDeadline<=block.timestamp+600,"Join window 30-600s");
        IModule.Market memory m=_validMarket(marketId,joinDeadline);
        id=_create(joinDeadline,capacity,rounds,2,entryFee,bankroll);Tournament storage t=tournaments[id];
        t.marketId=marketId;t.expiry=m.expiry;t.duration=m.expiry-m.start;
        emit Created(id,msg.sender,marketId,joinDeadline);
    }
    function createAndJoin(bytes32 marketId,uint64 joinDeadline,uint8 capacity,uint8 rounds,uint256 entryFee,uint256 bankroll) external nonReentrant returns(uint256 id){
        require(joinDeadline>=block.timestamp+30&&joinDeadline<=block.timestamp+600,"Join window 30-600s");
        IModule.Market memory m=_validMarket(marketId,joinDeadline);
        id=_create(joinDeadline,capacity,rounds,2,entryFee,bankroll);Tournament storage t=tournaments[id];
        t.marketId=marketId;t.expiry=m.expiry;t.duration=m.expiry-m.start;
        emit Created(id,msg.sender,marketId,joinDeadline);_join(id,msg.sender,false);
    }
    /// Advertise in advance; deposits open ten minutes before the scheduled start.
    function schedule(uint64 startTime,uint8 capacity,uint8 rounds,uint8 minimum,uint64 duration,uint256 entryFee,uint256 bankroll) external nonReentrant returns(uint256 id){
        require(startTime>=block.timestamp+60&&startTime<=block.timestamp+7 days,"Start must be 1 minute to 7 days away");
        require(duration==300||duration==900||duration==3600,"Unsupported window");
        id=_create(startTime,capacity,rounds,minimum,entryFee,bankroll);tournaments[id].duration=duration;tournaments[id].scheduled=true;
        emit Created(id,msg.sender,bytes32(0),startTime);
    }
    function scheduleAndJoin(uint64 startTime,uint8 capacity,uint8 rounds,uint8 minimum,uint64 duration,uint256 entryFee,uint256 bankroll) external nonReentrant returns(uint256 id){
        require(startTime>=block.timestamp+60&&startTime<=block.timestamp+7 days,"Start must be 1 minute to 7 days away");
        require(duration==300||duration==900||duration==3600,"Unsupported window");
        id=_create(startTime,capacity,rounds,minimum,entryFee,bankroll);tournaments[id].duration=duration;tournaments[id].scheduled=true;
        emit Created(id,msg.sender,bytes32(0),startTime);_join(id,msg.sender,false);
    }
    function join(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];
        require(id>0&&id<=tournamentCount&&t.phase==Phase.Lobby&&block.timestamp<t.joinDeadline&&block.timestamp+600>=t.joinDeadline,"Entry closed");
        _join(id,msg.sender,true);
    }
    function _join(uint256 id,address who,bool enforceWindow) internal {
        Tournament storage t=tournaments[id];
        require(id>0&&id<=tournamentCount&&t.phase==Phase.Lobby&&block.timestamp<t.joinDeadline,"Entry closed");
        if(enforceWindow)require(block.timestamp+600>=t.joinDeadline,"Entry not open");
        require(entrants[id].length<t.capacity&&playerIndex[id][who]==0,"Full or already joined");
        TraderVault vault=vaultFactory.create(who,id,collateral,module,t.bankroll);
        require(collateral.transferFrom(who,address(this),t.entryFee),"Entry transfer failed");
        require(collateral.transferFrom(who,address(vault),t.bankroll),"Bankroll transfer failed");
        entrants[id].push(Player(who,address(vault),true,0,0,false,0));
        playerIndex[id][who]=entrants[id].length;t.activeCount++;t.prizePool+=t.entryFee;
        emit Joined(id,who,address(vault));
    }
    function leave(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];uint256 pos=playerIndex[id][msg.sender];
        require(t.phase==Phase.Lobby&&block.timestamp<t.joinDeadline&&pos>0,"Cannot leave after entry closes");
        TraderVault(entrants[id][pos-1].vault).refundBeforeStart();
        // Preserve entry order for deterministic, disclosed tie-breaking.
        for(uint256 i=pos;i<entrants[id].length;i++){entrants[id][i-1]=entrants[id][i];playerIndex[id][entrants[id][i-1].wallet]=i;}
        entrants[id].pop();delete playerIndex[id][msg.sender];t.activeCount--;t.prizePool-=t.entryFee;
        require(collateral.transfer(msg.sender,t.entryFee),"Refund failed");emit Left(id,msg.sender,t.entryFee+t.bankroll);
    }
    function liquidityReady(bytes32 marketId,uint256 players,uint256 bankroll) public view returns(bool){
        IModule.Market memory m=module.markets(marketId);
        if(m.pool.code.length==0||m.collateral!=address(collateral))return false;
        IPool.Level[] memory bids=IPool(m.pool).getBookLevels(true,10);
        IPool.Level[] memory asks=IPool(m.pool).getBookLevels(false,10);
        if(bids.length==0||asks.length==0||bids[0].price==0||asks[0].price>=1_000_000||bids[0].price>=asks[0].price||asks[0].price-bids[0].price>200_000)return false;
        uint256 bidQty;uint256 askQty;
        for(uint256 i=0;i<bids.length;i++)if(bids[i].price>=bids[0].price&&bids[i].price>0)bidQty+=bids[i].quantity;
        for(uint256 i=0;i<asks.length;i++)if(asks[i].price<=asks[0].price&&asks[i].price<1_000_000)askQty+=asks[i].quantity;
        uint256 depthPerPlayer=bankroll/5;
        if(depthPerPlayer<MIN_DEPTH_PER_PLAYER)depthPerPlayer=MIN_DEPTH_PER_PLAYER;
        return bidQty>=players*depthPerPlayer&&askQty>=players*depthPerPlayer;
    }
    function _startable(uint256 id) internal view {
        Tournament storage t=tournaments[id];require(id>0&&id<=tournamentCount&&t.phase==Phase.Lobby&&block.timestamp>=t.joinDeadline&&block.timestamp<=uint256(t.joinDeadline)+START_GRACE&&entrants[id].length>=t.minPlayers,"Not ready");
    }
    function start(uint256 id) external nonReentrant {_startable(id);require(!tournaments[id].scheduled,"Select scheduled market");_start(id,tournaments[id].marketId);}
    function startScheduled(uint256 id,bytes32 marketId) external nonReentrant {_startable(id);require(tournaments[id].scheduled,"Not scheduled");_start(id,marketId);}
    function _start(uint256 id,bytes32 marketId) internal {
        IModule.Market memory m=_validMarket(marketId,block.timestamp);
        require(m.expiry-m.start==tournaments[id].duration,"Wrong duration");
        require(liquidityReady(marketId,tournaments[id].activeCount,tournaments[id].bankroll),"Insufficient two-sided liquidity");
        tournaments[id].round=1;_begin(id,marketId);
    }
    function _begin(uint256 id,bytes32 marketId) internal {
        Tournament storage t=tournaments[id];t.marketId=marketId;t.expiry=module.markets(marketId).expiry;t.updatedAt=uint64(block.timestamp);
        t.settleCursor=0;t.roundTrades=0;t.finalized=false;t.phase=Phase.Trading;
        for(uint256 i=0;i<entrants[id].length;i++)if(entrants[id][i].active)TraderVault(entrants[id][i].vault).begin(marketId);
        emit RoundStarted(id,t.round,marketId);
    }
    function nextRound(uint256 id,bytes32 marketId) external nonReentrant {
        Tournament storage t=tournaments[id];require(t.phase==Phase.BetweenRounds&&block.timestamp<=uint256(t.updatedAt)+TIMEOUT,"Not between rounds");
        IModule.Market memory m=_validMarket(marketId,block.timestamp);
        require(m.start>=t.expiry&&m.expiry-m.start==t.duration,"Wrong or old window");
        require(liquidityReady(marketId,t.activeCount,t.bankroll),"Insufficient two-sided liquidity");
        t.round++;_begin(id,marketId);
    }
    function canTrade(uint256 id,address who) external view returns(bool){uint256 i=playerIndex[id][who];Tournament storage t=tournaments[id];return i>0&&t.phase==Phase.Trading&&block.timestamp<t.expiry&&entrants[id][i-1].active;}
    function recordTrade(uint256 id,address who) external {uint256 i=playerIndex[id][who];require(i>0&&entrants[id][i-1].vault==msg.sender&&tournaments[id].phase==Phase.Trading,"Vault only");tournaments[id].roundTrades++;}
    function settleBatch(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];require(t.phase==Phase.Trading&&block.timestamp>=t.expiry,"Round open");
        if(t.roundTrades==0){_cancel(id,CancelReason.NoTrades);return;}
        IModule.Market memory m=module.markets(t.marketId);
        require(IMarket(m.market).isResolved()||IMarket(m.market).isVoided(),"Oracle pending");
        if(!t.finalized){if(!ISettlement(module.settlement()).isFinalized(m.yesId))module.finalizeMarket(t.marketId);t.finalized=true;}
        uint256 end=uint256(t.settleCursor)+4;if(end>entrants[id].length)end=entrants[id].length;
        for(uint256 i=t.settleCursor;i<end;i++)if(entrants[id][i].active)TraderVault(entrants[id][i].vault).settle();
        t.settleCursor=uint8(end);
        if(end==entrants[id].length){if(IMarket(m.market).isVoided())_cancel(id,CancelReason.Voided);else _cut(id);}
    }
    function _cut(uint256 id) internal {
        Tournament storage t=tournaments[id];Player[] storage ps=entrants[id];
        uint256[] memory order=new uint256[](t.activeCount);uint256[] memory scores=new uint256[](ps.length);uint256 n;
        for(uint256 i=0;i<ps.length;i++)if(ps[i].active){order[n++]=i;scores[i]=TraderVault(ps[i].vault).cash();}
        for(uint256 i=1;i<n;i++){uint256 v=order[i];uint256 j=i;while(j>0&&scores[order[j-1]]<scores[v]){order[j]=order[j-1];j--;}order[j]=v;}
        bool last=t.round==t.maxRounds||n<=2;uint256 keep=last?0:(n+1)/2;
        for(uint256 i=keep;i<n;i++){Player storage p=ps[order[i]];p.active=false;p.eliminatedRound=t.round;p.rank=uint8(i+1);}
        t.activeCount=uint8(keep);t.updatedAt=uint64(block.timestamp);emit RoundEnded(id,t.round,uint8(keep));
        if(last){t.phase=Phase.Finished;uint256 second;uint256 third;
            if(ps.length>=3){second=t.prizePool*30/128;third=t.prizePool*18/128;}
            for(uint256 i=0;i<ps.length;i++){if(ps[i].rank==1)ps[i].prize=t.prizePool-second-third;if(ps[i].rank==2)ps[i].prize=second;if(ps[i].rank==3)ps[i].prize=third;}
            emit Finished(id,ps[order[0]].wallet,t.prizePool);
        }else t.phase=Phase.BetweenRounds;
    }
    function _cancel(uint256 id,CancelReason reason) internal {Tournament storage t=tournaments[id];t.phase=Phase.Cancelled;t.activeCount=0;t.cancelReason=reason;emit Cancelled(id,reason);}
    function cancel(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];require(id>0&&id<=tournamentCount&&t.phase!=Phase.Finished&&t.phase!=Phase.Cancelled,"Already ended");
        if(t.phase==Phase.Lobby){
            if(block.timestamp>=t.joinDeadline&&entrants[id].length<t.minPlayers){_cancel(id,CancelReason.LowTurnout);return;}
            if(block.timestamp>uint256(t.joinDeadline)+START_GRACE){_cancel(id,CancelReason.MissedStart);return;}
            if(!t.scheduled&&block.timestamp>=t.expiry-120){_cancel(id,CancelReason.MissedStart);return;}
            if(msg.sender==t.host&&block.timestamp<t.joinDeadline){_cancel(id,CancelReason.HostCancelled);return;}
        }
        uint256 deadline=t.phase==Phase.Trading?uint256(t.expiry)+TIMEOUT:uint256(t.updatedAt)+TIMEOUT;
        require(t.phase!=Phase.Lobby&&block.timestamp>deadline,"Not timed out");
        _cancel(id,t.phase==Phase.Trading?CancelReason.OracleTimeout:CancelReason.NextRoundTimeout);
    }
    function canWithdraw(uint256 id,address who) external view returns(bool){uint256 i=playerIndex[id][who];return i>0&&(tournaments[id].phase==Phase.Cancelled||!entrants[id][i-1].active);}
    function _claim(uint256 id,address who) internal {
        Tournament storage t=tournaments[id];uint256 i=playerIndex[id][who];require(i>0&&(t.phase==Phase.Finished||t.phase==Phase.Cancelled),"Not claimable");
        Player storage p=entrants[id][i-1];require(!p.prizeClaimed,"Already claimed");p.prizeClaimed=true;
        uint256 amount=t.phase==Phase.Cancelled?t.entryFee:p.prize;
        require(collateral.transfer(who,amount),"Prize transfer failed");emit PrizeClaimed(id,who,amount);
    }
    function claimPrize(uint256 id) external nonReentrant {_claim(id,msg.sender);}
    /// Anyone may pay gas, but every transfer is pinned to the entrant's address.
    function payPlayer(uint256 id,address who) external nonReentrant {
        uint256 i=playerIndex[id][who];require(i>0,"Unknown player");Player storage p=entrants[id][i-1];Tournament storage t=tournaments[id];
        if(!TraderVault(p.vault).withdrawn())TraderVault(p.vault).withdraw();
        if(!p.prizeClaimed&&(t.phase==Phase.Finished||t.phase==Phase.Cancelled))_claim(id,who);
    }
    function payoutBatch(uint256 id,uint256 cursor,uint256 limit) external {
        require(limit>0&&limit<=8,"Batch limit 1-8");uint256 end=cursor+limit;if(end>entrants[id].length)end=entrants[id].length;
        for(uint256 i=cursor;i<end;i++){address who=entrants[id][i].wallet;try this.payPlayer(id,who){}catch{emit PayoutDeferred(id,who);}}
    }
}
