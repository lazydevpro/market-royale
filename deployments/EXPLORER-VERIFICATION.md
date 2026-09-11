# Explorer source verification

Checked on 11 September 2026 against the Somnia Shannon explorer API. Every active Market Royale-owned contract instance is fully source verified; none is partial.

All project contracts were compiled with Solidity `0.8.28+commit.7893614a`, optimizer enabled with 200 runs, `viaIR: true`, and the Shanghai EVM target. Constructor arguments were recovered and matched by the explorer.

## Active contracts

| Contract | Address | Explorer result |
| --- | --- | --- |
| MarketRoyale V5 | [`0x4a17dc5e798e68060e6e8cadbf795531557880cd`](https://shannon-explorer.somnia.network/address/0x4a17dc5e798e68060e6e8cadbf795531557880cd) | Fully verified |
| MarketRoyaleProgression V4 | [`0xaecf844569aba92494947bc4edf8e268c31b5c54`](https://shannon-explorer.somnia.network/address/0xaecf844569aba92494947bc4edf8e268c31b5c54) | Fully verified |
| LiquiditySponsor | [`0x24a43ad7e9318cf515867477bf9c489989dcc701`](https://shannon-explorer.somnia.network/address/0x24a43ad7e9318cf515867477bf9c489989dcc701) | Fully verified |
| VaultFactory | [`0x24Ad3423E65e3a7D03F03e2bE8b695Eb822b15dF`](https://shannon-explorer.somnia.network/address/0x24Ad3423E65e3a7D03F03e2bE8b695Eb822b15dF) | Fully verified |

The sponsor was deployed with the V2 arena source in its compiler input. Its historical source was reconstructed from the deployment-time workspace record and checked byte-for-byte against both the creation and normalized runtime bytecode before submission.

## Active-arena player vaults

The V5 arena currently has 6 royales and 18 unique TraderVault deployments. Every vault is fully verified.

| Royale | Player | TraderVault |
| ---: | --- | --- |
| 1 | [`0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259`](https://shannon-explorer.somnia.network/address/0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259) | [`0x1dff654C6EFEd389BD84B2bC3192b69514cbfa62`](https://shannon-explorer.somnia.network/address/0x1dff654C6EFEd389BD84B2bC3192b69514cbfa62) |
| 1 | [`0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0`](https://shannon-explorer.somnia.network/address/0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0) | [`0x07Accd2437e2394EEa9e0Bb7c9804ae88E7D4033`](https://shannon-explorer.somnia.network/address/0x07Accd2437e2394EEa9e0Bb7c9804ae88E7D4033) |
| 1 | [`0x6C3162695B106F9F200057113bE7C60469C4A399`](https://shannon-explorer.somnia.network/address/0x6C3162695B106F9F200057113bE7C60469C4A399) | [`0x9097af184DdbCD8629ca493624706294228f3739`](https://shannon-explorer.somnia.network/address/0x9097af184DdbCD8629ca493624706294228f3739) |
| 1 | [`0x32840FF1c9fCDF3862D420B9FB5927Ce24e92Cbd`](https://shannon-explorer.somnia.network/address/0x32840FF1c9fCDF3862D420B9FB5927Ce24e92Cbd) | [`0x9e6AD0B58750D9d0Ce02A7B940Aee7AcfD8c0F33`](https://shannon-explorer.somnia.network/address/0x9e6AD0B58750D9d0Ce02A7B940Aee7AcfD8c0F33) |
| 2 | [`0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259`](https://shannon-explorer.somnia.network/address/0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259) | [`0x920074A8FC756959675b8e717066Ec70983cf255`](https://shannon-explorer.somnia.network/address/0x920074A8FC756959675b8e717066Ec70983cf255) |
| 2 | [`0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0`](https://shannon-explorer.somnia.network/address/0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0) | [`0xff082FF35d2d04EFF5a72C86012b9B21249663EF`](https://shannon-explorer.somnia.network/address/0xff082FF35d2d04EFF5a72C86012b9B21249663EF) |
| 2 | [`0x6C3162695B106F9F200057113bE7C60469C4A399`](https://shannon-explorer.somnia.network/address/0x6C3162695B106F9F200057113bE7C60469C4A399) | [`0x0a0573Bd89d8F35202B02a56E9ac8ca4f37511dC`](https://shannon-explorer.somnia.network/address/0x0a0573Bd89d8F35202B02a56E9ac8ca4f37511dC) |
| 2 | [`0x32840FF1c9fCDF3862D420B9FB5927Ce24e92Cbd`](https://shannon-explorer.somnia.network/address/0x32840FF1c9fCDF3862D420B9FB5927Ce24e92Cbd) | [`0x0f6383DfAAa0e8E81Aba1350B2f11d14E83eF541`](https://shannon-explorer.somnia.network/address/0x0f6383DfAAa0e8E81Aba1350B2f11d14E83eF541) |
| 3 | [`0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259`](https://shannon-explorer.somnia.network/address/0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259) | [`0x987be83b045AAe8cA3E1D4743bDeB16B3f42D1F2`](https://shannon-explorer.somnia.network/address/0x987be83b045AAe8cA3E1D4743bDeB16B3f42D1F2) |
| 3 | [`0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0`](https://shannon-explorer.somnia.network/address/0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0) | [`0x65FC38600CbbD0304f7ebb1dd6769b25D5bE75CE`](https://shannon-explorer.somnia.network/address/0x65FC38600CbbD0304f7ebb1dd6769b25D5bE75CE) |
| 3 | [`0x6C3162695B106F9F200057113bE7C60469C4A399`](https://shannon-explorer.somnia.network/address/0x6C3162695B106F9F200057113bE7C60469C4A399) | [`0xd5c747a0a4182e1fb4b501B6b64a1Ed0Ec876299`](https://shannon-explorer.somnia.network/address/0xd5c747a0a4182e1fb4b501B6b64a1Ed0Ec876299) |
| 4 | [`0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259`](https://shannon-explorer.somnia.network/address/0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259) | [`0x118b4F751a97126b8a4033e1E1753f3eA04Ae697`](https://shannon-explorer.somnia.network/address/0x118b4F751a97126b8a4033e1E1753f3eA04Ae697) |
| 5 | [`0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259`](https://shannon-explorer.somnia.network/address/0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259) | [`0x45a0a69275869c56DBFA6CEA1552Fe93d8ff4f44`](https://shannon-explorer.somnia.network/address/0x45a0a69275869c56DBFA6CEA1552Fe93d8ff4f44) |
| 5 | [`0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0`](https://shannon-explorer.somnia.network/address/0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0) | [`0x2E8fc4DB3d7A072E673E0cafe18D0b9C24B0c551`](https://shannon-explorer.somnia.network/address/0x2E8fc4DB3d7A072E673E0cafe18D0b9C24B0c551) |
| 6 | [`0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259`](https://shannon-explorer.somnia.network/address/0x8143FFD10c8fb63ce18E5672077f0Df1b9a33259) | [`0x027dd08123A4a1a5cffE64837179C88909F68A1a`](https://shannon-explorer.somnia.network/address/0x027dd08123A4a1a5cffE64837179C88909F68A1a) |
| 6 | [`0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0`](https://shannon-explorer.somnia.network/address/0x8FA9A665Df9933CE11Be8f1769b66180a55d41a0) | [`0x7d863dF4E7e87A98CB39B02A8122a18996E13351`](https://shannon-explorer.somnia.network/address/0x7d863dF4E7e87A98CB39B02A8122a18996E13351) |
| 6 | [`0x6C3162695B106F9F200057113bE7C60469C4A399`](https://shannon-explorer.somnia.network/address/0x6C3162695B106F9F200057113bE7C60469C4A399) | [`0x767fe91cF030EC7c3c77c3eb4877a54DBa7F6D16`](https://shannon-explorer.somnia.network/address/0x767fe91cF030EC7c3c77c3eb4877a54DBa7F6D16) |
| 6 | [`0x32840FF1c9fCDF3862D420B9FB5927Ce24e92Cbd`](https://shannon-explorer.somnia.network/address/0x32840FF1c9fCDF3862D420B9FB5927Ce24e92Cbd) | [`0x6081fdC2584A724311A6511e1d6d7AaaDcb4d83c`](https://shannon-explorer.somnia.network/address/0x6081fdC2584A724311A6511e1d6d7AaaDcb4d83c) |

## External DreamDEX dependencies

| Contract | Address | Explorer result |
| --- | --- | --- |
| TestUSDC | [`0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`](https://shannon-explorer.somnia.network/address/0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E) | Fully verified upstream |
| DreamDEX binary module proxy | [`0x3ecC694Cef705358864a646142ac17A90E29e388`](https://shannon-explorer.somnia.network/address/0x3ecC694Cef705358864a646142ac17A90E29e388) | External dependency; the explorer links a verified twin but currently reports this proxy instance as unverified |
| DreamDEX module implementation | [`0xdF87AC5C4760e2F1Dd78e054ce0629A26A4cA5cA`](https://shannon-explorer.somnia.network/address/0xdF87AC5C4760e2F1Dd78e054ce0629A26A4cA5cA) | External dependency; verification is owned by the DreamDEX deployment team |

The DreamDEX module and implementation were not deployed by Market Royale and are outside this repository's source-verification boundary.
