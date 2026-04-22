/* ============================================================
   Coin Static Data — protocol-level constants, descriptions,
   collateral types, yield types, and features.
   This data never changes at runtime and requires no API calls.
   ============================================================ */

// ── Hard Caps (max supply, protocol-level) ──────────────────────────────────
export const HARD_CAPS: Record<string, number | null> = {
  BTC:    21_000_000,
  LTC:    84_000_000,
  BCH:    21_000_000,
  XRP:    100_000_000_000,
  ADA:    45_000_000_000,
  DOT:    null,
  DOGE:   null,
  XLM:    50_000_000_000,
  ATOM:   null,
  ALGO:   10_000_000_000,
  XTZ:    null,
  EOS:    null,
  AVAX:   720_000_000,
  LINK:   1_000_000_000,
  UNI:    1_000_000_000,
  AAVE:   16_000_000,
  COMP:   10_000_000,
  MKR:    1_005_577,
  SNX:    328_818_868,
  CRV:    3_303_030_299,
  SUSHI:  250_000_000,
  YFI:    36_666,
  BAT:    1_500_000_000,
  ENJ:    1_000_000_000,
  MANA:   2_193_179_327,
  SAND:   3_000_000_000,
  AXS:    270_000_000,
  CHZ:    8_888_888_888,
  GRT:    10_799_706_720,
  LRC:    1_374_513_896,
  SOL:    null,
  ETH:    null,
  BNB:    200_000_000,
  TRX:    null,
  NEAR:   null,
  FTM:    3_175_000_000,
  HBAR:   50_000_000_000,
  VET:    86_712_634_466,
  ICP:    null,
  FIL:    1_977_232_631,
  THETA:  1_000_000_000,
  XMR:    null,
  ZEC:    21_000_000,
  DASH:   18_920_000,
  DCR:    21_000_000,
  KAS:    28_700_000_000,
  STX:    1_818_000_000,
  APT:    null,
  SUI:    10_000_000_000,
  SEI:    null,
  INJ:    null,
  QNT:    14_612_493,
  ARB:    10_000_000_000,
  OP:     4_294_967_296,
  MATIC:  10_000_000_000,
  POL:    10_000_000_000,
  IMX:    2_000_000_000,
  MINA:   null,
  FLOW:   null,
  ROSE:   10_000_000_000,
  CELO:   1_000_000_000,
  ONE:    null,
  IOTA:   4_600_000_000,
  ZIL:    21_000_000_000,
  PAXG:   null,
  KAU:    null,
  KAG:    null,
  TRUMP:  1_000_000_000,
  PEPE:   420_690_000_000_000,
  SHIB:   999_982_357_198_023,
  BONK:   93_526_183_799_030,
  FLOKI:  9_694_690_000_000,
  WIF:    998_926_392,
  DYDX:   1_000_000_000,
  GMX:    13_250_000,
  PENDLE: 258_446_028,
  ENA:    15_000_000_000,
  EIGEN:  1_670_000_000,
  RPL:    19_000_000,
  LDO:    1_000_000_000,
  SSV:    11_838_534,
  RENDER: 531_042_086,
  RNDR:   531_042_086,
  TAO:    21_000_000,
  FET:    2_719_493_896,
  AGIX:   2_000_000_000,
  OCEAN:  1_410_000_000,
  AR:     66_000_000,
  HNT:    223_000_000,
  GNO:    10_000_000,
  TON:    5_000_000_000,
  TIA:    null,
  APE:    1_000_000_000,
  BLUR:   3_000_000_000,
  ENS:    100_000_000,
  MAGIC:  347_714_007,
  LQTY:   100_000_000,
  WLD:    10_000_000_000,
  CRO:    30_263_013_692,
  LEO:    985_239_504,
  CAKE:   750_000_000,
  USDT:   null,
  USDC:   null,
  DAI:    null,
  PYUSD:  null,
};

// ── Hard Cap Labels (explains why there's no cap) ───────────────────────────
export const HARD_CAP_LABELS: Record<string, string> = {
  ETH:   'No cap (deflationary burn)',
  SOL:   'No cap (inflationary, decreasing rate)',
  DOT:   'No cap (inflationary staking rewards)',
  ATOM:  'No cap (inflationary staking rewards)',
  DOGE:  'No cap (5B new coins/year)',
  TRX:   'No cap (deflationary burn)',
  NEAR:  'No cap (inflationary, 5% annual)',
  XMR:   'No cap (tail emission ~0.6 XMR/min)',
  ICP:   'No cap (inflationary governance rewards)',
  XTZ:   'No cap (inflationary baking rewards)',
  EOS:   'No cap (inflationary)',
  INJ:   'No cap (deflationary burn auction)',
  ONE:   'No cap (inflationary)',
  MINA:  'No cap (inflationary, supercharged rewards)',
  FLOW:  'No cap (inflationary)',
  APT:   'No cap (inflationary staking rewards)',
  SEI:   'No cap (inflationary)',
  TIA:   'No cap (inflationary)',
  BNB:   'No cap (quarterly burn toward 100M)',
  PAXG:  'No cap (backed by gold, minted on demand)',
  KAU:   'No cap (backed by gold, minted on demand)',
  KAG:   'No cap (backed by silver, minted on demand)',
  USDT:  'No cap (stablecoin, minted on demand)',
  USDC:  'No cap (stablecoin, minted on demand)',
  DAI:   'No cap (stablecoin, minted on demand)',
  PYUSD: 'No cap (stablecoin, minted on demand)',
};

export function _hardCapLabel(sym: string) {
  return HARD_CAP_LABELS[sym] || 'No cap';
}

// ── Collateral Types ────────────────────────────────────────────────────────
export const COLLATERAL = {
  GOLD:       { symbols: ['PAXG', 'XAUT', 'KAU'],                          label: 'Gold',                                cls: 'badge-yellow' },
  SILVER:     { symbols: ['KAG'],                                           label: 'Silver',                              cls: 'badge-silver' },
  USD:        { symbols: ['USDT','USDC','PYUSD','USDP','TUSD','BUSD','FDUSD','GUSD','USDS','USD0'], label: 'USD',          cls: 'badge-green'  },
  BTC_BACKED: { symbols: ['WBTC','CBBTC','TBTC'],                          label: 'Bitcoin-backed',                      cls: 'badge-orange' },
  ETH_BACKED: { symbols: ['STETH','RETH','CBETH','WSTETH'],                label: 'Ethereum-backed',                     cls: 'badge-blue'   },
  RWA:        { symbols: ['ONDO','BUIDL'],                                  label: 'Treasuries/Bonds/Money Market Funds', cls: 'badge-green'  },
  CRYPTO:     { symbols: ['LUSD','CRVUSD','SUSD','MKRUSD'],                label: 'Crypto',                              cls: 'badge-blue'   },
  HYBRID:     { symbols: ['USDD','DAI','FRAX'],                             label: 'Stablecoin/Crypto',                   cls: 'badge-blue'   },
};

// Build fast lookup
export const _collateralMap: Record<string, { label: string; cls: string }> = {};
for (const cat of Object.values(COLLATERAL)) {
  for (const sym of cat.symbols) _collateralMap[sym] = { label: cat.label, cls: cat.cls };
}

// ── Coin Descriptions ───────────────────────────────────────────────────────
export const COIN_DESCRIPTIONS: Record<string, string> = {
  PAXG:   'PAXG is a gold-backed digital token where each coin represents one troy ounce of investment-grade London Good Delivery gold held in Brink\'s vaults in London, redeemable for physical gold or fiat currency.',
  BTC:    'Bitcoin (BTC) is the original and most widely used cryptocurrency \u2014 its primary value is as a long-term store of value rather than everyday spending. It\'s the most liquid and widely accepted crypto, which lowers risk relative to other coins, but its price is still highly volatile and it offers no yield or income on its own.',
  BCH:    'Bitcoin Cash (BCH) is a faster, cheaper version of Bitcoin designed for everyday transactions rather than as a store of value. It has a smaller network and lower adoption than Bitcoin, which makes it more volatile and less liquid. Best suited for buyers who believe in crypto as a payment currency rather than an investment asset.',
  AAVE:   'Aave (AAVE) is a decentralized lending protocol \u2014 you can deposit crypto to earn interest or borrow against your holdings without a bank. AAVE as a token gives you governance rights over the protocol. The appeal is the ability to put your crypto to work earning yield, but it carries smart contract risk (code vulnerabilities) and the value of AAVE itself is tied directly to how much activity the protocol sees.',
  SOL:    'Solana (SOL) is built for speed and low transaction costs, handling thousands of transactions per second compared to Ethereum\'s slower throughput \u2014 making it attractive for apps, gaming, and payments. The tradeoff is that Solana has experienced network outages in the past, and its validator set is more centralized than Ethereum or Bitcoin, which is a risk factor for long-term buyers.',
  QNT:    'Quant (QNT) is a utility-based, enterprise and institutional-facing coin \u2014 its value is tied to adoption of Overledger (a platform designed to expedite digital exchange with simplicity and security) by banks, governments, and large corporations to connect different blockchains together. It has an extremely small max supply of only 14.6 million tokens ever, which amplifies price movement in both directions. It\'s a higher-conviction, niche bet on blockchain becoming standard infrastructure for financial institutions.',
  LTC:    'Litecoin (LTC) is one of the oldest and most battle-tested cryptocurrencies, functioning as a faster and cheaper alternative to Bitcoin for payments. It has a long track record and solid liquidity, but limited innovation or unique use cases compared to newer coins, making it lower risk but also lower upside relative to others on this list.',
  LINK:   'Chainlink (LINK) is infrastructure \u2014 it\'s the bridge that feeds real-world data into blockchain smart contracts, making it essential to the functioning of most DeFi applications. Its value is tied to how widely smart contracts are used across all blockchains, not just one. The risk is that it\'s a utility token, so its price is driven more by developer adoption than retail speculation.',
  UNI:    'Uniswap (UNI) is the largest decentralized exchange (DEX) on Ethereum, this service allows users to swap any token (ERC-20) directly from their wallet for a trading fee and a gas fee. Uniswap is a governance token that gives holders voting rights. The funds received from trading fees are dispersed to members who participate in their liquidity pools.',
  TRUMP:  'Official Trump (TRUMP) is a meme coin launched on the Solana blockchain on January 17, 2025, three days before Trump\'s inauguration. It has no utility, underlying asset, or technology backing its value \u2014 it is purely driven by political sentiment, celebrity association, and speculation. 80% of the total 1 billion token supply is controlled by two Trump-affiliated entities and is being gradually released over three years, meaning insiders hold the overwhelming majority. It peaked at $75 shortly after launch and has since fallen over 95% to around $3. A forensic analysis found that 764,000 wallets lost money trading it while a small number of insiders profited significantly. It has no hard cap utility, no governance rights, no yield, and no physical backing \u2014 making it the highest risk asset on this list.',
  ADI:    'ADI is a utility token that is financed by transactional movement conducted on the ADI platform.',
  ETH:    'Ethereum (ETH) is the backbone of decentralized finance and smart contracts \u2014 most DeFi apps, NFTs, and layer-2 networks are built on it. After switching to proof-of-stake, holders can stake ETH to earn ~3-4% APR. EIP-1559 burns a portion of every transaction fee, making ETH deflationary during high network activity. It\'s the second most established crypto after Bitcoin.',
  XRP:    'XRP is designed for fast, low-cost cross-border payments and is used by financial institutions through RippleNet. Transactions settle in 3-5 seconds at a fraction of a cent. Its value is tied to institutional adoption for international money transfers. The SEC lawsuit (largely resolved in Ripple\'s favor) was a major overhang that has now cleared.',
  BNB:    'Binance Coin (BNB) is the native token of the Binance ecosystem \u2014 the world\'s largest crypto exchange. It\'s used for trading fee discounts, Binance Launchpool access, and gas fees on BNB Chain. Binance conducts quarterly burns to reduce supply toward a target of 100M tokens. Its value is directly tied to Binance\'s dominance in crypto trading.',
  ADA:    'Cardano (ADA) takes a research-driven, peer-reviewed approach to blockchain development \u2014 slower to ship features but aims for academic rigor. It supports staking (~3-5% APR) with no lock-up period, meaning you can unstake anytime. Its ecosystem is smaller than Ethereum or Solana but growing, with a focus on real-world use cases in developing markets.',
  DOT:    'Polkadot (DOT) connects different blockchains together through its relay chain and parachain architecture, allowing them to share security and communicate. Staking yields are among the highest of major chains at 12-15% APR.',
  DOGE:   'Dogecoin (DOGE) started as a joke but became one of the most recognized cryptocurrencies thanks to its community and Elon Musk\'s endorsements. It has no hard cap \u2014 5 billion new coins are minted every year, creating constant inflation. It has no smart contracts, no DeFi ecosystem, and no staking \u2014 its value is purely driven by sentiment and cultural relevance.',
  AVAX:   'Avalanche (AVAX) is a high-speed layer-1 blockchain with sub-second finality, designed for DeFi and enterprise use. Its unique subnet architecture lets anyone create custom blockchains with their own rules. Staking yields ~8-9% APR. It competes directly with Ethereum and Solana for DeFi and gaming applications.',
  SHIB:   'Shiba Inu (SHIB) is a meme token that grew into an ecosystem with its own DEX (ShibaSwap), layer-2 chain (Shibarium), and metaverse project. The total supply is nearly 1 quadrillion tokens, though regular burns reduce it over time. It\'s highly speculative \u2014 value is driven almost entirely by community size and sentiment rather than utility.',
  ATOM:   'Cosmos (ATOM) is the "internet of blockchains" \u2014 it provides the infrastructure (IBC protocol) for independent blockchains to communicate and transfer assets between each other. Staking yields are high at 15-20% APR. Being a Cosmos staker also qualifies you for frequent airdrops from new chains launching in the ecosystem.',
  NEAR:   'NEAR Protocol is a layer-1 blockchain focused on usability \u2014 it features human-readable account names instead of long wallet addresses and uses sharding to scale. Its developer experience is considered one of the best in crypto. Staking yields ~5-6% APR.',
  TRX:    'TRON (TRX) is a blockchain focused on entertainment and content sharing, with a large presence in Asia. It processes more USDT stablecoin transactions than any other chain. Staking yields ~4-5% APR. Its founder Justin Sun is a controversial figure, which adds reputational risk.',
  HBAR:   'Hedera (HBAR) uses hashgraph consensus instead of traditional blockchain \u2014 it\'s faster and more energy-efficient. Its governing council includes Google, IBM, Boeing, and other Fortune 500 companies. It\'s one of the most enterprise-focused cryptos, targeting real-world business use cases.',
  XLM:    'Stellar (XLM) focuses on connecting financial institutions and enabling low-cost cross-border payments, similar to XRP but with a non-profit foundation. It\'s used by companies like MoneyGram and IBM World Wire. Transaction fees are a fraction of a cent.',
  VET:    'VeChain (VET) specializes in supply chain management and business processes \u2014 tracking products from factory to consumer on the blockchain. Major partners include Walmart China, BMW, and DNV. Holding VET automatically generates VTHO tokens, which are used to pay for transactions.',
  ICP:    'Internet Computer (ICP) aims to host entire web applications and services on-chain \u2014 not just financial transactions but full websites, social media, and enterprise software. It\'s one of the most ambitious projects in crypto. Staking requires locking tokens in "neurons" for up to 8 years for maximum rewards.',
  FIL:    'Filecoin (FIL) is a decentralized storage network \u2014 users pay to store data across a global network of storage providers instead of relying on Amazon or Google. Storage providers earn FIL by proving they\'re reliably storing data. Its value is tied to the demand for decentralized, censorship-resistant data storage.',
  PEPE:   'PEPE is a meme coin based on the Pepe the Frog internet meme. It has no utility, no staking, no governance, and no backing \u2014 it is pure speculation driven by meme culture and social media momentum. The supply is 420.69 trillion tokens. It can gain or lose 50%+ in a single day.',
  MKR:    'Maker (MKR) governs the MakerDAO protocol, which issues DAI \u2014 one of the largest decentralized stablecoins. MKR holders vote on risk parameters like collateral types and stability fees. When the system runs a surplus, MKR is bought back and burned, making it deflationary. It\'s one of the oldest and most battle-tested DeFi protocols.',
  INJ:    'Injective (INJ) is a layer-1 blockchain optimized for DeFi \u2014 specifically decentralized derivatives, futures, and spot trading. It features a weekly burn auction that permanently removes INJ from supply. Staking yields are among the highest at 15-17% APR.',
  GRT:    'The Graph (GRT) is the indexing protocol for querying blockchain data \u2014 often called "the Google of blockchains." Developers use it to efficiently query data from Ethereum, NEAR, and other chains. Token holders can delegate GRT to indexers and earn ~10-12% APR.',
  RENDER: 'Render (RNDR) connects people who need GPU computing power (for 3D rendering, AI, etc.) with people who have idle GPUs. Node operators earn RENDER tokens for providing their computing power. Its value is tied to the growing demand for GPU compute in AI and creative industries.',
  AR:     'Arweave (AR) offers permanent, one-time-payment data storage on a decentralized network \u2014 pay once and your data is stored forever. It\'s used for preserving important documents, websites, and NFT metadata. The protocol guarantees at least 200 years of storage through its endowment mechanism.',
  TAO:    'Bittensor (TAO) is a decentralized AI network where machine learning models compete to provide the best intelligence. Miners run AI models and validators evaluate their outputs. It\'s positioned at the intersection of crypto and AI, with a max supply of 21 million (same as Bitcoin).',
  TON:    'Toncoin (TON) is the blockchain integrated into Telegram, the messaging app with 900M+ users. This gives it one of the largest built-in distribution channels of any crypto. It supports staking (~3-5% APR) and is being used for in-app payments, bots, and mini-apps within Telegram.',
  STX:    'Stacks (STX) brings smart contracts and DeFi to Bitcoin through its unique "Stacking" mechanism \u2014 STX holders lock their tokens and earn yield paid in actual BTC, not STX. It\'s the leading project building programmability on top of Bitcoin\'s security.',
  ONDO:   'Ondo Finance (ONDO) tokenizes real-world assets like US Treasuries and bonds, bringing traditional finance yields on-chain. Its flagship product OUSG gives crypto holders exposure to short-term US government bonds. It bridges the gap between DeFi and traditional fixed-income investing.',
  PENDLE: 'Pendle (PENDLE) lets you tokenize and trade future yield \u2014 you can lock in a fixed yield rate or speculate on variable yields. It\'s one of the most innovative DeFi protocols, enabling yield trading strategies that previously only existed in traditional finance.',
  ENA:    'Ethena (ENA) created USDe, a synthetic dollar that generates yield through delta-neutral hedging strategies. Staking USDe (sUSDe) has offered 10-25% APR \u2014 far above traditional stablecoin yields. The high yields come from funding rate arbitrage, which carries smart contract and counterparty risk.',
  CRV:    'Curve (CRV) is the dominant DEX for stablecoin and pegged asset swaps, processing billions in volume. The "Curve Wars" \u2014 where protocols compete to direct CRV emissions \u2014 make it a central piece of DeFi infrastructure. Vote-locking CRV (veCRV) earns trading fees and governance power.',
  DYDX:   'dYdX (DYDX) is the leading decentralized perpetual futures exchange, allowing leveraged trading without a centralized intermediary. It moved to its own Cosmos-based chain for full decentralization. Stakers earn a share of all protocol trading fees.',
  GMX:    'GMX is a decentralized perpetual exchange on Arbitrum and Avalanche. Staking GMX earns 30% of all platform fees paid in ETH/AVAX \u2014 making it one of the few tokens with real, sustainable revenue sharing. It\'s popular among DeFi users seeking protocol-revenue-based yield.',
  SNX:    'Synthetix (SNX) powers synthetic assets \u2014 tokens that track the price of stocks, commodities, and other crypto without holding the underlying asset. Stakers provide collateral for the system and earn trading fees plus inflationary rewards, yielding 15-30% APR.',
  KAU:    'Kinesis Gold (KAU) is a gold-backed digital currency where each token represents 1 gram of physical gold stored in insured vaults. Unlike PAXG, Kinesis offers a unique yield system \u2014 holders, minters, referrers, and depositors all earn a share of transaction fees generated on the Kinesis network.',
  KAG:    'Kinesis Silver (KAG) is a silver-backed digital currency where each token represents 1 troy ounce of physical silver stored in insured vaults. Like KAU, it participates in the Kinesis yield system where transaction fees are shared among holders, minters, referrers, and depositors.',
  WBTC:   'Wrapped Bitcoin (WBTC) is an ERC-20 token backed 1:1 by Bitcoin held in custody by BitGo. It allows BTC holders to use their Bitcoin in Ethereum DeFi \u2014 lending, borrowing, and providing liquidity. The tradeoff is custodial risk \u2014 you\'re trusting BitGo to hold the underlying BTC.',
  EIGEN:  'EigenLayer (EIGEN) pioneered restaking \u2014 allowing ETH stakers to re-use their staked ETH to secure additional services (called AVSs) and earn extra yield. It\'s one of the highest TVL protocols in DeFi. The concept extends Ethereum\'s security model to oracles, bridges, and other infrastructure.',
  APT:    'Aptos (APT) is a layer-1 blockchain built by former Meta (Facebook) engineers using the Move programming language. It focuses on safety and high throughput. Staking yields ~7% APR. It competes with Sui, Solana, and other high-performance chains.',
  SUI:    'Sui is a layer-1 blockchain also built with the Move language by former Meta engineers (separate team from Aptos). It features object-centric data storage for parallel transaction processing. Staking yields ~3-4% APR. Its focus is on gaming, social, and consumer applications.',
  SEI:    'Sei is a layer-1 blockchain purpose-built for trading \u2014 optimized for order book-based exchanges with built-in order matching. It claims to be the fastest chain to finality. It targets the intersection of DeFi and centralized exchange performance.',
  FET:    'Fetch.ai (FET) builds autonomous AI agents that can perform tasks like optimizing DeFi yields, managing supply chains, and coordinating transportation networks. It merged with SingularityNET (AGIX) and Ocean Protocol to form the ASI Alliance \u2014 the largest decentralized AI initiative in crypto.',
  BONK:   'Bonk (BONK) is Solana\'s community-driven meme coin, created as a response to the FTX collapse to revive the Solana ecosystem. It was airdropped to Solana users and NFT communities. Like all meme coins, it has no fundamental utility \u2014 its value is driven entirely by community enthusiasm.',
  XMR:    'Monero (XMR) is the leading privacy-focused cryptocurrency \u2014 transactions are untraceable by default using ring signatures, stealth addresses, and RingCT. Unlike Bitcoin, where all transactions are publicly visible, Monero hides the sender, receiver, and amount. It\'s widely used for privacy but faces increasing exchange delistings due to regulatory pressure.',
  ALGO:   'Algorand (ALGO) is a layer-1 blockchain founded by MIT cryptography professor Silvio Micali. It features instant finality and was designed for institutional and government use cases \u2014 including being chosen for the Marshall Islands\' digital currency. Governance participation earns periodic rewards.',
  WIF:    'dogwifhat (WIF) is a Solana meme coin featuring a Shiba Inu dog wearing a pink knitted hat. It has no utility \u2014 its value is purely driven by meme culture and social media momentum. It was one of the standout meme coins of 2024.',
  WLD:    'Worldcoin (WLD) is Sam Altman\'s (OpenAI CEO) project to create a global identity and financial network. Users verify their humanness through iris scanning with an "Orb" device and receive WLD tokens. It\'s controversial due to biometric data privacy concerns but has ambitious scale \u2014 aiming to onboard every human on earth.',
  MATIC:  'Polygon (MATIC) is an Ethereum scaling solution that processes transactions faster and cheaper than Ethereum mainnet. It\'s one of the most widely adopted layer-2 networks, used by major brands like Starbucks, Nike, and Reddit for NFT and loyalty programs. Being rebranded to POL as part of Polygon 2.0.',
  POL:    'Polygon (POL) is the upgraded token replacing MATIC, powering the Polygon ecosystem of layer-2 scaling solutions for Ethereum. It retains all staking and governance functions while adding new utility across multiple Polygon chains including zkEVM.',
  ARB:    'Arbitrum (ARB) is the largest Ethereum layer-2 by TVL, using optimistic rollups to process transactions at a fraction of Ethereum\'s cost while inheriting its security. It hosts a thriving DeFi ecosystem including GMX, Camelot, and Radiant. Staking yields ~5-8% APR.',
  OP:     'Optimism (OP) is an Ethereum layer-2 using optimistic rollups, known for its "retroactive public goods funding" model that rewards open-source contributors. It powers the OP Stack \u2014 the framework behind Base (Coinbase\'s chain) and other rollups. Staking yields ~4-6% APR.',
  FTM:    'Fantom (FTM) is a high-speed layer-1 using a DAG-based consensus mechanism for near-instant finality. It\'s popular in DeFi with protocols like SpookySwap. The network is transitioning to Sonic, a major upgrade promising even higher throughput.',
  USDT:   'Tether (USDT) is the largest stablecoin by market cap, pegged 1:1 to the US dollar. It\'s the most traded crypto asset globally and the primary trading pair on most exchanges. Backed by reserves including US Treasuries, cash, and commercial paper. No yield natively but widely used in DeFi lending.',
  USDC:   'USD Coin (USDC) is a regulated stablecoin pegged 1:1 to the US dollar, issued by Circle. It\'s backed entirely by cash and short-term US Treasuries with regular attestations. Considered the most transparent and regulatory-compliant stablecoin. Widely used in DeFi lending protocols.',
  DAI:    'DAI is a decentralized stablecoin maintained by MakerDAO, soft-pegged to the US dollar. Unlike USDT or USDC, no single company controls it \u2014 it\'s backed by over-collateralized crypto deposits and real-world assets. The DAI Savings Rate (DSR) lets holders earn ~5-8% yield directly from the protocol.',
  COMP:   'Compound (COMP) is a DeFi lending protocol where users earn interest by supplying crypto or borrow against their holdings. COMP tokens grant governance rights over the protocol. It pioneered "yield farming" in 2020, kickstarting the DeFi Summer movement.',
  LEO:    'UNUS SED LEO (LEO) is Bitfinex exchange\'s utility token, used for trading fee discounts and other platform benefits. Bitfinex regularly buys back and burns LEO using revenue, steadily reducing supply. Its value is tied directly to Bitfinex\'s trading volume and profitability.',
  THETA:  'Theta Network (THETA) is a decentralized video streaming platform where users share bandwidth and computing resources. It\'s backed by Google, Samsung, and Sony as validator nodes. Edge node operators earn TFUEL tokens for relaying video content.',
  SAND:   'The Sandbox (SAND) is a virtual gaming metaverse where players can build, own, and monetize their gaming experiences. Major brands like Adidas, Gucci, and Snoop Dogg have purchased virtual land. SAND is used for transactions, staking, and governance within the platform.',
  MANA:   'Decentraland (MANA) powers a virtual reality platform where users create, experience, and monetize content and applications. It was one of the first metaverse projects, with virtual land selling for millions. Users can rent land, host events, and build interactive experiences.',
  AXS:    'Axie Infinity (AXS) pioneered play-to-earn gaming \u2014 players battle creatures called Axies to earn crypto rewards. It became a primary income source in the Philippines during 2021. Staking yields are high but the game economy has deflated significantly from its peak.',
  ENS:    'Ethereum Name Service (ENS) converts long Ethereum addresses into human-readable names (like "yourname.eth"). It\'s essential infrastructure for the Ethereum ecosystem. ENS domains are NFTs that can be traded, and the protocol generates steady revenue from domain registrations and renewals.',
  RUNE:   'THORChain (RUNE) enables cross-chain swaps without bridges or wrapped tokens \u2014 you can swap native BTC for native ETH directly. Liquidity providers earn 8-15% APR from swap fees. It\'s unique in that it actually facilitates native asset exchanges across different blockchains.',
  LDO:    'Lido (LDO) is the largest liquid staking protocol, controlling ~30% of all staked ETH. When you stake ETH through Lido, you receive stETH which can be used in DeFi while still earning staking rewards. LDO is the governance token that directs the protocol.',
  RPL:    'Rocket Pool (RPL) is a decentralized ETH staking protocol \u2014 unlike Lido, anyone can run a Rocket Pool node with just 8 ETH (vs 32 ETH solo). RPL is required as collateral by node operators, creating natural demand. It\'s the most decentralized liquid staking option.',
  FLOKI:  'Floki (FLOKI) started as a meme coin named after Elon Musk\'s Shiba Inu dog but has expanded into a utility ecosystem with FlokiFi (DeFi suite), Valhalla (gaming metaverse), and a merchandise line. It\'s one of the few meme coins attempting to build real products.',
  IMX:    'Immutable X (IMX) is a layer-2 scaling solution specifically built for NFTs and gaming on Ethereum. It offers gas-free minting and trading of NFTs. Major gaming studios use it for blockchain game development, making it the leading infrastructure for Web3 gaming.',
  GALA:   'Gala Games (GALA) is a blockchain gaming platform where players can own in-game items as NFTs. It operates a distributed network of player-run nodes. The platform hosts multiple games and aims to give players ownership of their gaming assets.',
  CRO:    'Cronos (CRO) is the native token of the Crypto.com ecosystem \u2014 one of the largest crypto platforms with a Visa debit card, exchange, and DeFi chain. Staking CRO earns cashback rewards on the Visa card and ~10-12% APR. Its value is tied to Crypto.com\'s user growth.',
  ENJ:    'Enjin (ENJ) provides tools for creating and managing blockchain-based gaming assets. Every NFT created on Enjin is backed by ENJ tokens, which can be retrieved by "melting" the item \u2014 giving all game items a guaranteed minimum value.',
  BAT:    'Basic Attention Token (BAT) powers the Brave browser\'s privacy-first advertising model. Users earn BAT for viewing opt-in ads, and advertisers pay in BAT for attention-verified ad placements. It flips the traditional ad model \u2014 users get paid instead of tracked.',
  KAVA:   'Kava is a layer-1 blockchain combining the speed of Cosmos with the developer power of Ethereum (co-chain architecture). It offers DeFi services including lending and staking with yields of 15-20% APR. Backed by major institutional investors.',
  OSMO:   'Osmosis (OSMO) is the largest DEX in the Cosmos ecosystem, facilitating cross-chain token swaps via IBC. Its unique "superfluid staking" lets liquidity providers earn staking rewards simultaneously. It\'s the central trading hub for the entire Cosmos network.',
  PYTH:   'Pyth Network (PYTH) provides real-time financial market data to DeFi protocols \u2014 price feeds for crypto, stocks, forex, and commodities. Unlike Chainlink which aggregates data, Pyth gets data directly from first-party sources like exchanges and trading firms.',
  TIA:    'Celestia (TIA) pioneered the modular blockchain thesis \u2014 it provides data availability as a service, letting other blockchains outsource their data storage to Celestia. This makes launching new blockchains dramatically cheaper. Staking yields ~10-15% APR.',
  JTO:    'Jito (JTO) is the leading MEV (Maximal Extractable Value) protocol on Solana, optimizing block production for validators. Its liquid staking product jitoSOL earns staking yield plus MEV tips. It captures value from the growing transaction ordering market on Solana.',
  AGIX:   'SingularityNET (AGIX) is a decentralized marketplace for AI services \u2014 developers publish and monetize AI algorithms. Founded by the creators of Sophia the Robot. It merged with Fetch.ai and Ocean Protocol to form the ASI Alliance, the largest decentralized AI initiative.',
  OCEAN:  'Ocean Protocol (OCEAN) creates a decentralized data marketplace where users can publish, discover, and consume data while maintaining privacy. Data owners earn OCEAN by selling access to their datasets. Part of the ASI Alliance with Fetch.ai and SingularityNET.',
  JASMY:  'JasmyCoin (JASMY) is Japan\'s first legally compliant digital currency, focused on data democracy \u2014 giving individuals control over their personal data. The project is led by former Sony executives. It aims to restore personal data sovereignty in the IoT era.',
  HNT:    'Helium (HNT) pioneered decentralized physical infrastructure (DePIN) \u2014 users deploy hotspots to provide IoT wireless coverage and earn HNT. The network has expanded to 5G coverage (MOBILE token) and IoT sensors. It\'s the most successful real-world crypto infrastructure project.',
  XAUT:   'Tether Gold (XAUT) is a gold-backed token where each coin represents one troy ounce of London Good Delivery gold held in a Swiss vault. It\'s issued by Tether, the same company behind USDT. Holders can redeem for physical gold bars.',
  STETH:  'Lido Staked ETH (stETH) represents ETH staked through the Lido protocol. It earns ~3-4% APR automatically while remaining liquid \u2014 you can use stETH in DeFi, trade it, or lend it. It\'s the most widely used liquid staking token and a building block of DeFi.',
  WSTETH: 'Wrapped Staked ETH (wstETH) is the non-rebasing version of stETH \u2014 instead of the balance growing daily, the token\'s value appreciates relative to ETH. This makes it compatible with DeFi protocols that don\'t support rebasing tokens. Same yield as stETH (~3-4% APR).',
  RETH:   'Rocket Pool ETH (rETH) represents ETH staked through the decentralized Rocket Pool protocol. Like wstETH, it appreciates in value rather than rebasing. It\'s the most decentralized liquid staking option \u2014 backed by thousands of independent node operators rather than one entity.',
  FRAX:   'Frax (FRAX) was the first fractional-algorithmic stablecoin, pioneering a hybrid approach to maintaining its dollar peg. It has since moved to fully collateralized. The Frax ecosystem includes Fraxlend (lending), frxETH (liquid staking), and sFRAX (yield-bearing stablecoin).',
  GNO:    'Gnosis (GNO) is a prediction market and decentralized infrastructure platform on Ethereum. It operates Gnosis Chain (formerly xDai), Gnosis Safe (the most trusted multi-sig wallet used to secure billions in crypto), and CoW Protocol (MEV-protected trading).',
  DASH:   'Dash (DASH) is a payments-focused cryptocurrency featuring instant transactions (InstantSend) and optional privacy (PrivateSend). It uses a two-tier network of miners and masternodes \u2014 masternode operators stake 1,000 DASH and earn ~6-8% APR while providing governance and instant confirmation services.',
  DCR:    'Decred (DCR) is a hybrid proof-of-work/proof-of-stake cryptocurrency focused on decentralized governance. Stakeholders vote on protocol changes through an on-chain voting system, making it one of the most democratically governed projects. Mining and staking work together to secure the network.',
  ZEC:    'Zcash (ZEC) offers optional privacy through zero-knowledge proofs (zk-SNARKs) \u2014 users can choose between transparent and shielded transactions. Built by world-class cryptographers. It has the same 21M supply cap as Bitcoin but adds privacy features for those who want them.',
  IOTA:   'IOTA uses a Directed Acyclic Graph (DAG) called the Tangle instead of a traditional blockchain \u2014 transactions are feeless and become faster as more people use the network. It\'s designed for the Internet of Things (IoT), enabling machine-to-machine micropayments.',
  ZIL:    'Zilliqa (ZIL) was the first blockchain to implement sharding in production, allowing it to process transactions in parallel for higher throughput. It targets enterprise and gaming use cases. Staking yields ~12-14% APR.',
  NEXO:   'Nexo is a centralized crypto lending platform where you can earn up to 12% APR on deposits or borrow against your crypto without selling. It\'s one of the most established CeFi platforms with banking-grade security. The NEXO token provides higher yield tiers and cashback rewards.',
  NEO:    'NEO is often called "Chinese Ethereum" \u2014 a smart contract platform focused on digital identity and smart economy. Holding NEO automatically generates GAS tokens (like VET/VTHO), which are used to pay for transactions. It targets regulatory compliance and real-world asset digitization.',
  EOS:    'EOS is a layer-1 blockchain designed for high-throughput commercial applications with no transaction fees for end users. It launched with one of the largest ICOs ($4B) but underdelivered on its initial promises. The EOS Network Foundation has been revitalizing the project since 2022.',
  CAKE:   'PancakeSwap (CAKE) is the largest DEX on BNB Chain, offering token swaps, farming, lottery, and NFTs. It\'s the go-to trading platform for BNB Chain tokens. CAKE can be staked for ~3-5% APR and provides access to IFO (Initial Farm Offering) launches.',
  SUSHI:  'SushiSwap (SUSHI) is a multi-chain DEX that forked from Uniswap and expanded to 20+ blockchains. Staking SUSHI (xSUSHI) earns a share of trading fees across all chains. It also offers lending (Kashi) and launchpad features, though it has faced governance and leadership challenges.',
  YFI:    'Yearn Finance (YFI) is a DeFi yield aggregator that automatically moves your deposits between lending protocols to maximize returns. It\'s known for having one of the smallest supplies in crypto (36,666 tokens) and was the first "fair launch" token \u2014 no pre-mine, no VC allocation. It\'s DeFi infrastructure for passive yield optimization.',
  LRC:    'Loopring (LRC) is a layer-2 scaling protocol using zkRollups to enable fast, low-cost trading on Ethereum. It powers its own DEX and smart wallet. It gained mainstream attention through a partnership with GameStop\'s NFT marketplace.',
  BLUR:   'Blur is the leading NFT marketplace by trading volume, overtaking OpenSea through aggressive trader incentives and zero-fee trading. It also offers Blend \u2014 a peer-to-peer NFT lending protocol. The BLUR token is used for governance and rewards active NFT traders.',
  PENGU:  'Pudgy Penguins (PENGU) is the token behind one of the most successful NFT collections. The brand expanded beyond NFTs into physical toys (sold at Walmart and Target), a gaming platform, and consumer products. It\'s one of the few NFT projects that successfully crossed over into mainstream retail.',
  APE:    'ApeCoin (APE) is the governance and utility token for the Bored Ape Yacht Club ecosystem \u2014 one of the most iconic NFT collections. It\'s used in the Otherside metaverse, ApeStake staking, and across the Yuga Labs universe. Its value is tied to the cultural relevance of the BAYC brand.',
  ANKR:   'Ankr (ANKR) provides decentralized infrastructure for Web3 \u2014 offering RPC endpoints, liquid staking, and node hosting. It powers blockchain access for developers who don\'t want to run their own nodes. It\'s essential background infrastructure that most DeFi users interact with indirectly.',
  SSV:    'SSV Network (SSV) enables distributed validator technology (DVT) for Ethereum staking \u2014 splitting a validator key among multiple operators for better security and uptime. It reduces single points of failure in ETH staking, making the network more decentralized and resilient.',
  CHZ:    'Chiliz (CHZ) powers Socios.com, the platform where sports fans buy Fan Tokens to vote on minor club decisions, access exclusive content, and earn rewards. Partner clubs include FC Barcelona, PSG, Juventus, and UFC. It\'s the dominant player in sports crypto.',
  LQTY:   'Liquity (LQTY) governs the Liquity protocol, which offers interest-free borrowing against ETH collateral \u2014 you pay a one-time fee instead of ongoing interest. The Stability Pool earns 5-8% APR from liquidation proceeds. It\'s one of the most capital-efficient DeFi lending protocols.',

  HYPE:   'Hyperliquid (HYPE) is the native token of Hyperliquid \u2014 a high-performance on-chain perpetual futures exchange running on its own purpose-built layer-1. It combines centralized-exchange-grade performance with on-chain transparency, and launched with one of the largest trader-targeted airdrops in crypto history.',
  PYUSD:  'PayPal USD (PYUSD) is a regulated stablecoin issued by Paxos on behalf of PayPal, pegged 1:1 to the US dollar and backed by cash and short-term US Treasuries. It integrates directly with PayPal and Venmo balances, giving crypto stablecoins one of the largest mainstream distribution channels.',
  ETC:    'Ethereum Classic (ETC) is the original Ethereum chain that refused to fork after the 2016 DAO hack, preserving the "code is law" principle of immutability. It remains proof-of-work with a capped supply of ~210M tokens. Development and ecosystem activity are far smaller than Ethereum\'s.',
  KAS:    'Kaspa (KAS) is a proof-of-work layer-1 that uses the GhostDAG protocol \u2014 a block-DAG instead of a linear chain \u2014 enabling one-second blocks with high throughput. It\'s one of the purer PoW projects: no ICO, no pre-mine, no VC allocation. Backers value it for its decentralization ethos.',
  OKB:    'OKB is the utility token of the OKX exchange, one of the largest global crypto trading platforms. Holders receive trading fee discounts, voting rights on listings, and Launchpad access. OKX conducts regular buyback-and-burns using exchange revenue to reduce supply toward 21M.',
  TUSD:   'TrueUSD (TUSD) is a stablecoin pegged 1:1 to the US dollar, backed by fiat reserves held in escrow accounts with real-time on-chain attestations. It was one of the earliest regulated stablecoins with live proof-of-reserves, though liquidity has declined relative to USDC and USDT.',
  KCS:    'KuCoin Token (KCS) is the utility token of the KuCoin exchange. Holders receive daily trading fee discounts, a share of exchange revenue (KCS Bonus), and Launchpad access. KuCoin burns KCS quarterly toward a target supply of 100M tokens.',
  GT:     'GateToken (GT) is the utility token of Gate.io exchange. It unlocks trading fee discounts, VIP tiers, and Startup (IEO) access. Gate.io uses 20-30% of quarterly profits to buy back and burn GT, creating ongoing deflationary pressure.',
  USDD:   'USDD is a stablecoin on the TRON blockchain pegged to the US dollar through an over-collateralized crypto reserve system managed by the TRON DAO Reserve (Justin Sun\'s initiative). It offers high yields in DeFi (~12-20% APR) but has faced peg stress during market volatility.',
  USDY:   'Ondo US Dollar Yield (USDY) is a tokenized wrapper around short-term US Treasuries and bank deposits, available to non-US holders. Yield (~5% APR) accrues directly into the token\'s price, effectively turning it into a yield-bearing stablecoin for international users.',
  RLUSD:  'Ripple USD (RLUSD) is Ripple\'s enterprise-grade stablecoin pegged 1:1 to the US dollar, issued on both the XRP Ledger and Ethereum. Backed by cash and short-term US Treasuries with monthly attestations, it\'s targeted at cross-border payments and institutional settlement.',
  MORPHO: 'Morpho is a DeFi lending optimizer that improves rates on top of Aave and Compound by matching lenders and borrowers peer-to-peer when possible, with the underlying pool as fallback. Its newer Morpho Blue is a minimalist primitive for building custom, isolated lending markets.',
  JUP:    'Jupiter (JUP) is the dominant DEX aggregator on Solana \u2014 routing trades across every major Solana DEX to find the best price. It\'s among the most-used protocols on Solana by daily volume and launched with one of the largest community airdrops to active traders.',
  FLR:    'Flare (FLR) is a layer-1 blockchain focused on delivering on-chain data \u2014 especially price feeds and cross-chain state \u2014 to smart contracts. Its native FTSO (Flare Time Series Oracle) lets delegators earn yield by providing data, aligning token value with oracle usage.',
  USDE:   'Ethena USDe is a synthetic dollar backed by delta-neutral hedges: long stablecoin/ETH collateral offset by short perpetual futures. Staked USDe (sUSDe) captures funding-rate yield of ~10-25% APR. It carries smart contract risk and funding-rate risk when market conditions invert.',
  USDS:   'Sky Dollar (USDS) is the successor to DAI, issued by Sky (formerly MakerDAO). Like DAI it\'s over-collateralized and decentralized, but offers the Sky Savings Rate (SSR) for native on-chain yield. DAI holders can convert to USDS 1:1 within the Sky ecosystem.',
  GHO:    'GHO is Aave\'s native over-collateralized stablecoin pegged to the US dollar. Borrowers mint GHO by supplying crypto to Aave and pay interest directly to the protocol treasury \u2014 rather than to third-party lenders \u2014 redirecting lending economics to AAVE stakeholders.',
  MNT:    'Mantle (MNT) is an Ethereum layer-2 with a modular architecture separating execution, consensus, and data availability. It has one of the largest L2 treasuries (inherited from the BitDAO merger), which funds ecosystem growth and native yield products like mETH.',

  BUIDL:  'BUIDL is BlackRock\'s USD Institutional Digital Liquidity Fund \u2014 a tokenized money-market fund launched in 2024 on Ethereum in partnership with Securitize. Backed by cash, US Treasuries, and repo agreements, with yield accruing daily. It\'s one of the most significant institutional signals in crypto real-world assets.',
  OUSG:   'Ondo Short-Term US Government Bond Fund (OUSG) is a tokenized Treasury product by Ondo Finance, aimed at qualified investors. Backed by short-duration US Treasuries and bank deposits, it yields ~4-5% APR that accrues directly into the token price \u2014 bringing traditional fixed-income exposure on-chain.',
  USTB:   'Superstate Short Duration US Government Securities Fund (USTB) is a tokenized Treasury fund from Superstate, founded by Compound creator Robert Leshner. Backed by short-term US Treasuries and targeting institutional investors, yield accrues to the token price, similar to a money-market fund.',
  USDTB:  'USDtb is Ethena\'s fully-collateralized stablecoin backed primarily by BlackRock\'s BUIDL fund alongside USDC and T-bills. Unlike its sibling USDe (which uses perpetual-futures hedges), USDtb targets a lower-risk profile using reserve-backed collateral.',
  USDG:   'Global Dollar (USDG) is a stablecoin issued by Paxos under the Global Dollar Network \u2014 a consortium including Robinhood, Kraken, Galaxy, Nuvei, and Bullish. Backed 1:1 by cash and US Treasuries. Unusually, it shares reserve revenue with participating distributors rather than keeping it at the issuer.',
  PI:     'Pi Network (PI) is a mobile-first cryptocurrency launched in 2019 that lets users "mine" PI via a daily tap in the Pi app. It boasts 100M+ registered users but only went live on open mainnet in 2025. It\'s widely discussed and equally controversial \u2014 critics have compared its referral-based growth model to MLM patterns.',
  XDC:    'XDC Network (XDC) is an enterprise-focused layer-1 specialized in trade finance, supply chain, and cross-border payments. It uses a hybrid delegated proof-of-stake consensus with permissioned validators. Partners include major banks digitizing trade documents on-chain.',
  PUMP:   'Pump (PUMP) is the token of Pump.fun \u2014 the dominant meme-coin launchpad on Solana and responsible for a significant share of daily Solana memecoin volume. PUMP holders receive fee-share revenue from the platform\'s trading activity, making it a direct play on Solana memecoin culture.',
  BGB:    'Bitget Token (BGB) is the utility token of Bitget, one of the larger global crypto derivatives exchanges. It offers trading fee discounts, Launchpad access, and passive rewards through BGB Earn. Bitget regularly burns BGB using exchange profits to reduce supply.',
  HTX:    'HTX (formerly Huobi) Token is the native token of HTX exchange, relaunched under the HTX brand with Justin Sun\'s involvement. It provides trading fee discounts, voting on listings, and Launchpad access. Its value is tied to the exchange\'s volume and regulatory posture.',
  JST:    'JUST (JST) is the governance token of the JustLend and USDJ ecosystem on TRON \u2014 TRON\'s flagship DeFi lending protocol. Its value tracks TRON DeFi activity, particularly stablecoin lending and borrowing against TRX collateral.',
  SKY:    'Sky (SKY) is the governance token of the Sky protocol \u2014 the rebranded successor to MakerDAO following the 2024 "Endgame" overhaul. SKY replaces MKR (existing MKR holders can convert 1 MKR to 24,000 SKY) and governs risk parameters, stability fees, and protocol upgrades for the USDS stablecoin.',
  WLFI:   'World Liberty Financial (WLFI) is a DeFi project backed by the Trump family, focused on stablecoins (USD1), lending, and asset management. It is high-profile and polarizing \u2014 its rapid growth is driven largely by political-crypto affinity rather than technical differentiation, and insider allocation is concentrated.',
  USD1:   'USD1 is a stablecoin issued by World Liberty Financial (the Trump-family-backed DeFi venture), pegged 1:1 to the US dollar and backed by cash and short-term Treasuries. It launched in 2025 and saw rapid adoption driven largely by political-crypto affinity.',
  DEXE:   'DeXe is a decentralized DAO infrastructure platform \u2014 it provides tools for creating, governing, and managing DAOs, including proposal/voting flows, treasury management, and compliance modules. The DEXE token is used for governance and utility within the DAO toolkit.',
  FIGR_HELOC: 'FIGR_HELOC represents tokenized home equity lines of credit (HELOCs) originated by Figure Technologies, a major US fintech lender. Each token is backed by real HELOC receivables that yield interest to holders. It runs on the Provenance blockchain \u2014 a landmark real-world-asset (RWA) token bringing private credit on-chain.',
  HASH:   'Provenance Blockchain (HASH) is a Cosmos-based layer-1 built for regulated financial services \u2014 tokenizing loans, real estate, private equity, and Figure\'s HELOC products. It\'s one of the most actively-used RWA blockchains by on-chain volume. HASH is used for staking, fees, and governance.',
  USD0:   'USD0 is Usual Protocol\'s permissionless stablecoin, backed by short-term US Treasury bills and redeemable 1:1 for its underlying RWA collateral. It\'s the foundation for USD0++ (the locked, yield-earning version that distributes USUAL token rewards), aiming to democratize RWA yield.',
  NIGHT:  'Midnight (NIGHT) is a privacy-focused Cardano sidechain using zero-knowledge proofs \u2014 designed for regulated enterprise use cases that require selective data privacy. Built by Charles Hoskinson\'s IOG team. NIGHT pairs with DUST, the utility token used for protocol operations.',

  WBT:    'WhiteBIT Token (WBT) is the utility token of WhiteBIT, a European-regulated crypto exchange headquartered in Lithuania. It provides trading fee discounts, staking rewards (via WhiteBIT Earn), and access to Launchpad offerings. WhiteBIT burns WBT quarterly using exchange revenue.',
  CC:     'Canton (CC) is the native token of Canton Network \u2014 a privacy-enabled public blockchain built on Digital Asset\'s DAML smart-contract language. It targets regulated financial institutions that need selective on-chain privacy (trades visible only to counterparties and regulators). Backers include Goldman Sachs, BNY Mellon, and Deloitte.',
  USYC:   'Hashnote US Yield Coin (USYC) is a tokenized money-market fund by Hashnote, offering qualified investors exposure to short-term US Treasuries and reverse repo. Yield (~4-5% APR) accrues into the token price. It\'s one of the larger tokenized T-bill products by AUM on-chain.',
  BFUSD:  'BFUSD is Binance\'s yield-bearing stablecoin, backed by collateralized futures positions. Holders earn ongoing yield on their balance \u2014 derived from the trading strategies Binance runs on the underlying collateral. It\'s available to Binance users and targets passive on-exchange income.',
  BDX:    'Beldex (BDX) is a privacy-focused layer-1 built on CryptoNote (the same foundation as Monero). Its ecosystem includes BChat (encrypted messenger), BelNet (decentralized VPN), and BelBrowser \u2014 all using BDX as the payment unit. Staking via masternodes earns yield from block rewards.',
  ASTER:  'Aster (ASTER) is a BNB-Chain-based perpetual-futures DEX (formerly APX Finance), focused on leveraged trading with deep liquidity and low fees. ASTER holders can stake for fee-share rewards. It became notable for its large airdrop and rapid rise in perpetual-futures volume after a 2025 rebrand.',
  JTRSY:  'Janus Henderson Anemoy Treasury Fund (JTRSY) is a tokenized US Treasury fund from Janus Henderson, the global asset manager, structured via Anemoy Capital. It\'s restricted to qualified investors and brings institutional-grade fixed income on-chain with regulated custody and auditing.',
  KAIA:   'Kaia (KAIA) is an Asia-focused layer-1 blockchain formed by the 2024 merger of Klaytn (Kakao-backed) and Finschia (LINE-backed). It integrates directly with LINE\'s 200M+ users and KakaoTalk, giving it one of the largest built-in consumer audiences of any chain. Targets consumer finance, messaging payments, and gaming.',
};

// ── Coin Features ───────────────────────────────────────────────────────────
export const COIN_FEATURES: Record<string, string[]> = {
  KAU: ['Gold Backed', '1 Gram Per Token', 'Yield Streams', 'Coin Holder Yield', 'Minters Yield', 'Referrers Yield', 'Depositers Yield'],
  KAG: ['Silver Backed', '1 Troy Ounce Per Token', 'Yield Streams: Coin Holders, Minters, Referrers, Depositers'],
};

// ── Yield Types ─────────────────────────────────────────────────────────────
export const COIN_YIELD_TYPES: Record<string, any> = {
  // ── Layer 1 Staking ─────────────────────────────────────────
  ETH:    ['Staking (~3-4% APR)', 'Lending (via DeFi)', 'Restaking (EigenLayer)'],
  SOL:    ['Staking (~6-7% APR)', 'Lending (via DeFi)', 'Liquid Staking (mSOL/jitoSOL)'],
  BTC:    ['Mining', 'Lending (via DeFi)', 'Wrapped BTC Yield (wBTC in DeFi)'],
  DOT:    ['Staking (~12-15% APR)', 'Crowdloans', 'Liquid Staking'],
  ATOM:   ['Staking (~15-20% APR)', 'LP Incentives (Osmosis)', 'Airdrops (Cosmos ecosystem)'],
  ADA:    ['Staking (~3-5% APR)', 'Lending (via DeFi)'],
  AVAX:   ['Staking (~8-9% APR)', 'Lending (via DeFi)', 'Subnet Validation'],
  NEAR:   ['Staking (~5-6% APR)', 'Lending (via Burrow)'],
  TON:    ['Staking (~3-5% APR)', 'Lending (via DeFi)'],
  TRX:    ['Staking (~4-5% APR)', 'Energy/Bandwidth Rewards'],
  HBAR:   ['Staking (~6% APR)'],
  ICP:    ['Staking (Neuron Locking ~8-10% APR)', 'Governance Rewards'],
  FIL:    ['Storage Provider Rewards', 'Lending (via DeFi)'],
  SUI:    ['Staking (~3-4% APR)', 'Lending (via DeFi)'],
  APT:    ['Staking (~7% APR)', 'Lending (via DeFi)'],
  SEI:    ['Staking (~5-6% APR)'],
  INJ:    ['Staking (~15-17% APR)', 'Burn Auction', 'LP Incentives'],
  XTZ:    ['Staking (Baking ~5-6% APR)', 'Lending (via DeFi)'],
  EGLD:   ['Staking (~7-10% APR)', 'Liquid Staking', 'Lending (via Hatom)'],
  FTM:    ['Staking (~6-13% APR)', 'Lending (via DeFi)'],
  MINA:   ['Staking (~12% APR)'],
  FLOW:   ['Staking (~5-8% APR)'],
  ROSE:   ['Staking (~8-10% APR)'],
  CELO:   ['Staking (~5-6% APR)', 'Lending (via Moola)'],
  ONE:    ['Staking (~8-10% APR)'],
  ASTR:   ['Staking (dApp Staking ~8-10% APR)'],
  GLMR:   ['Staking (~10-12% APR)'],
  XDC:    ['Staking (~8-10% APR)'],
  IOTA:   ['Staking (~6-8% APR)'],
  ZIL:    ['Staking (~12-14% APR)'],
  EOS:    ['Staking (~3% APR)', 'REX Lending'],
  KAS:    ['Mining'],
  XMR:    ['Mining (Privacy Chain)'],
  ZEC:    ['Mining'],
  LTC:    ['Mining', 'Lending (via DeFi)'],
  BCH:    ['Mining'],
  DOGE:   ['Mining (merged with LTC)'],
  DASH:   ['Masternodes (~6-8% APR)', 'Mining'],
  DCR:    ['Staking (~7-8% APR)', 'Mining (Hybrid PoW/PoS)'],

  // ── Layer 2 / Rollups ───────────────────────────────────────
  ARB:    ['Staking (~5-8% APR)', 'Lending (via DeFi)', 'LP Incentives'],
  OP:     ['Staking (~4-6% APR)', 'Lending (via DeFi)'],
  MATIC:  ['Staking (~4-5% APR)', 'Lending (via Aave)'],
  POL:    ['Staking (~4-5% APR)', 'Lending (via Aave)'],
  MNT:    ['Staking', 'Lending (via DeFi)'],
  STX:    ['Stacking (~8-10% APR, paid in BTC)'],
  IMX:    ['Staking', 'Trading Fee Rewards'],
  LRC:    ['Liquidity Provision (LP Fees)', 'Staking'],

  // ── DeFi Lending ────────────────────────────────────────────
  AAVE:   ['Lending Interest', 'Staking (Safety Module ~6% APR)', 'Governance', 'Flash Loan Fees'],
  COMP:   ['Lending Interest', 'Governance'],
  MKR:    ['Lending Interest (DSR)', 'Governance', 'Burn Mechanism'],
  SKY:    ['Lending Interest (DSR)', 'Governance'],
  KAVA:   ['Staking (~15-20% APR)', 'Lending (Kava Lend)'],
  NEXO:   ['Lending Interest', 'Staking (~12% APR)', 'Cashback Rewards'],

  // ── DEX / LP ────────────────────────────────────────────────
  UNI:    ['Liquidity Provision (LP Fees)', 'Governance'],
  CRV:    ['Liquidity Provision (LP Fees)', 'Vote-Locking (veCRV)', 'Bribe Revenue'],
  SUSHI:  ['Liquidity Provision (LP Fees)', 'Staking (xSUSHI)'],
  CAKE:   ['Liquidity Provision (LP Fees)', 'Staking (~3-5% APR)', 'IFO Access'],
  JUP:    ['Liquidity Provision', 'Governance'],
  RUNE:   ['Liquidity Provision (~8-15% APR)', 'Dual-sided LP'],
  RAY:    ['Liquidity Provision (LP Fees)', 'Staking', 'AcceleRaytor'],
  ORCA:   ['Liquidity Provision (LP Fees)'],
  '1INCH': ['Staking (Fusion)', 'Governance'],
  DYDX:   ['Staking (~15-20% APR)', 'Fee Revenue Share', 'Trading Fee Discounts'],
  GMX:    ['Staking (~5-10% APR)', 'Fee Revenue Share (esGMX)', 'Multiplier Points'],
  BLUR:   ['Lending (Blend)', 'LP Incentives', 'Trading Fee Rewards'],

  // ── Kinesis ─────────────────────────────────────────────────
  KAU:    ['Coin Holder Yield', 'Minters Yield', 'Referrers Yield', 'Depositers Yield'],
  KAG:    ['Coin Holder Yield', 'Minters Yield', 'Referrers Yield', 'Depositers Yield'],

  // ── Stablecoins ─────────────────────────────────────────────
  DAI:    ['DSR Savings Rate (~5-8%)', 'Lending (via DeFi)'],
  USDS:   ['Sky Savings Rate'],
  FRAX:   ['Staking (sFRAX)', 'Lending (Fraxlend)'],
  USDT:   ['Lending (via DeFi)', 'LP Pair Incentives'],
  USDC:   ['Lending (via DeFi)', 'LP Pair Incentives'],
  PYUSD:  ['Lending (via DeFi)'],
  FDUSD:  ['Binance Launchpool'],

  // ── Liquid Staking / Restaking ──────────────────────────────
  STETH:  ['Staking Yield (~3-4% APR)', 'Lending (via DeFi)', 'Restaking (EigenLayer)'],
  WSTETH: ['Staking Yield (~3-4% APR)', 'Lending (via DeFi)', 'Restaking (EigenLayer)'],
  RETH:   ['Staking Yield (~3-4% APR)', 'Lending (via DeFi)'],
  CBETH:  ['Staking Yield (~3-4% APR)', 'Lending (via DeFi)'],
  MSOL:   ['Staking Yield (~6-7% APR)', 'Lending (via DeFi)'],
  JITOSOL: ['Staking Yield (~7-8% APR)', 'MEV Rewards'],
  EIGEN:  ['Restaking', 'AVS Operator Rewards'],
  LDO:    ['Staking Rebates', 'Governance'],
  RPL:    ['Node Operator Rewards (~5-7% APR)', 'Protocol Revenue'],
  SSV:    ['Staking (Validator Rewards)'],

  // ── Yield / DeFi Infrastructure ─────────────────────────────
  PENDLE: ['Yield Tokenization', 'LP Fees', 'vePENDLE Voting'],
  ENA:    ['Staking (sUSDe ~10-25% APR)', 'Points/Airdrop Farming'],
  YFI:    ['Vault Yield Optimization', 'Governance'],
  SNX:    ['Staking (~15-30% APR)', 'Fee Revenue Share', 'Perps Fee Share'],
  LQTY:   ['Stability Pool (~5-8% APR)', 'Protocol Revenue'],
  MAGIC:  ['Staking (~15-20% APR)'],

  // ── Exchange / Platform Tokens ──────────────────────────────
  BNB:    ['Burn Mechanism', 'Launchpool Staking', 'Gas Fee Discounts', 'Lending (via Venus)'],
  CRO:    ['Staking (~10-12% APR)', 'Cashback Rewards'],
  LEO:    ['Burn Mechanism'],
  FTT:    ['Burn Mechanism'],
  FTN:    ['Staking'],

  // ── Oracle / Infrastructure ─────────────────────────────────
  LINK:   ['Staking (~4-5% APR)', 'Node Operator Rewards'],
  BAND:   ['Staking (~12-15% APR)'],
  PYTH:   ['Staking (Governance)', 'Publisher Rewards'],
  GRT:    ['Delegation (~10-12% APR)', 'Indexer Rewards', 'Curator Fees'],
  AXL:    ['Staking (~6-8% APR)'],
  QNT:    ['Gateway Staking', 'Enterprise License Revenue'],
  ANKR:   ['Staking (Node Provision)', 'Liquid Staking'],

  // ── AI / Compute ────────────────────────────────────────────
  FET:    ['Staking (~7-10% APR)', 'Agent Hosting Rewards'],
  RENDER: ['Node Operator Rewards', 'GPU Compute Revenue'],
  RNDR:   ['Node Operator Rewards', 'GPU Compute Revenue'],
  TAO:    ['Subnet Mining', 'Staking (~12-18% APR)', 'Validator Rewards'],
  AGIX:   ['Staking (AI Marketplace)'],
  OCEAN:  ['Data Staking', 'Data Marketplace Fees'],
  AR:     ['Storage Mining', 'Permanent Data Fees'],

  // ── IoT / Physical Infrastructure ───────────────────────────
  HNT:    ['Mining (IoT Hotspot)', 'Staking'],
  MOBILE: ['Mining (5G Coverage)'],
  IOT:    ['Mining (IoT Sensors)'],
  VET:    ['Passive VTHO Generation', 'Authority Node Rewards'],
  THETA:  ['Staking (~5% APR)', 'Edge Node Rewards (TFUEL)'],
  JASMY:  ['Data Provision Rewards'],

  // ── Gaming / Metaverse ──────────────────────────────────────
  AXS:    ['Staking (~30-50% APR)', 'Play-to-Earn'],
  SAND:   ['Staking', 'Land Yield', 'Creator Rewards'],
  MANA:   ['Governance', 'Land Rental Income'],
  GALA:   ['Node Operator Rewards', 'Play-to-Earn'],
  ENJ:    ['Staking (Efinity)', 'NFT Marketplace Fees'],
  APE:    ['Staking (ApeStake)', 'Otherside Ecosystem'],
  SUPER:  ['Staking', 'Play-to-Earn'],

  // ── Privacy / Payments ──────────────────────────────────────
  XRP:    ['AMM Liquidity Provision', 'Lending (via DeFi)'],
  XLM:    ['Lending (via DeFi)', 'Anchored Asset Yield'],
  NEO:    ['Passive GAS Generation', 'Governance'],

  // ── Social / Identity ───────────────────────────────────────
  ENS:    ['Governance', 'Domain Registration Revenue'],
  BAT:    ['Brave Rewards (Ad Revenue)', 'Creator Tipping'],
  WLD:    ['Governance'],
  AUDIO:  ['Staking (Node Operator)', 'Governance', 'Artist Tipping'],
  CHZ:    ['Staking', 'Fan Token Revenue'],

  // ── Meme Coins ──────────────────────────────────────────────
  SHIB:   ['Staking (ShibaSwap)', 'Burn Mechanism (SHIB Burns)'],
  PEPE:   ['Liquidity Provision (LP Fees)'],
  BONK:   ['Liquidity Provision (LP Fees)'],
  FLOKI:  ['Staking (FlokiFi)', 'NFT Marketplace'],
  WIF:    ['Liquidity Provision (LP Fees)'],
  TRUMP:  ['Liquidity Provision (LP Fees)'],
  PENGU:  ['Liquidity Provision (LP Fees)'],

  // ── Misc DeFi ───────────────────────────────────────────────
  OSMO:   ['Staking (~10-12% APR)', 'LP Incentives', 'Superfluid Staking'],
  TIA:    ['Staking (~10-15% APR)', 'Data Availability Fees'],
  JTO:    ['Staking (~7% APR)', 'MEV Revenue'],
  ONDO:   ['RWA Yield (Treasury Yield ~4-5%)'],
  WBTC:   ['Lending (via DeFi)', 'LP Pair Incentives'],
  PAXG:   ['Lending (via DeFi)'],
  ALGO:   ['Governance Rewards', 'DeFi Lending'],
};

// ── Yield-income helpers ────────────────────────────────────────────────────
// Parse an APR percentage from a yield-type label. Handles "3-4%", "~5%",
// "3.5%" etc. For ranges, returns the midpoint. Returns null if no % found.
export function _parseYieldApr(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/(\d+(?:\.\d+)?)\s*(?:[-\u2013]\s*(\d+(?:\.\d+)?))?\s*%/);
  if (!m) return null;
  const low = parseFloat(m[1]);
  const high = m[2] ? parseFloat(m[2]) : null;
  return high !== null ? (low + high) / 2 : low;
}

// Highest parseable APR across a coin's yield types — picks the best available.
export function coinYieldApr(sym: string): number | null {
  const yields = COIN_YIELD_TYPES[sym];
  if (!yields) return null;
  const labels: string[] = Array.isArray(yields) ? yields : [yields];
  const rates = labels.map(_parseYieldApr).filter((r): r is number => r !== null);
  return rates.length ? Math.max(...rates) : null;
}

// ── Transfer-fee tiers (1 = cheapest, 5 = most expensive) ──────────────────
// Reflects typical on-chain transfer cost on the coin's primary chain:
//   1: fractions of a cent     (XRP, XLM, HBAR, ALGO)
//   2: sub-cent to few cents   (Solana, Cosmos, Polygon, Tron, LTC, DOGE)
//   3: cents to low dollars    (BNB Chain, Avalanche, Cardano, Ethereum L2s)
//   4: low dollars             (Bitcoin, Ethereum native transfers)
//   5: several dollars+        (ERC-20 tokens & DeFi on Ethereum L1)
export const COIN_FEE_TIERS: Record<string, any> = {
  // Tier 1 — essentially free
  XRP: 1, XLM: 1, HBAR: 1, ALGO: 1, IOTA: 1, ICP: 1, PI: 1,

  // Tier 2 — very cheap
  SOL: 2, JUP: 2, BONK: 2, WIF: 2, PYTH: 2, JTO: 2, RAY: 2, PENGU: 2, TRUMP: 2,
  XMR: 2, LTC: 2, DOGE: 2, BCH: 2, DASH: 2, ZEC: 2, DCR: 2, BDX: 2,
  ATOM: 2, OSMO: 2, TIA: 2, INJ: 2, KAVA: 2,
  NEAR: 2, TON: 2, TRX: 2, KAS: 2, SUI: 2, APT: 2, SEI: 2,
  XTZ: 2, VET: 2, FTM: 2, HYPE: 2, FLR: 2, XDC: 2,
  MATIC: 2, POL: 2, FET: 2, AGIX: 2, OCEAN: 2,
  KAIA: 2, ADA: 2, JST: 2, USDD: 2, NIGHT: 2, BTT: 2,
  HASH: 2, FIGR_HELOC: 2,

  // Tier 3 — cents to low dollars
  BNB: 3, CAKE: 3, AVAX: 3, DOT: 3, RUNE: 3, FIL: 3, ETC: 3,
  ARB: 3, OP: 3, MNT: 3, EIGEN: 3, GMX: 3, IMX: 3, WLD: 3,
  HNT: 3, STX: 3, CC: 3, ASTER: 3, PUMP: 2, BGB: 3,

  // Tier 4 — a few dollars on a bad day
  BTC: 4, ETH: 4, WBTC: 4, STETH: 4, WSTETH: 4, RETH: 4,

  // Tier 5 — Ethereum L1 ERC-20s and DeFi
  LINK: 5, UNI: 5, AAVE: 5, MKR: 5, CRV: 5, COMP: 5, SNX: 5,
  LDO: 5, ENS: 5, GRT: 5, SHIB: 5, PEPE: 5, FLOKI: 5,
  MORPHO: 5, ONDO: 5, GHO: 5, PENDLE: 5, ENA: 5, DYDX: 5,
  RENDER: 5, QNT: 5, NEXO: 5, USDE: 5, USDS: 5, SKY: 5, FRAX: 5,
  DAI: 5, USDT: 5, USDC: 5, PYUSD: 5, TUSD: 5, RLUSD: 5,
  BUIDL: 5, OUSG: 5, USTB: 5, USDTB: 5, USDG: 5, USDY: 5, JTRSY: 5, USYC: 5, BFUSD: 5,
  OKB: 5, KCS: 5, GT: 5, LEO: 5, HTX: 5, WBT: 5,
  BLUR: 5, BAT: 5, SUSHI: 5, YFI: 5, DEXE: 5,
  JASMY: 5, GALA: 5, SAND: 5, MANA: 5, AXS: 5, CHZ: 5, APE: 5, ANKR: 5, ENJ: 5, SSV: 5,
  TAO: 2, AR: 2, PAXG: 5, XAUT: 5, KAU: 5, KAG: 5,
};

export function fmtCoinFees(sym: string) {
  const tier = COIN_FEE_TIERS[sym];
  if (!tier) return '—';
  return '$'.repeat(tier);
}

// Format annual income on $100 principal.
// - "None"         → coin has no yield types listed (matches Yield Types column)
// - "incalculable" → yields exist but no APR is parseable (e.g. Mining, Lending)
// - "$X.XX / yr"   → APR parsed from a yield label
export function fmtYieldIncome(sym: string, principal = 100) {
  if (!COIN_YIELD_TYPES[sym]) return 'None';
  const apr = coinYieldApr(sym);
  if (apr == null) return 'incalculable';
  return '$' + ((principal * apr) / 100).toFixed(2) + ' / yr';
}

// ── Stablecoin symbol set (for marketplace filter) ──────────────────────────
export const STABLECOIN_SYMBOLS: Set<string> = new Set([
  'USDT','USDC','DAI','PYUSD','USDP','TUSD','BUSD','FDUSD','GUSD','USDS','USD0','FRAX','USDD','LUSD','CRVUSD','SUSD',
]);
