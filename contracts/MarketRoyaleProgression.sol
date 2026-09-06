// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IProgressionToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address,uint256) external returns (bool);
    function transferFrom(address,address,uint256) external returns (bool);
}

interface IProgressionVault {
    function actions() external view returns (uint32);
    function cash() external view returns (uint256);
}

interface IProgressionArena {
    struct Tournament {
        address host; address creator; bytes32 venue; bytes32 marketId;
        uint64 joinDeadline; uint64 expiry; uint64 updatedAt; uint64 duration;
        uint8 capacity; uint8 maxRounds; uint8 round; uint8 activeCount;
        uint8 settleCursor; uint8 phase; uint256 prizePool; bool finalized;
        uint8 minPlayers; uint32 roundTrades; uint8 cancelReason; bool scheduled;
        uint256 entryFee; uint256 bankroll;
    }
    struct Player {
        address wallet; address vault; bool active; uint8 eliminatedRound;
        uint8 rank; bool prizeClaimed; uint256 prize;
    }
    function getTournament(uint256) external view returns (Tournament memory);
    function getPlayers(uint256) external view returns (Player[] memory);
}

/// On-chain, non-transferable progression for completed Market Royale events.
/// Results remain permissionless to record, but every badge and statistic is pinned
/// to the player found in the arena. Sponsor protection uses a separate reserve.
contract MarketRoyaleProgression {
    uint256 public constant VERSION = 4;
    uint256 public constant MAX_REBATE = 1_000_000;
    uint8 public constant MAX_PROTECTED_GAMES = 3;

    uint256 public constant BADGE_DEBUT = 1;
    uint256 public constant BADGE_TOP_HALF = 2;
    uint256 public constant BADGE_THREE_SURVIVALS = 3;
    uint256 public constant BADGE_PODIUM = 4;
    uint256 public constant BADGE_CHAMPION = 5;
    uint256 public constant BADGE_VETERAN = 6;
    uint256 public constant BADGE_PROFITABLE = 7;
    uint256 public constant BADGE_SEASON_PASS = 8;

    IProgressionArena public immutable arena;
    IProgressionToken public immutable collateral;
    address public immutable owner;
    uint32 public currentSeason = 1;
    uint64 public seasonEnds;
    uint256 private entered;

    struct Profile {
        uint32 rating;
        uint32 careerXp;
        uint16 completed;
        uint16 wins;
        uint16 podiums;
        uint16 topHalfFinishes;
        uint16 survivals;
        uint8 protectedGames;
    }

    mapping(address => Profile) private profiles;
    mapping(uint32 => uint64) public seasonStartedAt;
    mapping(uint32 => uint64) public seasonEndedAt;
    mapping(uint32 => mapping(address => uint32)) public seasonXp;
    mapping(uint256 => mapping(address => bool)) public resultRecorded;
    mapping(uint256 => mapping(address => bool)) public rebateClaimed;
    mapping(address => bool) public verifiedForProtection;
    mapping(address => mapping(uint256 => uint256)) private badgeBalances;
    mapping(uint256 => uint256) public badgeSupply;

    event ResultRecorded(
        uint256 indexed royale,
        address indexed player,
        uint8 rank,
        int32 ratingDelta,
        uint32 xp,
        uint8 league
    );
    event BadgeMinted(address indexed player,uint256 indexed badge,string name);
    event ProtectionVerified(address indexed player,bool eligible);
    event ProtectionPaid(uint256 indexed royale,address indexed player,uint256 amount,uint8 protectedGames);
    event ReserveFunded(address indexed sponsor,uint256 amount);
    event SeasonStarted(uint32 indexed season,uint64 endsAt);
    event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value);
    event URI(string value,uint256 indexed id);

    modifier onlyOwner() { require(msg.sender == owner,"Owner only"); _; }
    modifier nonReentrant() { require(entered == 0,"Reentry"); entered = 1; _; entered = 0; }

    constructor(address arenaAddress,address token,address initialOwner,uint64 firstSeasonEnds) {
        require(block.chainid == 50312,"Shannon only");
        require(arenaAddress.code.length > 0 && token.code.length > 0 && initialOwner != address(0),"Invalid setup");
        require(firstSeasonEnds >= block.timestamp + 30 days,"Season too short");
        arena = IProgressionArena(arenaAddress);
        collateral = IProgressionToken(token);
        owner = initialOwner;
        seasonEnds = firstSeasonEnds;
        // Season one intentionally includes royales completed before this sidecar
        // was deployed, so the existing Shannon launch event can be recorded.
        seasonStartedAt[1] = 0;
        seasonEndedAt[1] = firstSeasonEnds;
    }

    function profileOf(address player) external view returns (Profile memory) {
        Profile memory p = profiles[player];
        if (p.rating == 0) p.rating = 1000;
        return p;
    }

    function leagueOf(address player) public view returns (uint8) {
        uint256 rating = profiles[player].rating;
        if (rating == 0) rating = 1000;
        if (rating >= 1700) return 4;
        if (rating >= 1450) return 3;
        if (rating >= 1250) return 2;
        if (rating >= 1100) return 1;
        return 0;
    }

    function levelOf(address player) public view returns (uint8) {
        return _level(currentSeason,player);
    }

    function levelAt(uint32 season,address player) public view returns (uint8) {
        require(season > 0 && season <= currentSeason,"Unknown season");
        return _level(season,player);
    }

    function seasonFor(uint64 timestamp) public view returns (uint32 season) {
        season = currentSeason;
        while (season > 1 && timestamp < seasonStartedAt[season]) season--;
        require(timestamp <= seasonEndedAt[season],"Match outside season");
    }

    function _level(uint32 season,address player) private view returns (uint8) {
        uint256 xp = seasonXp[season][player];
        if (xp >= 5000) return 5;
        if (xp >= 2500) return 4;
        if (xp >= 1000) return 3;
        if (xp >= 500) return 2;
        return 1;
    }

    function sponsorReserve() external view returns (uint256) {
        return collateral.balanceOf(address(this));
    }

    function balanceOf(address player,uint256 id) external view returns (uint256) {
        require(player != address(0),"Zero address");
        return badgeBalances[player][id];
    }

    function balanceOfBatch(address[] calldata players,uint256[] calldata ids) external view returns (uint256[] memory out) {
        require(players.length == ids.length,"Length mismatch");
        out = new uint256[](players.length);
        for (uint256 i; i < players.length; i++) out[i] = badgeBalances[players[i]][ids[i]];
    }

    function badgeName(uint256 id) public pure returns (string memory) {
        if (id == BADGE_DEBUT) return "Royale Debut";
        if (id == BADGE_TOP_HALF) return "Cut Survivor";
        if (id == BADGE_THREE_SURVIVALS) return "Triple Survivor";
        if (id == BADGE_PODIUM) return "Podium Finish";
        if (id == BADGE_CHAMPION) return "Royale Champion";
        if (id == BADGE_VETERAN) return "Ten-Royale Veteran";
        if (id == BADGE_PROFITABLE) return "Profitable Finish";
        if (id == BADGE_SEASON_PASS) return "Season Invitational Pass";
        revert("Unknown badge");
    }

    function uri(uint256 id) external pure returns (string memory) {
        if (id == BADGE_DEBUT) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Debut%22%7D";
        if (id == BADGE_TOP_HALF) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Cut%20Survivor%22%7D";
        if (id == BADGE_THREE_SURVIVALS) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Triple%20Survivor%22%7D";
        if (id == BADGE_PODIUM) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Podium%20Finish%22%7D";
        if (id == BADGE_CHAMPION) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Champion%22%7D";
        if (id == BADGE_VETERAN) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Ten-Royale%20Veteran%22%7D";
        if (id == BADGE_PROFITABLE) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Profitable%20Finish%22%7D";
        if (id == BADGE_SEASON_PASS) return "data:application/json,%7B%22name%22%3A%22Market%20Royale%20Season%20Invitational%20Pass%22%7D";
        revert("Unknown badge");
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0xd9b67a26 || interfaceId == 0x0e89341c;
    }

    function setApprovalForAll(address,bool) external pure { revert("Soulbound"); }
    function isApprovedForAll(address,address) external pure returns (bool) { return false; }
    function safeTransferFrom(address,address,uint256,uint256,bytes calldata) external pure { revert("Soulbound"); }
    function safeBatchTransferFrom(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external pure { revert("Soulbound"); }

    function _player(uint256 royale,address who) private view returns (
        IProgressionArena.Tournament memory t,
        IProgressionArena.Player memory player,
        uint256 playerCount,
        uint64 actions,
        uint256 cash
    ) {
        t = arena.getTournament(royale);
        require(t.phase == 3,"Royale not finished");
        IProgressionArena.Player[] memory players = arena.getPlayers(royale);
        playerCount = players.length;
        for (uint256 i; i < playerCount; i++) {
            if (players[i].wallet == who) { player = players[i]; break; }
        }
        require(player.wallet == who && player.rank > 0,"Player not ranked");
        // V3 vaults expose a lifetime counter. The fallback preserves support
        // for V2 Shannon vaults, whose counter only covers their latest round.
        (bool lifetimeOk,bytes memory lifetimeData) = player.vault.staticcall(
            abi.encodeWithSignature("lifetimeActions()")
        );
        actions = lifetimeOk && lifetimeData.length >= 32
            ? abi.decode(lifetimeData,(uint64))
            : uint64(IProgressionVault(player.vault).actions());
        cash = IProgressionVault(player.vault).cash();
    }

    function ratingDelta(uint8 rank,uint256 playerCount) public pure returns (int32) {
        if (playerCount <= 1) return 0;
        int256 percentile = int256((uint256(playerCount - rank) * 60) / (playerCount - 1));
        return int32(percentile - 30);
    }

    function preview(uint256 royale,address who) external view returns (
        bool canRecord,
        uint8 rank,
        uint256 playerCount,
        uint64 actions,
        uint256 finalCash,
        int32 delta,
        uint32 xp,
        bool protectionAvailable,
        uint256 protectionAmount
    ) {
        (IProgressionArena.Tournament memory t,IProgressionArena.Player memory p,uint256 n,uint64 a,uint256 cash) = _player(royale,who);
        t;
        rank = p.rank; playerCount = n; actions = a; finalCash = cash;
        canRecord = !resultRecorded[royale][who];
        delta = ratingDelta(rank,n);
        uint8 survived = p.eliminatedRound > 0 ? p.eliminatedRound - 1 : 0;
        xp = 100 + uint32(survived) * 75;
        if (rank == 1) xp += 300;
        else if (rank <= 3 && n >= 3) xp += 150;
        if (cash > t.bankroll) xp += 50;
        protectionAvailable = actions > 0 && verifiedForProtection[who] && !rebateClaimed[royale][who] && profiles[who].protectedGames < MAX_PROTECTED_GAMES && p.prize == 0;
        protectionAmount = protectionAvailable ? MAX_REBATE : 0;
    }

    function recordResult(uint256 royale,address who) external nonReentrant {
        require(!resultRecorded[royale][who],"Result already recorded");
        (IProgressionArena.Tournament memory t,IProgressionArena.Player memory p,uint256 n,,uint256 cash) = _player(royale,who);
        uint32 resultSeason = seasonFor(t.updatedAt);
        resultRecorded[royale][who] = true;
        Profile storage profile = profiles[who];
        uint256 oldRating = profile.rating == 0 ? 1000 : profile.rating;
        int32 delta = ratingDelta(p.rank,n);
        int256 updated = int256(oldRating) + delta;
        if (updated < 500) updated = 500;
        if (updated > 2500) updated = 2500;
        profile.rating = uint32(uint256(updated));
        profile.completed++;
        uint8 survived = p.eliminatedRound > 0 ? p.eliminatedRound - 1 : 0;
        profile.survivals += survived;
        uint32 xp = 100 + uint32(survived) * 75;
        if (p.rank == 1) { profile.wins++; xp += 300; }
        if (p.rank <= 3 && n >= 3) { profile.podiums++; xp += 150; }
        if (p.rank <= (n + 1) / 2) profile.topHalfFinishes++;
        if (cash > t.bankroll) xp += 50;
        profile.careerXp += xp;
        seasonXp[resultSeason][who] += xp;

        _mint(who,BADGE_DEBUT);
        if (p.rank <= (n + 1) / 2) _mint(who,BADGE_TOP_HALF);
        if (profile.survivals >= 3) _mint(who,BADGE_THREE_SURVIVALS);
        if (p.rank <= 3 && n >= 3) _mint(who,BADGE_PODIUM);
        if (p.rank == 1) _mint(who,BADGE_CHAMPION);
        if (profile.completed >= 10) _mint(who,BADGE_VETERAN);
        if (cash > t.bankroll) _mint(who,BADGE_PROFITABLE);
        if (_level(resultSeason,who) >= 3) _mint(who,BADGE_SEASON_PASS);
        emit ResultRecorded(royale,who,p.rank,delta,xp,leagueOf(who));
    }

    function claimProtection(uint256 royale) external nonReentrant {
        require(verifiedForProtection[msg.sender],"Player not verified");
        require(!rebateClaimed[royale][msg.sender],"Protection already claimed");
        require(profiles[msg.sender].protectedGames < MAX_PROTECTED_GAMES,"Protection limit reached");
        (,IProgressionArena.Player memory p,,uint64 actions,) = _player(royale,msg.sender);
        require(actions > 0,"Filled trade required");
        require(p.prize == 0,"Prize winner not protected");
        require(collateral.balanceOf(address(this)) >= MAX_REBATE,"Protection reserve empty");
        rebateClaimed[royale][msg.sender] = true;
        profiles[msg.sender].protectedGames++;
        require(collateral.transfer(msg.sender,MAX_REBATE),"Protection transfer failed");
        emit ProtectionPaid(royale,msg.sender,MAX_REBATE,profiles[msg.sender].protectedGames);
    }

    function fund(uint256 amount) external nonReentrant {
        require(amount > 0 && collateral.transferFrom(msg.sender,address(this),amount),"Funding failed");
        emit ReserveFunded(msg.sender,amount);
    }

    function setProtectionVerified(address[] calldata players,bool eligible) external onlyOwner {
        require(players.length > 0 && players.length <= 100,"Batch 1-100");
        for (uint256 i; i < players.length; i++) {
            require(players[i] != address(0),"Zero player");
            verifiedForProtection[players[i]] = eligible;
            emit ProtectionVerified(players[i],eligible);
        }
    }

    function startNextSeason(uint64 endsAt) external onlyOwner {
        require(block.timestamp > seasonEnds,"Season active");
        require(endsAt >= block.timestamp + 30 days,"Season too short");
        uint64 startsAt = seasonEnds + 1;
        currentSeason++;
        // A delayed keeper/owner transaction must not leave completed royales
        // in an unassigned gap between seasons.
        seasonStartedAt[currentSeason] = startsAt;
        seasonEndedAt[currentSeason] = endsAt;
        seasonEnds = endsAt;
        emit SeasonStarted(currentSeason,endsAt);
    }

    function withdrawExpiredReserve(uint256 amount) external onlyOwner nonReentrant {
        require(block.timestamp > uint256(seasonEnds) + 30 days,"Reserve still protected");
        require(collateral.transfer(owner,amount),"Transfer failed");
    }

    function _mint(address who,uint256 id) private {
        if (badgeBalances[who][id] != 0) return;
        badgeBalances[who][id] = 1;
        badgeSupply[id]++;
        emit TransferSingle(msg.sender,address(0),who,id,1);
        emit BadgeMinted(who,id,badgeName(id));
    }
}
