import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { Button, Card, Input, Radio } from "antd";
import * as bitcoin from "bitcoinjs-lib";
import * as MSign from "msigner";
// import * as ecc from "tiny-secp256k1";
import * as ecc from "@bitcoinerlab/secp256k1";
import axios from "axios";

bitcoin.initEccLib(ecc);

const instance = axios.create({
  baseURL: "https://mempool.space/testnet/api/",
  timeout: 30 * 1000,
  // headers: {'X-Custom-Header': 'foobar'}
});

var allInscriptions: any[] = [];

class ItemProviderCheck implements MSign.ItemProvider {
  getTokenByOutput(output: string): Promise<MSign.IOrdItem | null> {
    // throw new Error("Method not implemented.");
    const result = allInscriptions.filter((info) => info.output === output);
    var orderItem = null;
    if (result.length === 1) {
      orderItem = mapInscription2OrdItem(result[0]) as MSign.IOrdItem;
    }
    return orderItem as any;
  }
  getTokenById(tokenId: string): Promise<MSign.IOrdItem | null> {
    // throw new Error("Method not implemented.");
    const result = allInscriptions.filter(
      (info) => info.inscriptionId === tokenId
    );
    var orderItem = null;
    if (result.length === 1) {
      orderItem = mapInscription2OrdItem(result[0]) as MSign.IOrdItem;
    }
    return orderItem as any;
  }
}

const mapInscription2OrdItem = (inscription: any) => {
  return {
    id: inscription.inscriptionId,
    contentURI: inscription.content,
    contentType: inscription.contentType,
    contentPreviewURI: inscription.preview,
    sat: inscription.inscriptionNumber,
    satName: "",
    genesisTransaction: inscription.genesisTransaction,
    inscriptionNumber: inscription.inscriptionNumber,
    chain: "",
    owner: inscription.address,

    location: inscription.location,
    outputValue: inscription.outputValue,
    output: inscription.output,
    listed: false,
  };
};

function App(): JSX.Element {
  const [unisatInstalled, setUnisatInstalled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [publicKey, setPublicKey] = useState("");
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState({
    confirmed: 0,
    unconfirmed: 0,
    total: 0,
  });
  const [network, setNetwork] = useState("livenet");
  const [testList, setTestList] = useState<MSign.IListingState>();
  const [sellerSign, setSellerSign] = useState("");

  const [prepareDummyResult, setprepareDummyResult] = useState("");
  const [payResult, setPayResult] = useState("");

  // const [itemCheck, setItemCheck] = useState<MSign.ItemProvider>();
  var itemCheck = new ItemProviderCheck();
  var itemList = {} as MSign.IListingState;

  const getBasicInfo = async () => {
    const unisat = (window as any).unisat;
    const [address] = await unisat.getAccounts();
    setAddress(address);

    const publicKey = await unisat.getPublicKey();
    setPublicKey(publicKey);

    const balance = await unisat.getBalance();
    setBalance(balance);

    const network = await unisat.getNetwork();
    setNetwork(network);

    const result = await unisat.getInscriptions(0, Number.MAX_SAFE_INTEGER);
    allInscriptions = result.list;
  };

  const listInscription = async (inscription: any) => {
    setSellerSign("");
    itemList = {
      seller: {
        makerFeeBp: 0,
        sellerOrdAddress: address,
        price: 1500,
        ordItem: mapInscription2OrdItem(inscription),
        sellerReceiveAddress: address,
        signedListingPSBTBase64: "",
        // tapInternalKey: publicKey,
      },
    };

    // setTestList(itemList as MSign.IListingState);

    const info = await MSign.SellerSigner.generateUnsignedListingPSBTBase64(
      itemList
    );

    const psbt = bitcoin.Psbt.fromBase64(
      info.seller.unsignedListingPSBTBase64!
    );
    const psbtResult = await unisat.signPsbt(psbt.toHex(), {
      autoFinalized: false,
    });

    info.seller.signedListingPSBTBase64 =
      bitcoin.Psbt.fromHex(psbtResult).toBase64();
    itemList = info;
    setTestList(itemList);
    setSellerSign(itemList.seller.signedListingPSBTBase64!);
  };

  const prepareBuyerDummyUtxo = async () => {
    // let ret = await instance.get("address/" + address + "/utxo");

    const result = await unisat.getInscriptions(0, Number.MAX_SAFE_INTEGER);
    allInscriptions = result.list;

    // setprepareDummyResult(JSON.stringify(ret.data));

    // return;
    setprepareDummyResult("");
    const addressUtxos = await MSign.getAddressUtxos(address);

    const hasValidDummys = await MSign.BuyerSigner.checkDummyUtxos(
      addressUtxos,
      itemCheck
    );
    if (hasValidDummys) {
      setprepareDummyResult("already have dummy utxos");
      return;
    }

    const dummyPsbt =
      await MSign.BuyerSigner.generateUnsignedCreateDummyUtxoPSBTBase64(
        address,
        publicKey,
        addressUtxos,
        "fastestFee",
        itemCheck!
      );

    const psbt = bitcoin.Psbt.fromBase64(dummyPsbt);

    try {
      const psbtResult = await unisat.signPsbt(psbt.toHex(), {
        autoFinalized: true,
      });
      const result = await unisat.pushPsbt(psbtResult);
      setprepareDummyResult(result + ":" + psbtResult);

      // console.log(result);
    } catch (e) {
      setprepareDummyResult((e as any).message);
      // console.log(e);
    }
  };

  const buyInscription = async () => {
    const addressUtxos = await MSign.getAddressUtxos(address);
    setPayResult("");
    var buyItemList = {
      seller: testList!.seller,
      buyer: {
        takerFeeBp: 0,
        buyerAddress: address,
        buyerTokenReceiveAddress: address,
        buyerPublicKey: publicKey,
        feeRateTier: "fastestFee",
        buyerDummyUTXOs: (await MSign.BuyerSigner.selectDummyUTXOs(
          addressUtxos,
          itemCheck
        ))!,
        buyerPaymentUTXOs: (await MSign.BuyerSigner.selectPaymentUTXOs(
          addressUtxos,
          testList!.seller.price!,
          0,
          0,
          "",
          itemCheck
        ))!,
        unsignedBuyingPSBTBase64: "",
        signedBuyingPSBTBase64: "",
        mergedSignedBuyingPSBTBase64: "",
      },
    } as MSign.IListingState;
    // itemList = buyItemList;

    // setTestList({
    //   seller: testList?.seller!,
    //   buyer: {
    //     takerFeeBp: 0,
    //     buyerAddress: address,
    //     buyerTokenReceiveAddress: address,
    //     buyerPublicKey: publicKey,
    //     feeRateTier: "fastestFee",
    //     buyerDummyUTXOs: (await MSign.BuyerSigner.selectDummyUTXOs(
    //       addressUtxos,
    //       itemCheck
    //     ))!,
    //     buyerPaymentUTXOs: (await MSign.BuyerSigner.selectPaymentUTXOs(
    //       addressUtxos,
    //       testList?.seller.price!,
    //       0,
    //       0,
    //       "",
    //       itemCheck
    //     ))!,
    //     unsignedBuyingPSBTBase64: "",
    //     signedBuyingPSBTBase64: "",
    //     mergedSignedBuyingPSBTBase64: "",
    //   },
    // });

    const info = await MSign.BuyerSigner.generateUnsignedBuyingPSBTBase64(
      buyItemList
    );

    const buyPsbt = info?.buyer?.unsignedBuyingPSBTBase64;
    const psbt = bitcoin.Psbt.fromBase64(buyPsbt!);
    try {
      const psbtResult = await unisat.signPsbt(psbt.toHex(), {
        autoFinalized: false,
      });
      const signedPsbt = bitcoin.Psbt.fromHex(psbtResult);

      info.buyer!.signedBuyingPSBTBase64 = signedPsbt.toBase64();
      buyItemList = info;
      setTestList(buyItemList);

      const mergedPsbtB64 = MSign.BuyerSigner.mergeSignedBuyingPSBTBase64(
        info.seller.signedListingPSBTBase64!,
        info.buyer?.signedBuyingPSBTBase64!
      );
      const psbtFinal = bitcoin.Psbt.fromBase64(mergedPsbtB64);
      psbtFinal.finalizeAllInputs();

      const presult = await unisat.pushPsbt(psbtFinal.toHex());
      setPayResult(presult + ":" + psbtFinal.toHex());
    } catch (e) {
      setPayResult((e as any).message);
    }
  };

  const selfRef = useRef<{ accounts: string[] }>({
    accounts: [],
  });
  const self = selfRef.current;
  const handleAccountsChanged = (_accounts: string[]) => {
    if (self.accounts[0] === _accounts[0]) {
      // prevent from triggering twice
      return;
    }
    self.accounts = _accounts;
    if (_accounts.length > 0) {
      setAccounts(_accounts);
      setConnected(true);

      setAddress(_accounts[0]);

      getBasicInfo();
    } else {
      setConnected(false);
    }
  };

  const handleNetworkChanged = (network: string) => {
    setNetwork(network);
    getBasicInfo();
  };

  useEffect(() => {
    async function checkUnisat() {
      let unisat = (window as any).unisat;

      for (let i = 1; i < 10 && !unisat; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100 * i));
        unisat = (window as any).unisat;
      }

      if (unisat) {
        setUnisatInstalled(true);
      } else if (!unisat) return;

      unisat.getAccounts().then((accounts: string[]) => {
        handleAccountsChanged(accounts);
      });

      unisat.on("accountsChanged", handleAccountsChanged);
      unisat.on("networkChanged", handleNetworkChanged);

      return () => {
        unisat.removeListener("accountsChanged", handleAccountsChanged);
        unisat.removeListener("networkChanged", handleNetworkChanged);
      };
    }

    checkUnisat().then();
  }, []);

  if (!unisatInstalled) {
    return (
      <div className="App">
        <header className="App-header">
          <div>
            <Button
              onClick={() => {
                window.location.href = "https://unisat.io";
              }}
            >
              Install Unisat Wallet
            </Button>
          </div>
        </header>
      </div>
    );
  }
  const unisat = (window as any).unisat;
  return (
    <div className="App">
      <header className="App-header">
        <p>Unisat Wallet Demo</p>

        {connected ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Card
              size="small"
              title="Basic Info"
              style={{ width: 300, margin: 10 }}
            >
              <div style={{ textAlign: "left", marginTop: 10 }}>
                <div style={{ fontWeight: "bold" }}>Address:</div>
                <div style={{ wordWrap: "break-word" }}>{address}</div>
              </div>

              <div style={{ textAlign: "left", marginTop: 10 }}>
                <div style={{ fontWeight: "bold" }}>PublicKey:</div>
                <div style={{ wordWrap: "break-word" }}>{publicKey}</div>
              </div>

              <div style={{ textAlign: "left", marginTop: 10 }}>
                <div style={{ fontWeight: "bold" }}>Balance: (Satoshis)</div>
                <div style={{ wordWrap: "break-word" }}>{balance.total}</div>
              </div>
            </Card>
            <Card
              size="small"
              title="Switch Network"
              style={{ width: 300, margin: 10 }}
            >
              <div style={{ textAlign: "left", marginTop: 10 }}>
                <div style={{ fontWeight: "bold" }}>Network:</div>
                <Radio.Group
                  onChange={async (e) => {
                    const network = await unisat.switchNetwork(e.target.value);
                    setNetwork(network);
                  }}
                  value={network}
                >
                  <Radio value={"livenet"}>livenet</Radio>
                  <Radio value={"testnet"}>testnet</Radio>
                </Radio.Group>
              </div>
            </Card>
            <LastInscription></LastInscription>
            <Card
              size="small"
              title="Sell First Inscription"
              style={{ width: 300, margin: 10 }}
            >
              <div>
                <Button
                  onClick={async () => {
                    const result = await (
                      window as any
                    ).unisat.getInscriptions();
                    listInscription(result.list[0]);
                  }}
                >
                  Fetch And Sell First Inscription
                </Button>
              </div>
              <div style={{ textAlign: "left", marginTop: 10 }}>
                <div style={{ fontWeight: "bold" }}>Result:</div>
                <div style={{ wordWrap: "break-word" }}>{sellerSign}</div>
              </div>
            </Card>

            <Card
              size="small"
              title="Buyer prepare dummy utxos"
              style={{ width: 300, margin: 10 }}
            >
              <div>
                <Button
                  onClick={async () => {
                    const result = await prepareBuyerDummyUtxo();
                  }}
                >
                  Buyer Prepare Dummy utxos
                </Button>
              </div>
              <div style={{ textAlign: "left", marginTop: 10 }}>
                <div style={{ fontWeight: "bold" }}>Result:</div>
                <div style={{ wordWrap: "break-word" }}>
                  {prepareDummyResult}
                </div>
              </div>
            </Card>

            <Card
              size="small"
              title="Buyer pay"
              style={{ width: 300, margin: 10 }}
            >
              <div>
                <Button
                  onClick={async () => {
                    const result = await buyInscription();
                  }}
                >
                  Buyer Pay
                </Button>
              </div>
              <div style={{ textAlign: "left", marginTop: 10 }}>
                <div style={{ fontWeight: "bold" }}>Result:</div>
                <div style={{ wordWrap: "break-word" }}>{payResult}</div>
              </div>
            </Card>

            <CreatePsbt></CreatePsbt>
            <SignPsbtCard />
            <SignMessageCard />
            <PushTxCard />
            <PushPsbtCard />
            <SendBitcoin />
            <SendInscription></SendInscription>
            <TakerPsbtCard></TakerPsbtCard>
          </div>
        ) : (
          <div>
            <Button
              onClick={async () => {
                const result = await unisat.requestAccounts();
                handleAccountsChanged(result);
              }}
            >
              Connect Unisat Wallet
            </Button>
          </div>
        )}
      </header>
    </div>
  );
}

function LastInscription() {
  const [inscription, setInscription] = useState([]);
  return (
    <Card
      size="small"
      title="Get Inscriptions"
      style={{ width: 300, margin: 10 }}
    >
      <div>
        <Button
          onClick={async () => {
            const result = await (window as any).unisat.getInscriptions();
            setInscription(result.list);
          }}
        >
          Fetch Inscriptions
        </Button>
      </div>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Result:</div>
        <div style={{ wordWrap: "break-word" }}>
          {JSON.stringify(inscription)}
        </div>
      </div>
    </Card>
  );
}
function toPsbtNetwork(networkType: number) {
  if (networkType === 0) {
    return bitcoin.networks.bitcoin;
  } else {
    return bitcoin.networks.testnet;
  }
}
function toXOnly(pubKey: Buffer) {
  if (pubKey.length === 32) {
    return pubKey;
  } else {
    return pubKey.slice(1, 33);
  }
}
// const toXOnly = (pubKey: Buffer) =>

function CreatePsbt() {
  const [psbtHex, setPsbtHex] = useState("");
  const [outputValue, setOutputValue] = useState("");
  const [myAddress, setAddressValue] = useState(
    // "tb1q6pvg86rll8qne8yw06p0yepv4yc0982ahmrn6e"
    "tb1pjeazdn20fk7e2df65xjvput7n58dfzmewmfxjgvjx450f5enwnrsn9vplj"
  );
  const [txid, setTxid] = useState(
    "b8a6510ecaa73cb45523eb6043aacd44a0fc7b93dce90860054137a1f717eea1"
  );
  let btcNetwork = toPsbtNetwork(1);

  return (
    <Card size="small" title="Create Psbt" style={{ width: 300, margin: 10 }}>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>InputTxid:</div>
        <Input
          defaultValue={txid}
          onChange={(e) => {
            setTxid(e.target.value);
          }}
        ></Input>
      </div>

      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>address:</div>
        <Input
          defaultValue={myAddress}
          onChange={(e) => {
            setAddressValue(e.target.value);
          }}
        ></Input>
      </div>

      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>outputValue:</div>
        <Input
          defaultValue={outputValue}
          onChange={(e) => {
            setOutputValue(e.target.value);
          }}
        ></Input>
      </div>

      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Result:</div>
        <div style={{ wordWrap: "break-word" }}>{psbtHex}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          try {
            //create psbt
            const psbt = new bitcoin.Psbt({ network: btcNetwork });

            const publicKey = await (window as any).unisat.getPublicKey();
            const ob = Buffer.from(publicKey, "hex");
            let xPubKey = toXOnly(ob);
            // let trkey = bitcoin.payments.p2tr({
            //   pubkey: toXOnly(ob),
            //   network: bitcoin.networks.testnet,
            // });
            let trkey = bitcoin.payments.p2wpkh({
              pubkey: ob,
              network: bitcoin.networks.testnet,
            });

            // let scriptPubKey;
            // try {
            //   // scriptPubKey = bitcoin.address.fromBech32(myAddress).data;
            // } catch (e) {
            //   console.log(e);
            //   console.log("Invalid address: " + myAddress);
            //   // throw new Error("Couldn't convert address");
            // }

            // psbt.addInput({
            //   hash: "e1a3207e25e4ab1615505ef55e2648c4a9511ea28ddb315702011a9dada6f30f",
            //   index: 0,
            //   witnessUtxo: {
            //     script: trkey.output!,
            //     value: 10000,
            //   },
            //   sighashType:
            //     bitcoin.Transaction.SIGHASH_SINGLE |
            //     bitcoin.Transaction.SIGHASH_ANYONECANPAY,
            // });
            // const tx = bitcoin.Transaction.fromHex("02000000000102967ce8ccd1d0b2c9f5b719e5dd42b9f8cc349fd98871c73685483054ade5df7f0100000000ffffffff64e2ba1aaa2d025af542d6cadc2562ce79dc8965763a77163cd932fb8b2c674a0100000000ffffffff03a00f0000000000001600148adc45ea3eca5283972ad18d2d31596993cbec00b80b000000000000160014d05883e87ff9c13c9c8e7e82f2642ca930f29d5d160a000000000000160014d05883e87ff9c13c9c8e7e82f2642ca930f29d5d02483045022100e46b73cf09f073dcbac7aefbde0fb2183adcf3d96ea44817277cf407a74f6d9502200934d20187555bf23d60a6dfae10883c536034d21b6e47d07457eb999c3d7364832103c75bdeda1a9596b01a883c24e40e401a1dec6c55b1f481d032f02e35c3d32f5602483045022100c7934a5efef5b264422b5a9296422e16f940c9775d85001aeede2b4bdb19a1730220017e7a240a5c486023f913793e595577c362fb8a7eaa78e4cdb652212d0eb867012103b6d86356efc3cc914ba8aa3447351d0aa6946a927087a43d35eeb80dc3fe0b6c00000000");

            // psbt.addInput({
            //   hash: "888e78926692fae019ec1b127f1852dfd888ba5c6037d7f920cccda88b33d583",
            //   index: 1,
            //   witnessUtxo: {
            //     script: Buffer.from(
            //       "0014d05883e87ff9c13c9c8e7e82f2642ca930f29d5d",
            //       "hex"
            //     ),
            //     value: 7000,
            //   },
            // });

            psbt.addInput({
              hash: txid,
              index: 1,
              witnessUtxo: {
                script: trkey.output!,
                value: 600,
              },
              // nonWitnessUtxo: tx.toBuffer(),
              sighashType:
                bitcoin.Transaction.SIGHASH_SINGLE |
                bitcoin.Transaction.SIGHASH_ANYONECANPAY,

              // nonWitnessUtxo: Buffer.from("0014d05883e87ff9c13c9c8e7e82f2642ca930f29d5d", "hex")
            });

            // psbt.addOutput({
            //   address: "tb1q6pvg86rll8qne8yw06p0yepv4yc0982ahmrn6e",
            //   value: 4000,
            // });

            psbt.addOutput({
              address: trkey.address!,
              value: 3000,
            });

            // setPsbtHex(psbt.toHex());

            // psbt.signInput(0, null, bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY);
            // const psbtResult = await (window as any).unisat.signPsbt(psbtHex);
            // setPsbtHex(psbtResult);

            const psbtResult = await (window as any).unisat.signPsbt(
              psbt.toHex(),
              {
                autoFinalized: false,
              }
            );
            setPsbtHex(psbtResult);
          } catch (e) {
            setPsbtHex((e as any).message);
          }
        }}
      >
        Create Psbt
      </Button>
    </Card>
  );
}

function SignPsbtCard() {
  const [psbtHex, setPsbtHex] = useState("");
  const [psbtResult, setPsbtResult] = useState("");
  return (
    <Card size="small" title="Sign Psbt" style={{ width: 300, margin: 10 }}>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>PsbtHex:</div>
        <Input
          defaultValue={psbtHex}
          onChange={(e) => {
            setPsbtHex(e.target.value);
          }}
        ></Input>
      </div>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Result:</div>
        <div style={{ wordWrap: "break-word" }}>{psbtResult}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          try {
            const psbtResult = await (window as any).unisat.signPsbt(psbtHex, {
              autoFinalized: false,
            });
            // const psbt = bitcoin.Psbt.fromHex(psbtResult);
            // psbt.finalizeAllInputs();

            setPsbtResult(psbtResult);
          } catch (e) {
            setPsbtResult((e as any).message);
          }
        }}
      >
        Sign Psbt
      </Button>
    </Card>
  );
}

function TakerPsbtCard() {
  const [makerPsbtHex, setMakerPsbtHex] = useState("");
  const [psbtResult, setPsbtResult] = useState("");
  const [myAddress, setAddressValue] = useState(
    "tb1p58us57q4u43rapz8zxxjqzxdhcwnugja03r6j0egy2jgw7ywm2aq7nwdhl"
  );

  return (
    <Card
      size="small"
      title="Taker Sign Psbt"
      style={{ width: 300, margin: 10 }}
    >
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>makerPsbtHex:</div>
        <Input
          defaultValue={makerPsbtHex}
          onChange={(e) => {
            setMakerPsbtHex(e.target.value);
          }}
        ></Input>
      </div>

      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>address:</div>
        <Input
          defaultValue={myAddress}
          onChange={(e) => {
            setAddressValue(e.target.value);
          }}
        ></Input>
      </div>

      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Result:</div>
        <div style={{ wordWrap: "break-word" }}>{psbtResult}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          let scriptPubKey;
          // let btcNetwork = toPsbtNetwork(1);
          // const p2sh = bitcoin.payments.p2sh({
          //   redeem: bitcoin.payments.p2wpkh({ pubkey: publicKey, network:  }),
          // })

          const publicKey = await (window as any).unisat.getPublicKey();
          const ob = Buffer.from(publicKey, "hex");
          let xPubKey = toXOnly(ob);

          let pkh = bitcoin.payments.p2wpkh({
            pubkey: ob,
            network: bitcoin.networks.testnet,
          });

          // try {
          //   scriptPubKey = bitcoin.address.fromBech32(myAddress).data;
          // } catch (e) {
          //   console.log(e);
          //   console.log("Invalid address: " + myAddress);
          //   throw new Error("Couldn't convert address");
          // }

          try {
            const psbtSeller = bitcoin.Psbt.fromHex(makerPsbtHex);

            const psbtBuyer = new bitcoin.Psbt({
              network: bitcoin.networks.testnet,
            });

            //buyer dummy input 1
            psbtBuyer.addInput({
              hash: "4da41bed33c591ff79f3f584f945a08853478a006b2813a0f66a35cfbbfddfa7",
              index: 0,
              witnessUtxo: {
                script: pkh.output!,
                value: 1000,
              },
            });

            //buyer dummy input 2
            psbtBuyer.addInput({
              hash: "4da41bed33c591ff79f3f584f945a08853478a006b2813a0f66a35cfbbfddfa7",
              index: 1,
              witnessUtxo: {
                script: pkh.output!,
                value: 1000,
              },
            });

            // seller nft Item
            // psbtBuyer.addInputs(psbtSeller.txInputs);
            psbtBuyer.addInput({
              hash: "b8a6510ecaa73cb45523eb6043aacd44a0fc7b93dce90860054137a1f717eea1",
              index: 1,
              witnessUtxo: {
                script: Buffer.from(
                  "0014e78748849b1fc4f723f2f2046f56788bd162cdfe",
                  "hex"
                )!,
                value: 600,
              },

              // nonWitnessUtxo: Buffer.from("0014d05883e87ff9c13c9c8e7e82f2642ca930f29d5d", "hex")
            });

            // buyer pay nft
            psbtBuyer.addInput({
              hash: "376e831b3ff112f2a52bc95d9f6ef16973df30d7a7044a67e92d546ef572d50a",
              index: 3,
              witnessUtxo: {
                script: pkh.output!,
                value: 4000,
              },
              sighashType: bitcoin.Transaction.SIGHASH_ALL,
            });

            //dummy input passthrough
            psbtBuyer.addOutput({
              script: pkh.output!,
              value: 2000,
            });

            // psbtBuyer.addInput({
            //   hash: "c4bc0cbd52b968c5653cdcbcf23e84b1d84bafb79f69c7147e5e66b86f134c81",
            //   index: 3,
            //   witnessUtxo: {
            //     script: pkh.output!,
            //     value: 3500,
            //   },
            //   sighashType: bitcoin.Transaction.SIGHASH_ALL,
            // });

            // psbtBuyer.addInputs(psbtSeller.txInputs);

            // buyer receive nft
            psbtBuyer.addOutput({
              script: pkh.output!,
              value: 600,
            });

            //seller earn
            psbtBuyer.addOutput({
              address: "tb1qu7r53pymrlz0wglj7gzx74nc30gk9n07lkdeg2",
              // script: pkh.output!,
              value: 3000,
            });

            //buyer get change
            // psbtBuyer.addOutput({
            //   // address: pkh.address!,
            //   script: pkh.output!,
            //   value: 1000,
            // });
            // //buyer get change
            // psbtBuyer.addOutput({
            //   // address: pkh.address!,
            //   script: pkh.output!,
            //   value: 1000,
            // });

            //buyer get change
            psbtBuyer.addOutput({
              // address: pkh.address!,
              script: pkh.output!,
              value: 4000 - 3000 - 500,
            });

            const info = psbtBuyer.toHex();
            const psbtResult = await (window as any).unisat.signPsbt(info, {
              autoFinalized: false,
            });

            //merge two signed psbt
            const signedPsbt = bitcoin.Psbt.fromHex(psbtResult);

            (signedPsbt.data.globalMap.unsignedTx as any).tx.ins[2] = (
              psbtSeller.data.globalMap.unsignedTx as any
            ).tx.ins[0];
            signedPsbt.data.inputs[2] = psbtSeller.data.inputs[0];

            signedPsbt.finalizeAllInputs();
            const result = await (window as any).unisat.pushPsbt(
              signedPsbt.toHex()
            );
            // const transactionID = signedPsbt.extractTransaction().getId();

            setPsbtResult(result + ":" + signedPsbt.toHex());
          } catch (e) {
            setPsbtResult((e as any).message);
          }
        }}
      >
        Sign Psbt
      </Button>
    </Card>
  );
}

function SignMessageCard() {
  const [message, setMessage] = useState("hello world~");
  const [signature, setSignature] = useState("");
  return (
    <Card size="small" title="Sign Message" style={{ width: 300, margin: 10 }}>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Message:</div>
        <Input
          defaultValue={message}
          onChange={(e) => {
            setMessage(e.target.value);
          }}
        ></Input>
      </div>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Signature:</div>
        <div style={{ wordWrap: "break-word" }}>{signature}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          const signature = await (window as any).unisat.signMessage(message);
          setSignature(signature);
        }}
      >
        Sign Message
      </Button>
    </Card>
  );
}

function PushTxCard() {
  const [rawtx, setRawtx] = useState("");
  const [txid, setTxid] = useState("");
  return (
    <Card
      size="small"
      title="Push Transaction Hex"
      style={{ width: 300, margin: 10 }}
    >
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>rawtx:</div>
        <Input
          defaultValue={rawtx}
          onChange={(e) => {
            setRawtx(e.target.value);
          }}
        ></Input>
      </div>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>txid:</div>
        <div style={{ wordWrap: "break-word" }}>{txid}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          try {
            const txid = await (window as any).unisat.pushTx(rawtx);
            setTxid(txid);
          } catch (e) {
            setTxid((e as any).message);
          }
        }}
      >
        PushTx
      </Button>
    </Card>
  );
}

function PushPsbtCard() {
  const [psbtHex, setPsbtHex] = useState("");
  const [txid, setTxid] = useState("");
  return (
    <Card size="small" title="Push Psbt Hex" style={{ width: 300, margin: 10 }}>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>psbt hex:</div>
        <Input
          defaultValue={psbtHex}
          onChange={(e) => {
            setPsbtHex(e.target.value);
          }}
        ></Input>
      </div>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>txid:</div>
        <div style={{ wordWrap: "break-word" }}>{txid}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          try {
            const txid = await (window as any).unisat.pushPsbt(psbtHex);
            setTxid(txid);
          } catch (e) {
            setTxid((e as any).message);
          }
        }}
      >
        pushPsbt
      </Button>
    </Card>
  );
}

function SendInscription() {
  const [toAddress, setToAddress] = useState(
    "tb1p9fs8wmzalllma2vzn3swspeungjz8w5s55kwf75tva77ltpkx4aqgkrm3g"
  );
  const [inscriptionId, setInscriptionId] = useState("");
  const [txid, setTxid] = useState("");

  return (
    <Card
      size="small"
      title="Send Inscription"
      style={{ width: 300, margin: 10 }}
    >
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Receiver Address:</div>
        <Input
          defaultValue={toAddress}
          onChange={(e) => {
            setToAddress(e.target.value);
          }}
        ></Input>
      </div>

      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>inscriptionId</div>
        <Input
          defaultValue={inscriptionId}
          onChange={(e) => {
            setInscriptionId(e.target.value);
          }}
        ></Input>
      </div>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>txid:</div>
        <div style={{ wordWrap: "break-word" }}>{txid}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          try {
            const txid = await (window as any).unisat.sendInscription(
              toAddress,
              inscriptionId
            );
            setTxid(txid);
          } catch (e) {
            setTxid((e as any).message);
          }
        }}
      >
        SendInscription
      </Button>
    </Card>
  );
}

function SendBitcoin() {
  const [toAddress, setToAddress] = useState(
    "tb1p9fs8wmzalllma2vzn3swspeungjz8w5s55kwf75tva77ltpkx4aqgkrm3g"
  );
  const [satoshis, setSatoshis] = useState(1000);
  const [txid, setTxid] = useState("");
  return (
    <Card size="small" title="Send Bitcoin" style={{ width: 300, margin: 10 }}>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Receiver Address:</div>
        <Input
          defaultValue={toAddress}
          onChange={(e) => {
            setToAddress(e.target.value);
          }}
        ></Input>
      </div>

      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>Amount: (satoshis)</div>
        <Input
          defaultValue={satoshis}
          onChange={(e) => {
            setSatoshis(parseInt(e.target.value));
          }}
        ></Input>
      </div>
      <div style={{ textAlign: "left", marginTop: 10 }}>
        <div style={{ fontWeight: "bold" }}>txid:</div>
        <div style={{ wordWrap: "break-word" }}>{txid}</div>
      </div>
      <Button
        style={{ marginTop: 10 }}
        onClick={async () => {
          try {
            const txid = await (window as any).unisat.sendBitcoin(
              toAddress,
              satoshis
            );
            setTxid(txid);
          } catch (e) {
            setTxid((e as any).message);
          }
        }}
      >
        SendBitcoin
      </Button>
    </Card>
  );
}

export default App;
