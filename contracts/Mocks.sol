// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import './MarketRoyale.sol';
contract MockToken is IERC20 {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function decimals() external pure returns(uint8){return 6;}
    function faucet(uint256 n) external {balanceOf[msg.sender]+=n;}
    function approve(address to,uint256 n) external returns(bool){allowance[msg.sender][to]=n;return true;}
    function transfer(address to,uint256 n) external returns(bool){require(balanceOf[msg.sender]>=n,"balance");balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;}
    function transferFrom(address from,address to,uint256 n) external returns(bool){require(balanceOf[from]>=n&&allowance[from][msg.sender]>=n,"balance/allowance");allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}
contract MockOutcome is IOutcome {
    mapping(address=>mapping(uint256=>uint256)) public balanceOf;
    mapping(address=>mapping(address=>bool)) public operators;
    function setOperator(address a,bool b) external returns(bool){operators[msg.sender][a]=b;return true;}
    function transfer(address to,uint256 id,uint256 n) external returns(bool){_move(msg.sender,to,id,n);return true;}
    function transferFrom(address from,address to,uint256 id,uint256 n) external {require(operators[from][msg.sender],"operator");_move(from,to,id,n);}
    function _move(address from,address to,uint256 id,uint256 n) internal {require(balanceOf[from][id]>=n,"shares");balanceOf[from][id]-=n;balanceOf[to][id]+=n;}
    function mint(address to,uint256 id,uint256 n) external {balanceOf[to][id]+=n;}
    function burn(address from,uint256 id,uint256 n) external {require(operators[from][msg.sender],"operator");require(balanceOf[from][id]>=n,"shares");balanceOf[from][id]-=n;}
}
contract MockMarket {
    address public outcomeToken;
    uint8 public status=1;bool public isResolved;bool public isVoided;
    uint256[] public payouts;
    constructor(address o){outcomeToken=o;payouts.push(0);payouts.push(0);}
    function payoutNumerators() external view returns(uint256[] memory){return payouts;}
    function resolve(uint8 winner) external {status=4;isResolved=true;payouts[winner]=1;}
    function makeVoid() external {status=5;isVoided=true;payouts[0]=1;payouts[1]=1;}
}
contract MockPool {
    MockToken public token;MockOutcome public outcomes;
    uint64 public marketExpiryNs;uint256 public yesId;bool public liquidity=true;
    constructor(address t,address o,uint64 expiry,uint256 yes){token=MockToken(t);outcomes=MockOutcome(o);marketExpiryNs=expiry*1e9;yesId=yes;}
    function getBookLevels(bool bid,uint64) external view returns(IPool.Level[] memory levels){if(!liquidity)return new IPool.Level[](0);levels=new IPool.Level[](1);levels[0]=IPool.Level(bid?450000:550000,200_000_000);}
    function setLiquidity(bool l) external {liquidity=l;}
    function recycle(uint64 expiry) external {marketExpiryNs=expiry*1e9;}
    struct Resting {address owner;uint256 outcomeId;uint256 quantity;}
    mapping(uint128=>Resting) public orders; uint128 private nextOrder;
    function mintSet(address yesTo,address noTo,uint256 amount) external {require(token.transferFrom(msg.sender,address(this),amount));outcomes.mint(yesTo,yesId,amount);outcomes.mint(noTo,yesId+1,amount);}
    function cancelExpiredOrders(uint128[] calldata ids) external {require(block.timestamp>=marketExpiryNs/1e9,"Not expired");for(uint256 i;i<ids.length;i++){Resting storage r=orders[ids[i]];if(r.quantity>0){uint256 q=r.quantity;r.quantity=0;outcomes.transfer(r.owner,r.outcomeId,q);}}}
    function placeBinaryOrder(uint8 kind,uint256 price,uint256 quantity,uint64,uint8 orderType,uint8,address,uint96,uint64) external returns(bool,uint128){
        if(orderType==3){if(!liquidity)return(false,0);require(kind==1||kind==3,"Sell only");uint256 outcomeId=kind==1?yesId:yesId+1;outcomes.transferFrom(msg.sender,address(this),outcomeId,quantity);uint128 order=++nextOrder;orders[order]=Resting(msg.sender,outcomeId,quantity);return(true,order);}
        require(orderType==2,"IOC only");if(!liquidity)return(false,0);
        bool yes=kind<2;bool buy=kind==0||kind==2;uint256 id=yes?yesId:yesId+1;
        uint256 cost=quantity*(yes?price:1_000_000-price)/1_000_000;
        if(buy){require(token.transferFrom(msg.sender,address(this),cost));outcomes.mint(msg.sender,id,quantity);}
        else{outcomes.transferFrom(msg.sender,address(this),id,quantity);require(token.transfer(msg.sender,cost));}
        return(true,0);
    }
}
contract MockModule is IModule {
    mapping(bytes32=>Market) private records;MockToken public token;MockOutcome public outcomes;
    mapping(uint256=>bool) public isFinalized;
    constructor(address t,address o){token=MockToken(t);outcomes=MockOutcome(o);}
    function settlement() external view returns(address){return address(this);}
    function markets(bytes32 id) external view returns(Market memory){return records[id];}
    function add(bytes32 id,address m,address p,uint256 yes,uint64 start,uint64 expiry) external {records[id]=Market(1,2,0,address(token),0,bytes32(0),address(this),address(this),m,p,yes,yes+1,start,expiry);}
    function finalizeMarket(bytes32 id) external {Market memory m=records[id];require(MockMarket(m.market).isResolved()||MockMarket(m.market).isVoided());require(!isFinalized[m.yesId],"Already finalized");isFinalized[m.yesId]=true;}
    function redeem(uint32,bytes32,bytes32 id,uint8 side,uint256 amount) external {
        Market memory m=records[id];require(isFinalized[m.yesId],"Not finalized");uint256[] memory pay=MockMarket(m.market).payoutNumerators();
        require(pay[side]>0,"Losing side");outcomes.burn(msg.sender,side==0?m.yesId:m.noId,amount);
        require(token.transfer(msg.sender,amount*pay[side]/(pay[0]+pay[1])));
    }
}
