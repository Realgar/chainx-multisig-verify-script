const bitcoin = require("bitcoinjs-lib");
const fetch = require("node-fetch");

const {
  privateKey,
  multisigAddress,
  redeemScriptHex,
  toSignRawTransactionHex,
  fee,
  amount,
  targetAddress
} = require("./config");
const redeemScript = Buffer.from(redeemScriptHex, "hex");

const network = bitcoin.networks.testnet;

async function getUnspentsFromApi(address) {
  const url = `https://api.blockcypher.com/v1/btc/test3/addrs/${address}?unspentOnly=true&confirmations=1`;
  const res = await fetch(url);
  const response = await res.json();
  if (response.error) {
    console.error(`api error: ${response.error}`);
    throw new Error(response.error);
  }
  return (response.txrefs || []).map(utxo => ({
    txid: utxo.tx_hash,
    vout: utxo.tx_output_n,
    amount: utxo.value
  }));
}

function filterUnspentsByAmount(unspents, amount) {
  const nonZeroUnspents = unspents.filter(utxo => utxo.amount > 0);

  const result = [];
  let sum = 0;
  for (let utxo of nonZeroUnspents) {
    result.push(utxo);
    sum += utxo.amount;
    if (sum > amount) {
      break;
    }
  }

  return [sum < amount ? [] : result, sum];
}

async function compose() {
  let txb;
  if (toSignRawTransactionHex) {
    txb = bitcoin.TransactionBuilder.fromTransaction(
      bitcoin.Transaction.fromHex(toSignRawTransactionHex),
      network
    );
  } else {
    txb = new bitcoin.TransactionBuilder(network);
    txb.setVersion(1);

    const allUnspents = await getUnspentsFromApi(multisigAddress);
    const [targetUnspents, sum] = filterUnspentsByAmount(
      allUnspents,
      fee + amount
    );
    if (targetUnspents.length <= 0) {
      throw new Error(`${multisigAddress} has no enough unspents`);
    }

    for (let unspent of targetUnspents) {
      txb.addInput(unspent.txid, unspent.vout);
    }
    const change = sum - fee - amount;
    txb.addOutput(targetAddress, amount);
    if (change > 0) {
      txb.addOutput(multisigAddress, change);
    }
  }

  const keyPair = bitcoin.ECPair.fromWIF(privateKey, network);
  for (let i = 0; i < txb.__INPUTS.length; i++) {
    txb.sign(i, keyPair, redeemScript);
  }

  let rawTransaction;

  const { signatures, maxSignatures } = txb.__INPUTS[0];
  const signedCount = signatures.filter(sig => typeof sig === "object").length;
  if (signedCount < maxSignatures) {
    rawTransaction = txb.buildIncomplete().toHex();
    console.log(
      "Broadcast the following raw transaction hex to others who haven't sign it:"
    );
  } else {
    rawTransaction = txb.build().toHex();
    console.log("Following transaction is fully signed:");
  }

  console.log(rawTransaction);
}

compose();
