// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import './MarketRoyale.sol';
interface IMakerPool is IPool {
 function mintSet(address,address,uint256) external;
 function cancelExpiredOrders(uint128[] calldata) external;
}
/// Testnet treasury liquidity. It has no access to tournament entries or player vaults.
contract LiquiditySponsor is Lock {
 IERC20 public immutable token;IModule public immutable module;address public immutable treasury;address public immutable creator;bytes32 public immutable venue;
 struct Seed {bytes32 marketId;uint128 upOrder;uint128 downOrder;bool closed;}
 Seed[] private seeds;mapping(bytes32=>bool) public seeded;
 event Seeded(bytes32 indexed marketId,uint256 amount,uint128 upOrder,uint128 downOrder);
 event Recovered(bytes32 indexed marketId,uint256 collateral);
 constructor(address t,address m,address who,address c,bytes32 v){require(block.chainid==50312&&who!=address(0),"Shannon treasury only");token=IERC20(t);module=IModule(m);treasury=who;creator=c;venue=v;}
 function count() external view returns(uint256){return seeds.length;}
 function getSeed(uint256 index) external view returns(Seed memory){return seeds[index];}
 function seed(bytes32 id,uint256 amount,uint256 bid,uint256 ask) external nonReentrant {
  require(msg.sender==treasury&&!seeded[id]&&amount>=2_000_000&&amount<=128_000_000,"Invalid seed");
  require(bid>0&&ask<1_000_000&&ask>bid&&ask-bid<=200_000,"Invalid spread");
  IModule.Market memory m=module.markets(id);require(m.collateral==address(token)&&m.creator==creator&&m.venue==venue&&m.expiry>block.timestamp+120&&IMarket(m.market).status()==1,"Invalid market");
  require(IMakerPool(m.pool).marketExpiryNs()==uint256(m.expiry)*1e9,"Recycled pool");
  require(token.transferFrom(treasury,address(this),amount),"Funding failed");require(token.approve(m.pool,amount),"Approval failed");
  IMakerPool(m.pool).mintSet(address(this),address(this),amount);require(token.approve(m.pool,0),"Reset failed");
  IOutcome outcomes=IOutcome(IMarket(m.market).outcomeToken());require(outcomes.setOperator(m.pool,true),"Operator failed");
  (bool up,uint128 a)=IMakerPool(m.pool).placeBinaryOrder(1,ask,amount,uint64(uint256(m.expiry)*1e9),3,0,address(0),0,0);
  (bool down,uint128 b)=IMakerPool(m.pool).placeBinaryOrder(3,bid,amount,uint64(uint256(m.expiry)*1e9),3,0,address(0),0,0);
  require(up&&down&&a!=0&&b!=0,"Maker orders did not rest");require(outcomes.setOperator(m.pool,false),"Reset failed");
  seeded[id]=true;seeds.push(Seed(id,a,b,false));emit Seeded(id,amount,a,b);
 }
 function recover(uint256 index) external nonReentrant {
  Seed storage s=seeds[index];require(!s.closed,"Already recovered");IModule.Market memory m=module.markets(s.marketId);
  require(block.timestamp>=m.expiry&&(IMarket(m.market).isResolved()||IMarket(m.market).isVoided()),"Settlement pending");
  // Expired orders must be drained before pool recycling; this call tolerates prior cleanup.
  uint128[] memory orders=new uint128[](2);orders[0]=s.upOrder;orders[1]=s.downOrder;
  if(IPool(m.pool).marketExpiryNs()==uint256(m.expiry)*1e9)IMakerPool(m.pool).cancelExpiredOrders(orders);
  IOutcome o=IOutcome(IMarket(m.market).outcomeToken());uint256[] memory payouts=IMarket(m.market).payoutNumerators();
  require(o.setOperator(address(module),true),"Operator failed");
  uint256 yes=o.balanceOf(address(this),m.yesId);uint256 no=o.balanceOf(address(this),m.noId);
  if(yes>0&&payouts[0]>0)module.redeem(0,bytes32(0),s.marketId,0,yes);
  if(no>0&&payouts[1]>0)module.redeem(0,bytes32(0),s.marketId,1,no);
  require(o.setOperator(address(module),false),"Reset failed");s.closed=true;
  uint256 balance=token.balanceOf(address(this));require(token.transfer(treasury,balance),"Recovery failed");emit Recovered(s.marketId,balance);
 }
}
