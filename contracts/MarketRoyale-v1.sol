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
    function marketExpiryNs() external view returns(uint64);
    function placeBinaryOrder(uint8,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64) external returns(bool,uint128);
}
interface IArena {
    function canTrade(uint256,address) external view returns(bool);
    function canWithdraw(uint256,address) external view returns(bool);
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
    uint256 public cash = 10_000_000;
    uint256 public yesShares;
    uint256 public noShares;
    uint8 public actions;
    bytes32 public marketId;
    bool public settled = true;
    bool public withdrawn;
    event Trade(uint8 kind,uint256 shares,int256 cashDelta,uint256 cashAfter);
    event Settled(bytes32 indexed marketId,uint256 cashAfter);
    event Withdrawn(uint256 collateral,uint256 yes,uint256 no);
    modifier onlyArena(){require(msg.sender==arena,"Arena only");_;}
    constructor(address who,uint256 id,IERC20 collateral,IModule markets){owner=who;arena=msg.sender;tournament=id;token=collateral;module=markets;}
    function begin(bytes32 id) external onlyArena {require(settled&&!withdrawn,"Open position");marketId=id;actions=0;settled=false;}
    function trade(uint8 kind,uint256 price,uint256 quantity) external nonReentrant {
        require(msg.sender==owner&&IArena(arena).canTrade(tournament,owner),"Trading closed");
        require(!settled&&actions<3&&kind<4&&quantity>0&&price>0&&price<1_000_000,"Invalid order");
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
            require(beforeCash-afterCash<=cash&&beforeCash-afterCash<=10_000_000,"Bankroll exceeded");
            cash-=beforeCash-afterCash; holdings+=filled;
        }else{
            require(beforeShares>afterShares&&afterCash>=beforeCash,"No fill");
            filled=beforeShares-afterShares; require(filled<=holdings,"Oversold");
            holdings-=filled;cash+=afterCash-beforeCash;
        }
        if(yes)yesShares=holdings;else noShares=holdings;
        actions++;
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
    function withdraw() external nonReentrant {
        require(msg.sender==owner&&!withdrawn&&IArena(arena).canWithdraw(tournament,owner),"Withdrawal locked");
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

/// Immutable, permissionless tournament coordination. Deployment is Shannon-only.
contract MarketRoyale is Lock {
    uint256 public constant VERSION=1;
    uint256 public constant ENTRY=2_000_000;
    uint256 public constant BANKROLL=10_000_000;
    uint256 public constant TIMEOUT=1 days;
    IERC20 public immutable collateral;
    IModule public immutable module;
    uint256 public tournamentCount;
    enum Phase { Lobby, Trading, BetweenRounds, Finished, Cancelled }
    struct Tournament {
        address host; address creator; bytes32 venue; bytes32 marketId;
        uint64 joinDeadline; uint64 expiry; uint64 updatedAt; uint64 duration;
        uint8 capacity; uint8 maxRounds; uint8 round; uint8 activeCount;
        uint8 settleCursor; Phase phase; uint256 prizePool; bool finalized;
    }
    struct Player { address wallet; address vault; bool active; uint8 eliminatedRound; uint8 rank; bool prizeClaimed; uint256 prize; }
    mapping(uint256=>Tournament) private tournaments;
    mapping(uint256=>Player[]) private entrants;
    mapping(uint256=>mapping(address=>uint256)) private playerIndex;
    event Created(uint256 indexed id,address indexed host,bytes32 indexed marketId,uint64 joinDeadline);
    event Joined(uint256 indexed id,address indexed player,address vault);
    event RoundStarted(uint256 indexed id,uint8 round,bytes32 indexed marketId);
    event RoundEnded(uint256 indexed id,uint8 round,uint8 survivors);
    event Finished(uint256 indexed id,address winner,uint256 prizePool);
    event Cancelled(uint256 indexed id);
    event PrizeClaimed(uint256 indexed id,address indexed player,uint256 amount);
    constructor(address token,address markets){
        require(block.chainid==50312,"Shannon only");
        require(token.code.length>0&&markets.code.length>0&&IERC20(token).decimals()==6,"Invalid contracts");
        collateral=IERC20(token);module=IModule(markets);
    }
    function getTournament(uint256 id) external view returns(Tournament memory){require(id>0&&id<=tournamentCount,"Unknown royale");return tournaments[id];}
    function getPlayers(uint256 id) external view returns(Player[] memory){return entrants[id];}
    function _validMarket(bytes32 id,uint256 afterTime) internal view returns(IModule.Market memory m){
        m=module.markets(id);
        require(m.collateral==address(collateral)&&m.slots==2&&m.market.code.length>0&&m.pool.code.length>0,"Invalid market");
        require(m.expiry>afterTime+120&&m.start<=block.timestamp&&IMarket(m.market).status()==1,"Market not tradable");
        require(IPool(m.pool).marketExpiryNs()==uint256(m.expiry)*1e9,"Recycled pool");
    }
    function create(bytes32 marketId,uint64 joinDeadline,uint8 capacity,uint8 rounds) external nonReentrant returns(uint256 id){
        require(joinDeadline>=block.timestamp+30&&joinDeadline<=block.timestamp+600,"Join window 30-600s");
        require(capacity>=2&&capacity<=64&&rounds>=1&&rounds<=4,"Invalid format");
        IModule.Market memory m=_validMarket(marketId,joinDeadline);
        id=++tournamentCount;
        tournaments[id]=Tournament(msg.sender,m.creator,m.venue,marketId,joinDeadline,m.expiry,uint64(block.timestamp),m.expiry-m.start,capacity,rounds,0,0,0,Phase.Lobby,0,false);
        emit Created(id,msg.sender,marketId,joinDeadline);
    }
    function join(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];
        require(id>0&&id<=tournamentCount&&t.phase==Phase.Lobby&&block.timestamp<t.joinDeadline,"Entry closed");
        require(entrants[id].length<t.capacity&&playerIndex[id][msg.sender]==0,"Full or already joined");
        TraderVault vault=new TraderVault(msg.sender,id,collateral,module);
        require(collateral.transferFrom(msg.sender,address(this),ENTRY),"Entry transfer failed");
        require(collateral.transferFrom(msg.sender,address(vault),BANKROLL),"Bankroll transfer failed");
        entrants[id].push(Player(msg.sender,address(vault),true,0,0,false,0));
        playerIndex[id][msg.sender]=entrants[id].length;t.activeCount++;t.prizePool+=ENTRY;
        emit Joined(id,msg.sender,address(vault));
    }
    function start(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];
        require(t.phase==Phase.Lobby&&block.timestamp>=t.joinDeadline&&entrants[id].length>=2,"Not ready");
        _validMarket(t.marketId,block.timestamp); t.round=1;_begin(id,t.marketId);
    }
    function _begin(uint256 id,bytes32 marketId) internal {
        Tournament storage t=tournaments[id];
        t.marketId=marketId;t.expiry=module.markets(marketId).expiry;t.updatedAt=uint64(block.timestamp);t.settleCursor=0;t.finalized=false;t.phase=Phase.Trading;
        for(uint256 i=0;i<entrants[id].length;i++)if(entrants[id][i].active)TraderVault(entrants[id][i].vault).begin(marketId);
        emit RoundStarted(id,t.round,marketId);
    }
    function nextRound(uint256 id,bytes32 marketId) external nonReentrant {
        Tournament storage t=tournaments[id];require(t.phase==Phase.BetweenRounds&&block.timestamp<=uint256(t.updatedAt)+TIMEOUT,"Not between rounds");
        IModule.Market memory m=_validMarket(marketId,block.timestamp);
        require(m.creator==t.creator&&m.venue==t.venue&&m.start>=t.expiry&&m.expiry-m.start==t.duration,"Different series or old window");
        t.round++;_begin(id,marketId);
    }
    function canTrade(uint256 id,address who) external view returns(bool){
        uint256 i=playerIndex[id][who];Tournament storage t=tournaments[id];
        return i>0&&t.phase==Phase.Trading&&block.timestamp<t.expiry&&entrants[id][i-1].active;
    }
    function settleBatch(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];require(t.phase==Phase.Trading&&block.timestamp>=t.expiry,"Round open");
        IModule.Market memory m=module.markets(t.marketId);
        require(IMarket(m.market).isResolved()||IMarket(m.market).isVoided(),"Oracle pending");
        if(!t.finalized){if(!ISettlement(module.settlement()).isFinalized(m.yesId))module.finalizeMarket(t.marketId);t.finalized=true;}
        uint256 end=uint256(t.settleCursor)+4;if(end>entrants[id].length)end=entrants[id].length;
        for(uint256 i=t.settleCursor;i<end;i++)if(entrants[id][i].active)TraderVault(entrants[id][i].vault).settle();
        t.settleCursor=uint8(end);
        // Do not extend timeout on each batch: a stalled participant cannot lock others indefinitely.
        if(end==entrants[id].length)_cut(id);
    }
    function _cut(uint256 id) internal {
        Tournament storage t=tournaments[id];Player[] storage ps=entrants[id];
        uint256[] memory order=new uint256[](t.activeCount);uint256 n;
        for(uint256 i=0;i<ps.length;i++)if(ps[i].active)order[n++]=i;
        for(uint256 i=1;i<n;i++){
            uint256 v=order[i];uint256 j=i;uint256 score=TraderVault(ps[v].vault).cash();
            while(j>0&&TraderVault(ps[order[j-1]].vault).cash()<score){order[j]=order[j-1];j--;}order[j]=v;
        }
        bool last=t.round==t.maxRounds||n<=2;
        uint256 keep=last?0:(n+1)/2;
        for(uint256 i=keep;i<n;i++){Player storage p=ps[order[i]];p.active=false;p.eliminatedRound=t.round;p.rank=uint8(i+1);}
        t.activeCount=uint8(keep);t.updatedAt=uint64(block.timestamp);
        emit RoundEnded(id,t.round,uint8(keep));
        if(last){
            t.phase=Phase.Finished;
            // Ranks assigned at each cut remain globally unique (e.g. 5-8, 3-4, 1-2).
            uint256 second;uint256 third;
            if(ps.length>=3){second=t.prizePool*30/128;third=t.prizePool*18/128;}
            for(uint256 i=0;i<ps.length;i++){
                if(ps[i].rank==1)ps[i].prize=t.prizePool-second-third;
                if(ps[i].rank==2)ps[i].prize=second;
                if(ps[i].rank==3)ps[i].prize=third;
            }
            emit Finished(id,ps[order[0]].wallet,t.prizePool);
        }else t.phase=Phase.BetweenRounds;
    }
    function cancel(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];require(id>0&&id<=tournamentCount&&t.phase!=Phase.Finished&&t.phase!=Phase.Cancelled,"Already ended");
        bool missedStart=t.phase==Phase.Lobby&&(block.timestamp>=t.expiry-120||(block.timestamp>=t.joinDeadline&&entrants[id].length<2));
        uint256 deadline=t.phase==Phase.Trading?uint256(t.expiry)+TIMEOUT:uint256(t.updatedAt)+TIMEOUT;
        require(missedStart||block.timestamp>deadline,"Not timed out");
        t.phase=Phase.Cancelled;emit Cancelled(id);
    }
    function canWithdraw(uint256 id,address who) external view returns(bool){
        uint256 i=playerIndex[id][who];if(i==0)return false;
        return tournaments[id].phase==Phase.Cancelled||!entrants[id][i-1].active;
    }
    function claimPrize(uint256 id) external nonReentrant {
        Tournament storage t=tournaments[id];uint256 i=playerIndex[id][msg.sender];
        require(i>0&&(t.phase==Phase.Finished||t.phase==Phase.Cancelled),"Not claimable");
        Player storage p=entrants[id][i-1];require(!p.prizeClaimed,"Already claimed");p.prizeClaimed=true;
        uint256 amount=t.phase==Phase.Cancelled?ENTRY:p.prize;
        require(collateral.transfer(msg.sender,amount),"Prize transfer failed");emit PrizeClaimed(id,msg.sender,amount);
    }
}
