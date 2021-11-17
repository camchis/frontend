import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { useWeb3React } from "@web3-react/core";
import useSWR from "swr";
import { ethers } from "ethers";

import {
  getConnectWalletHandler,
  useEagerConnect,
  useInactiveListener,
  fetcher,
  formatKeyAmount,
  formatAmount,
  formatAmountFree,
  parseValue,
  expandDecimals,
  getExplorerUrl,
  approveTokens,
  bigNumberify,
  CHAIN_ID,
  USD_DECIMALS,
  PRECISION,
} from "./Helpers";

import { getContract, XGMT_EXCLUDED_ACCOUNTS } from "./Addresses";
import { getTokenBySymbol } from "./data/Tokens";

import Reader from "./abis/Reader.json";
import Token from "./abis/Token.json";
import NDOL from "./abis/NDOL.json";
import YieldFarm from "./abis/YieldFarm.json";

import Modal from "./components/Modal/Modal";
import Footer from "./Footer";

import "./css/Stake.css";

const BASIS_POINTS_DIVISOR = 10000;
const HOURS_PER_YEAR = 8760;

const DUST_LP_AMOUNT = "10000000000000000";

const { AddressZero } = ethers.constants;

function getBalanceAndSupplyData(balances) {
  if (!balances || balances.length === 0) {
    return {};
  }

  const keys = [
    "ndol",
    "gmt",
    "xgmt",
    "gmtUsdg",
    "xgmtUsdg",
    "gmtUsdgFarm",
    "xgmtUsdgFarm",
    "autoUsdg",
    "autoUsdgFarm",
  ];
  const balanceData = {};
  const supplyData = {};
  const propsLength = 2;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    balanceData[key] = balances[i * propsLength];
    supplyData[key] = balances[i * propsLength + 1];
  }

  return { balanceData, supplyData };
}

function getStakingData(stakingInfo) {
  if (!stakingInfo || stakingInfo.length === 0) {
    return;
  }

  const keys = [
    "ndol",
    "xgmt",
    "gmtUsdgFarmXgmt",
    "gmtUsdgFarmNative",
    "xgmtUsdgFarmXgmt",
    "xgmtUsdgFarmNative",
    "autoUsdgFarmXgmt",
    "autoUsdgFarmNative",
  ];
  const data = {};
  const propsLength = 2;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    data[key] = {
      claimable: stakingInfo[i * propsLength],
      tokensPerInterval: stakingInfo[i * propsLength + 1],
    };
  }

  return data;
}

function getTotalStakedData(totalStakedInfo) {
  if (!totalStakedInfo || totalStakedInfo.length === 0) {
    return;
  }

  const keys = ["ndol", "xgmt"];
  const data = {};

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    data[key] = totalStakedInfo[i];
  }

  return data;
}

function getPairData(pairInfo) {
  const keys = ["gmtUsdg", "xgmtUsdg", "bnbBusd", "autoUsdg"];
  if (
    !pairInfo ||
    pairInfo.length === 0 ||
    pairInfo.length !== keys.length * 2
  ) {
    return;
  }

  const data = {};
  const propsLength = 2;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    data[key] = {
      balance0: pairInfo[i * propsLength],
      balance1: pairInfo[i * propsLength + 1],
    };
  }

  return data;
}

function getProcessedData(
  balanceData,
  supplyData,
  stakingData,
  totalStakedData,
  pairData,
  xgmtSupply
) {
  if (
    !balanceData ||
    !supplyData ||
    !stakingData ||
    !totalStakedData ||
    !pairData ||
    !xgmtSupply
  ) {
    return {};
  }

  // const gmtPrice = pairData.gmtUsdg.balance1.mul(PRECISION).div(pairData.gmtUsdg.balance0)
  const xgmtPrice = pairData.xgmtUsdg.balance0.eq(0)
    ? bigNumberify(0)
    : pairData.xgmtUsdg.balance1.mul(PRECISION).div(pairData.xgmtUsdg.balance0);
  const gmtUsdgPrice = supplyData.gmtUsdg.eq(0)
    ? bigNumberify(0)
    : pairData.gmtUsdg.balance1.mul(PRECISION).mul(2).div(supplyData.gmtUsdg);
  const xgmtUsdgPrice = supplyData.xgmtUsdg.eq(0)
    ? bigNumberify(0)
    : pairData.xgmtUsdg.balance1.mul(PRECISION).mul(2).div(supplyData.xgmtUsdg);
  const bnbPrice = pairData.bnbBusd.balance1
    .mul(PRECISION)
    .div(pairData.bnbBusd.balance0);
  const autoUsdgPrice = supplyData.autoUsdg.eq(0)
    ? bigNumberify(0)
    : pairData.autoUsdg.balance1.mul(PRECISION).mul(2).div(supplyData.autoUsdg);

  const ndolAnnualRewardsUsd = stakingData.ndol.tokensPerInterval
    .mul(bnbPrice)
    .mul(HOURS_PER_YEAR)
    .div(expandDecimals(1, 18));
  const xgmtAnnualRewardsUsd = stakingData.xgmt.tokensPerInterval
    .mul(bnbPrice)
    .mul(HOURS_PER_YEAR)
    .div(expandDecimals(1, 18));

  const gmtUsdgAnnualRewardsXmgtUsd =
    stakingData.gmtUsdgFarmXgmt.tokensPerInterval
      .mul(xgmtPrice)
      .mul(HOURS_PER_YEAR)
      .div(expandDecimals(1, 18));
  const gmtUsdgAnnualRewardsNativeUsd =
    stakingData.gmtUsdgFarmNative.tokensPerInterval
      .mul(bnbPrice)
      .mul(HOURS_PER_YEAR)
      .div(expandDecimals(1, 18));
  const gmtUsdgTotalAnnualRewardsUsd = gmtUsdgAnnualRewardsXmgtUsd.add(
    gmtUsdgAnnualRewardsNativeUsd
  );

  const xgmtUsdgAnnualRewardsXmgtUsd =
    stakingData.xgmtUsdgFarmXgmt.tokensPerInterval
      .mul(xgmtPrice)
      .mul(HOURS_PER_YEAR)
      .div(expandDecimals(1, 18));
  const xgmtUsdgAnnualRewardsNativeUsd =
    stakingData.xgmtUsdgFarmNative.tokensPerInterval
      .mul(bnbPrice)
      .mul(HOURS_PER_YEAR)
      .div(expandDecimals(1, 18));
  const xgmtUsdgTotalAnnualRewardsUsd = xgmtUsdgAnnualRewardsXmgtUsd.add(
    xgmtUsdgAnnualRewardsNativeUsd
  );

  const autoUsdgAnnualRewardsXgmtUsd =
    stakingData.autoUsdgFarmXgmt.tokensPerInterval
      .mul(xgmtPrice)
      .mul(HOURS_PER_YEAR)
      .div(expandDecimals(1, 18));
  const autoUsdgAnnualRewardsNativeUsd =
    stakingData.autoUsdgFarmNative.tokensPerInterval
      .mul(bnbPrice)
      .mul(HOURS_PER_YEAR)
      .div(expandDecimals(1, 18));
  const autoUsdgTotalAnnualRewardsUsd = autoUsdgAnnualRewardsXgmtUsd.add(
    autoUsdgAnnualRewardsNativeUsd
  );

  const data = {};
  data.ndolBalance = balanceData.ndol;
  data.ndolSupply = supplyData.ndol;
  data.ndolTotalStaked = totalStakedData.ndol;
  data.ndolTotalStakedUsd = totalStakedData.ndol
    .mul(PRECISION)
    .div(expandDecimals(1, 18));
  data.ndolSupplyUsd = supplyData.ndol
    .mul(PRECISION)
    .div(expandDecimals(1, 18));
  data.ndolApr = data.ndolTotalStaked.eq(0)
    ? undefined
    : ndolAnnualRewardsUsd
        .mul(BASIS_POINTS_DIVISOR)
        .div(totalStakedData.ndol)
        .mul(expandDecimals(1, 18))
        .div(PRECISION);
  data.ndolRewards = stakingData.ndol.claimable;

  data.xgmtBalance = balanceData.xgmt;
  data.xgmtBalanceUsd = balanceData.xgmt
    .mul(xgmtPrice)
    .div(expandDecimals(1, 18));
  data.xgmtSupply = xgmtSupply;
  data.xgmtTotalStaked = totalStakedData.xgmt;
  data.xgmtTotalStakedUsd = totalStakedData.xgmt
    .mul(xgmtPrice)
    .div(expandDecimals(1, 18));
  data.xgmtSupplyUsd = xgmtSupply.mul(xgmtPrice).div(expandDecimals(1, 18));
  data.xgmtApr = data.xgmtSupplyUsd.eq(0)
    ? bigNumberify(0)
    : xgmtAnnualRewardsUsd
        .mul(BASIS_POINTS_DIVISOR)
        .div(data.xgmtTotalStakedUsd);
  data.xgmtRewards = stakingData.xgmt.claimable;

  data.gmtUsdgFarmBalance = balanceData.gmtUsdgFarm;

  data.gmtUsdgBalance = balanceData.gmtUsdg;
  data.gmtUsdgBalanceUsd = balanceData.gmtUsdg
    .mul(gmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.gmtUsdgSupply = supplyData.gmtUsdg;
  data.gmtUsdgSupplyUsd = supplyData.gmtUsdg
    .mul(gmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.gmtUsdgStaked = balanceData.gmtUsdgFarm;
  data.gmtUsdgStakedUsd = balanceData.gmtUsdgFarm
    .mul(gmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.gmtUsdgFarmSupplyUsd = supplyData.gmtUsdgFarm
    .mul(gmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.gmtUsdgApr = data.gmtUsdgSupplyUsd.eq(0)
    ? bigNumberify(0)
    : data.gmtUsdgFarmSupplyUsd.eq(0)
    ? undefined
    : gmtUsdgTotalAnnualRewardsUsd
        .mul(BASIS_POINTS_DIVISOR)
        .div(data.gmtUsdgSupplyUsd);
  data.gmtUsdgXgmtRewards = stakingData.gmtUsdgFarmXgmt.claimable;
  data.gmtUsdgNativeRewards = stakingData.gmtUsdgFarmNative.claimable;
  data.gmtUsdgTotalRewards = data.gmtUsdgXgmtRewards.add(
    data.gmtUsdgNativeRewards
  );
  data.gmtUsdgTotalStaked = supplyData.gmtUsdgFarm;
  data.gmtUsdgTotalStakedUsd = supplyData.gmtUsdgFarm
    .mul(gmtUsdgPrice)
    .div(expandDecimals(1, 18));

  data.xgmtUsdgBalance = balanceData.xgmtUsdg;
  data.xgmtUsdgFarmBalance = balanceData.xgmtUsdgFarm;
  data.xgmtUsdgBalanceUsd = balanceData.xgmtUsdg
    .mul(xgmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.xgmtUsdgSupply = supplyData.xgmtUsdg;
  data.xgmtUsdgSupplyUsd = supplyData.xgmtUsdg
    .mul(xgmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.xgmtUsdgStaked = balanceData.xgmtUsdgFarm;
  data.xgmtUsdgStakedUsd = balanceData.xgmtUsdgFarm
    .mul(xgmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.xgmtUsdgFarmSupplyUsd = supplyData.xgmtUsdgFarm
    .mul(xgmtUsdgPrice)
    .div(expandDecimals(1, 18));
  data.xgmtUsdgApr = data.xgmtUsdgFarmSupplyUsd.eq(0)
    ? undefined
    : xgmtUsdgTotalAnnualRewardsUsd
        .mul(BASIS_POINTS_DIVISOR)
        .div(data.xgmtUsdgFarmSupplyUsd);
  data.xgmtUsdgXgmtRewards = stakingData.xgmtUsdgFarmXgmt.claimable;
  data.xgmtUsdgNativeRewards = stakingData.xgmtUsdgFarmNative.claimable;
  data.xgmtUsdgTotalRewards = data.xgmtUsdgXgmtRewards.add(
    data.xgmtUsdgNativeRewards
  );
  data.xgmtUsdgTotalStaked = supplyData.xgmtUsdgFarm;
  data.xgmtUsdgTotalStakedUsd = supplyData.xgmtUsdgFarm
    .mul(xgmtUsdgPrice)
    .div(expandDecimals(1, 18));

  data.autoUsdgBalance = balanceData.autoUsdg;
  data.autoUsdgFarmBalance = balanceData.autoUsdgFarm;
  data.autoUsdgBalanceUsd = balanceData.autoUsdg
    .mul(autoUsdgPrice)
    .div(expandDecimals(1, 18));
  data.autoUsdgStaked = balanceData.autoUsdgFarm;
  data.autoUsdgStakedUsd = balanceData.autoUsdgFarm
    .mul(autoUsdgPrice)
    .div(expandDecimals(1, 18));
  data.autoUsdgFarmSupplyUsd = supplyData.autoUsdgFarm
    .mul(autoUsdgPrice)
    .div(expandDecimals(1, 18));
  data.autoUsdgApr = data.autoUsdgFarmSupplyUsd.eq(0)
    ? bigNumberify(0)
    : autoUsdgTotalAnnualRewardsUsd
        .mul(BASIS_POINTS_DIVISOR)
        .div(data.autoUsdgFarmSupplyUsd);
  data.autoUsdgXgmtRewards = stakingData.autoUsdgFarmXgmt.claimable;
  data.autoUsdgNativeRewards = stakingData.autoUsdgFarmNative.claimable;
  data.autoUsdgTotalRewards = data.autoUsdgXgmtRewards.add(
    data.autoUsdgNativeRewards
  );
  data.autoUsdgTotalStaked = supplyData.autoUsdgFarm;
  data.autoUsdgTotalStakedUsd = supplyData.autoUsdgFarm
    .mul(autoUsdgPrice)
    .div(expandDecimals(1, 18));

  data.totalStakedUsd = data.ndolTotalStakedUsd
    .add(data.xgmtTotalStakedUsd)
    .add(data.gmtUsdgTotalStakedUsd)
    .add(data.xgmtUsdgTotalStakedUsd)
    .add(data.autoUsdgTotalStakedUsd);

  return data;
}

function StakeModal(props) {
  const {
    isVisible,
    setIsVisible,
    title,
    maxAmount,
    value,
    setValue,
    active,
    account,
    library,
    stakingTokenAddress,
    farmAddress,
  } = props;
  const [isStaking, setIsStaking] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const { data: tokenAllowance, mutate: updateTokenAllowance } = useSWR(
    [active, stakingTokenAddress, "allowance", account, farmAddress],
    {
      fetcher: fetcher(library, Token),
    }
  );

  useEffect(() => {
    if (active) {
      library.on("block", () => {
        updateTokenAllowance(undefined, true);
      });
      return () => {
        library.removeAllListeners("block");
      };
    }
  }, [active, library, updateTokenAllowance]);

  let amount = parseValue(value, 18);
  const needApproval = tokenAllowance && amount && amount.gt(tokenAllowance);

  const getError = () => {
    if (!amount) {
      return "Enter amount";
    }
    if (amount.gt(maxAmount)) {
      return "Insufficient LP tokens";
    }
  };

  const onClickPrimary = () => {
    if (needApproval) {
      approveTokens({
        setIsApproving,
        library,
        tokenAddress: stakingTokenAddress,
        spender: farmAddress,
        chainId: CHAIN_ID,
      });
      return;
    }

    setIsStaking(true);
    const contract = new ethers.Contract(
      farmAddress,
      YieldFarm.abi,
      library.getSigner()
    );
    contract
      .stake(amount)
      .then(async (res) => {
        const txUrl = getExplorerUrl(CHAIN_ID) + "tx/" + res.hash;
        toast.success(
          <div>
            Stake submitted!{" "}
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              View status.
            </a>
            <br />
          </div>
        );
        setIsVisible(false);
      })
      .catch((e) => {
        console.error(e);
        toast.error("Stake failed.");
      })
      .finally(() => {
        setIsStaking(false);
      });
  };

  const isPrimaryEnabled = () => {
    const error = getError();
    if (error) {
      return false;
    }
    if (isStaking) {
      return false;
    }
    return true;
  };

  const getPrimaryText = () => {
    const error = getError();
    if (error) {
      return error;
    }
    if (isApproving) {
      return `Approving LP...`;
    }
    if (needApproval) {
      return `Approve LP`;
    }
    if (isStaking) {
      return "Staking...";
    }
    return "Stake";
  };

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label={title}>
        <div className="Exchange-swap-section">
          <div className="Exchange-swap-section-top">
            <div className="muted">
              <div className="Exchange-swap-usd">Stake</div>
            </div>
            <div
              className="muted align-right clickable"
              onClick={() => setValue(formatAmountFree(maxAmount, 18, 8))}
            >
              Max: {formatAmount(maxAmount, 18, 4, true)}
            </div>
          </div>
          <div className="Exchange-swap-section-bottom">
            <div>
              <input
                type="number"
                placeholder="0.0"
                className="Exchange-swap-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className="PositionEditor-token-symbol">LP</div>
          </div>
        </div>
        <div className="Exchange-swap-button-container">
          <button
            className="App-cta Exchange-swap-button"
            onClick={onClickPrimary}
            disabled={!isPrimaryEnabled()}
          >
            {getPrimaryText()}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function UnstakeModal(props) {
  const {
    isVisible,
    setIsVisible,
    title,
    maxAmount,
    value,
    setValue,
    library,
    farmAddress,
  } = props;
  const [isUnstaking, setIsUnstaking] = useState(false);

  let amount = parseValue(value, 18);

  const getError = () => {
    if (!amount) {
      return "Enter amount";
    }
    if (amount.gt(maxAmount)) {
      return "Insufficient LP tokens";
    }
  };

  const onClickPrimary = () => {
    setIsUnstaking(true);
    const contract = new ethers.Contract(
      farmAddress,
      YieldFarm.abi,
      library.getSigner()
    );
    contract
      .unstake(amount)
      .then(async (res) => {
        const txUrl = getExplorerUrl(CHAIN_ID) + "tx/" + res.hash;
        toast.success(
          <div>
            Unstake submitted!{" "}
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              View status.
            </a>
            <br />
          </div>
        );
        setIsVisible(false);
      })
      .catch((e) => {
        console.error(e);
        toast.error("Unstake failed.");
      })
      .finally(() => {
        setIsUnstaking(false);
      });
  };

  const isPrimaryEnabled = () => {
    const error = getError();
    if (error) {
      return false;
    }
    if (isUnstaking) {
      return false;
    }
    return true;
  };

  const getPrimaryText = () => {
    const error = getError();
    if (error) {
      return error;
    }
    if (isUnstaking) {
      return "Unstaking...";
    }
    return "Unstake";
  };

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label={title}>
        <div className="Exchange-swap-section">
          <div className="Exchange-swap-section-top">
            <div className="muted">
              <div className="Exchange-swap-usd">Unstake</div>
            </div>
            <div
              className="muted align-right clickable"
              onClick={() => setValue(formatAmountFree(maxAmount, 18, 8))}
            >
              Max: {formatAmount(maxAmount, 18, 4, true)}
            </div>
          </div>
          <div className="Exchange-swap-section-bottom">
            <div>
              <input
                type="number"
                placeholder="0.0"
                className="Exchange-swap-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className="PositionEditor-token-symbol">LP</div>
          </div>
        </div>
        <div className="Exchange-swap-button-container">
          <button
            className="App-cta Exchange-swap-button"
            onClick={onClickPrimary}
            disabled={!isPrimaryEnabled()}
          >
            {getPrimaryText()}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default function Stake() {
  const [isStakeModalVisible, setIsStakeModalVisible] = useState(false);
  const [stakeModalTitle, setStakeModalTitle] = useState("");
  const [stakeModalMaxAmount, setStakeModalMaxAmount] = useState(undefined);
  const [stakeValue, setStakeValue] = useState("");
  const [stakingTokenAddress, setStakingTokenAddress] = useState("");
  const [stakingFarmAddress, setStakingFarmAddress] = useState("");

  const [isUnstakeModalVisible, setIsUnstakeModalVisible] = useState(false);
  const [unstakeModalTitle, setUnstakeModalTitle] = useState("");
  const [unstakeModalMaxAmount, setUnstakeModalMaxAmount] = useState(undefined);
  const [unstakeValue, setUnstakeValue] = useState("");
  const [unstakingFarmAddress, setUnstakingFarmAddress] = useState("");

  const { connector, activate, active, account, library, chainId } =
    useWeb3React();
  const [activatingConnector, setActivatingConnector] = useState();
  useEffect(() => {
    if (activatingConnector && activatingConnector === connector) {
      setActivatingConnector(undefined);
    }
  }, [activatingConnector, connector]);
  const triedEager = useEagerConnect();
  useInactiveListener(!triedEager || !!activatingConnector);
  const connectWallet = getConnectWalletHandler(activate);

  const readerAddress = getContract(CHAIN_ID, "Reader");
  const ammFactoryAddressV2 = getContract(CHAIN_ID, "AmmFactoryV2");
  const ndolAddress = getContract(CHAIN_ID, "NDOL");
  const gmtAddress = getContract(CHAIN_ID, "GMT");
  const xgmtAddress = getContract(CHAIN_ID, "XGMT");
  const autoAddress = getContract(CHAIN_ID, "AUTO");
  const nativeTokenAddress = getContract(CHAIN_ID, "NATIVE_TOKEN");
  const busdAddress = getTokenBySymbol(CHAIN_ID, "BUSD").address;

  const gmtUsdgPairAddress = getContract(CHAIN_ID, "GMT_NDOL_PAIR");
  const xgmtUsdgPairAddress = getContract(CHAIN_ID, "XGMT_NDOL_PAIR");
  const autoUsdgPairAddress = getContract(CHAIN_ID, "AUTO_NDOL_PAIR");
  const gmtUsdgFarmAddress = getContract(CHAIN_ID, "GMT_NDOL_FARM");
  const xgmtUsdgFarmAddress = getContract(CHAIN_ID, "XGMT_NDOL_FARM");
  const autoUsdgFarmAddress = getContract(CHAIN_ID, "AUTO_NDOL_FARM");

  const ndolYieldTracker = getContract(CHAIN_ID, "NDOL_YIELD_TRACKER");
  const xgmtYieldTracker = getContract(CHAIN_ID, "XGMT_YIELD_TRACKER");
  const gmtUsdgFarmTrackerXgmt = getContract(
    CHAIN_ID,
    "GMT_NDOL_FARM_TRACKER_XGMT"
  );
  const gmtUsdgFarmTrackerNative = getContract(
    CHAIN_ID,
    "GMT_NDOL_FARM_TRACKER_NATIVE"
  );
  const xgmtUsdgFarmTrackerXgmt = getContract(
    CHAIN_ID,
    "XGMT_NDOL_FARM_TRACKER_XGMT"
  );
  const xgmtUsdgFarmTrackerNative = getContract(
    CHAIN_ID,
    "XGMT_NDOL_FARM_TRACKER_NATIVE"
  );
  const autoUsdgFarmTrackerXgmt = getContract(
    CHAIN_ID,
    "AUTO_NDOL_FARM_TRACKER_XGMT"
  );
  const autoUsdgFarmTrackerNative = getContract(
    CHAIN_ID,
    "AUTO_NDOL_FARM_TRACKER_NATIVE"
  );

  const tokens = [
    ndolAddress,
    gmtAddress,
    xgmtAddress,
    gmtUsdgPairAddress,
    xgmtUsdgPairAddress,
    gmtUsdgFarmAddress,
    xgmtUsdgFarmAddress,
    autoUsdgPairAddress,
    autoUsdgFarmAddress,
  ];

  const yieldTrackers = [
    ndolYieldTracker,
    xgmtYieldTracker,
    gmtUsdgFarmTrackerXgmt,
    gmtUsdgFarmTrackerNative,
    xgmtUsdgFarmTrackerXgmt,
    xgmtUsdgFarmTrackerNative,
    autoUsdgFarmTrackerXgmt,
    autoUsdgFarmTrackerNative,
  ];

  const pairTokens = [
    gmtAddress,
    ndolAddress,
    xgmtAddress,
    ndolAddress,
    nativeTokenAddress,
    busdAddress,
    autoAddress,
    ndolAddress,
  ];

  const NDOLs = [ndolAddress, xgmtAddress];

  const { data: xgmtSupply, mutate: updateXgmtSupply } = useSWR(
    [active, readerAddress, "getTokenSupply", xgmtAddress],
    {
      fetcher: fetcher(library, Reader, [XGMT_EXCLUDED_ACCOUNTS]),
    }
  );

  const { data: balances, mutate: updateBalances } = useSWR(
    [
      active,
      readerAddress,
      "getTokenBalancesWithSupplies",
      account || AddressZero,
    ],
    {
      fetcher: fetcher(library, Reader, [tokens]),
    }
  );

  const { data: stakingInfo, mutate: updateStakingInfo } = useSWR(
    [active, readerAddress, "getStakingInfo", account || AddressZero],
    {
      fetcher: fetcher(library, Reader, [yieldTrackers]),
    }
  );

  const { data: totalStakedInfo, mutate: updateTotalStakedInfo } = useSWR(
    [active, readerAddress, "getTotalStaked"],
    {
      fetcher: fetcher(library, Reader, [yieldTokens]),
    }
  );

  const { data: pairInfo, mutate: updatePairInfo } = useSWR(
    [active, readerAddress, "getPairInfo", ammFactoryAddressV2],
    {
      fetcher: fetcher(library, Reader, [pairTokens]),
    }
  );

  const { balanceData, supplyData } = getBalanceAndSupplyData(balances);
  const stakingData = getStakingData(stakingInfo);
  const pairData = getPairData(pairInfo);
  const totalStakedData = getTotalStakedData(totalStakedInfo);

  const processedData = getProcessedData(
    balanceData,
    supplyData,
    stakingData,
    totalStakedData,
    pairData,
    xgmtSupply
  );

  const buyXgmtUrl = `https://exchange.pancakeswap.finance/#/swap?outputCurrency=${xgmtAddress}&inputCurrency=${ndolAddress}`;
  const buyGmtUrl = `https://exchange.pancakeswap.finance/#/swap?outputCurrency=${gmtAddress}&inputCurrency=${ndolAddress}`;

  const addGmtUsdgLpUrl = `https://exchange.pancakeswap.finance/#/add/${gmtAddress}/${ndolAddress}`;
  const addXgmtUsdgLpUrl = `https://exchange.pancakeswap.finance/#/add/${xgmtAddress}/${ndolAddress}`;

  const buyAutoUrl = `https://exchange.pancakeswap.finance/#/swap?outputCurrency=${autoAddress}&inputCurrency=${nativeTokenAddress}`;
  const addAutoUsdgLpUrl = `https://exchange.pancakeswap.finance/#/add/${autoAddress}/${ndolAddress}`;

  useEffect(() => {
    if (active) {
      library.on("block", () => {
        updateXgmtSupply(undefined, true);
        updateBalances(undefined, true);
        updateStakingInfo(undefined, true);
        updateTotalStakedInfo(undefined, true);
        updatePairInfo(undefined, true);
      });
      return () => {
        library.removeAllListeners("block");
      };
    }
  }, [
    active,
    library,
    updateXgmtSupply,
    updateBalances,
    updateStakingInfo,
    updateTotalStakedInfo,
    updatePairInfo,
  ]);

  const claim = (farmAddress, rewards) => {
    if (!active || !account) {
      toast.error("Wallet not yet connected");
      return;
    }
    if (chainId !== CHAIN_ID) {
      toast.error("Incorrect Network");
      return;
    }
    if (!rewards || rewards.eq(0)) {
      toast.error("No rewards to claim yet");
      return;
    }

    const contract = new ethers.Contract(
      farmAddress,
      NDOL.abi,
      library.getSigner()
    );
    contract
      .claim(account)
      .then(async (res) => {
        const txUrl = getExplorerUrl(CHAIN_ID) + "tx/" + res.hash;
        toast.success(
          <div>
            Claim submitted!{" "}
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              View status.
            </a>
            <br />
          </div>
        );
      })
      .catch((e) => {
        console.error(e);
        toast.error("Claim failed.");
      });
  };

  const showStakeGmtUsdgModal = () => {
    setIsStakeModalVisible(true);
    setStakeModalTitle("Stake GMT-NDOL");
    setStakeModalMaxAmount(processedData.gmtUsdgBalance);
    setStakeValue("");
    setStakingTokenAddress(gmtUsdgPairAddress);
    setStakingFarmAddress(gmtUsdgFarmAddress);
  };

  const showUnstakeGmtUsdgModal = () => {
    setIsUnstakeModalVisible(true);
    setUnstakeModalTitle("Unstake GMT-NDOL");
    setUnstakeModalMaxAmount(processedData.gmtUsdgFarmBalance);
    setUnstakeValue("");
    setUnstakingFarmAddress(gmtUsdgFarmAddress);
  };

  const showStakeXgmtUsdgModal = () => {
    setIsStakeModalVisible(true);
    setStakeModalTitle("Stake xGMT-NDOL");
    setStakeModalMaxAmount(processedData.xgmtUsdgBalance);
    setStakeValue("");
    setStakingTokenAddress(xgmtUsdgPairAddress);
    setStakingFarmAddress(xgmtUsdgFarmAddress);
  };

  const showUnstakeXgmtUsdgModal = () => {
    setIsUnstakeModalVisible(true);
    setUnstakeModalTitle("Unstake xGMT-NDOL");
    setUnstakeModalMaxAmount(processedData.xgmtUsdgFarmBalance);
    setUnstakeValue("");
    setUnstakingFarmAddress(xgmtUsdgFarmAddress);
  };

  const showStakeAutoUsdgModal = () => {
    setIsStakeModalVisible(true);
    setStakeModalTitle("Stake AUTO-NDOL");
    setStakeModalMaxAmount(processedData.autoUsdgBalance);
    setStakeValue("");
    setStakingTokenAddress(autoUsdgPairAddress);
    setStakingFarmAddress(autoUsdgFarmAddress);
  };

  const showUnstakeAutoUsdgModal = () => {
    setIsUnstakeModalVisible(true);
    setUnstakeModalTitle("Unstake AUTO-NDOL");
    setUnstakeModalMaxAmount(processedData.autoUsdgFarmBalance);
    setUnstakeValue("");
    setUnstakingFarmAddress(autoUsdgFarmAddress);
  };

  let warningMsg;
  const hasUnstakedGmtUsdg =
    processedData.gmtUsdgBalance &&
    processedData.gmtUsdgBalance.gt(DUST_LP_AMOUNT);
  const hasUnstakedXgmtUsdg =
    processedData.gmtUsdgBalance &&
    processedData.gmtUsdgBalance.gt(DUST_LP_AMOUNT);

  if (hasUnstakedGmtUsdg) {
    warningMsg = "You have not yet staked some of your GMT-NDOL LP tokens.";
  }
  if (hasUnstakedXgmtUsdg) {
    warningMsg = "You have not yet staked some of your xGMT-NDOL LP tokens.";
  }
  if (hasUnstakedXgmtUsdg && hasUnstakedGmtUsdg) {
    warningMsg =
      "You have not yet staked some of your GMT-NDOL and xGMT-NDOL LP tokens.";
  }

  const hasFeeDistribution = true;

  return (
    <div className="Stake Page">
      <StakeModal
        isVisible={isStakeModalVisible}
        setIsVisible={setIsStakeModalVisible}
        title={stakeModalTitle}
        maxAmount={stakeModalMaxAmount}
        value={stakeValue}
        setValue={setStakeValue}
        active={active}
        account={account}
        library={library}
        stakingTokenAddress={stakingTokenAddress}
        farmAddress={stakingFarmAddress}
      />
      <UnstakeModal
        isVisible={isUnstakeModalVisible}
        setIsVisible={setIsUnstakeModalVisible}
        title={unstakeModalTitle}
        maxAmount={unstakeModalMaxAmount}
        value={unstakeValue}
        setValue={setUnstakeValue}
        active={active}
        account={account}
        library={library}
        farmAddress={unstakingFarmAddress}
      />
      <div className="Stake-title App-hero">
        <div className="Stake-title-primary App-hero-primary">
          ${formatKeyAmount(processedData, "totalStakedUsd", 30, 0, true)}
        </div>
        <div className="Stake-title-secondary">Total Assets Staked</div>
      </div>
      <div className="Stake-note">
        The Gambit protocol is in beta, please read the&nbsp;
        <a
          href="https://gambit.gitbook.io/gambit/staking"
          target="_blank"
          rel="noopener noreferrer"
        >
          staking details
        </a>
        &nbsp; before participating.
      </div>
      <div className="Stake-note">
        You can automatically compound your rewards on&nbsp;
        <a
          href="https://autofarm.network"
          target="_blank"
          rel="noopener noreferrer"
        >
          Autofarm
        </a>
        &nbsp; this will give you a much larger APY.
      </div>
      {warningMsg && (
        <div className="App-warning Stake-warning">{warningMsg}</div>
      )}
      <div className="Stake-cards">
        <div className="border App-card primary">
          <div className="Stake-card-title App-card-title">NDOL</div>
          <div className="Stake-card-bottom App-card-content">
            <div className="Stake-info App-card-row">
              <div className="label">APR</div>
              <div>
                {!hasFeeDistribution && "TBC"}
                {hasFeeDistribution &&
                  `${formatKeyAmount(processedData, "ndolApr", 2, 2, true)}%`}
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Staked</div>
              <div>
                {formatKeyAmount(processedData, "ndolBalance", 18, 2, true)} ($
                {formatKeyAmount(processedData, "ndolBalance", 18, 2, true)})
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Wallet</div>
              <div>
                {formatKeyAmount(processedData, "ndolBalance", 18, 2, true)} ($
                {formatKeyAmount(processedData, "ndolBalance", 18, 2, true)})
              </div>
            </div>
            <div className="App-card-row">
              <div className="label">Rewards</div>
              <div>
                {!hasFeeDistribution && "TBC"}
                {hasFeeDistribution &&
                  `${formatKeyAmount(
                    processedData,
                    "ndolRewards",
                    18,
                    8,
                    true
                  )} WBNB`}
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Total Staked</div>
              <div>
                {formatKeyAmount(processedData, "ndolTotalStaked", 18, 2, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "ndolTotalStakedUsd",
                  30,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Total Supply</div>
              <div>
                {formatKeyAmount(processedData, "ndolSupply", 18, 2, true)} ($
                {formatKeyAmount(processedData, "ndolSupplyUsd", 30, 2, true)})
              </div>
            </div>
            <div className="App-card-options">
              <Link
                className="App-button-option App-card-option"
                to="/trade"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get NDOL
              </Link>
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => claim(ndolAddress, processedData.ndolRewards)}
                >
                  Claim
                </button>
              )}
              {!active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={connectWallet}
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="border App-card">
          <div className="Stake-card-title App-card-title">xGMT</div>
          <div className="Stake-card-bottom App-card-content">
            <div className="Stake-info App-card-row">
              <div className="label">APR</div>
              <div>
                {!hasFeeDistribution && "TBC"}
                {hasFeeDistribution &&
                  `${formatKeyAmount(processedData, "xgmtApr", 2, 2, true)}%`}
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Staked</div>
              <div>
                {formatKeyAmount(processedData, "xgmtBalance", 18, 2, true)} ($
                {formatKeyAmount(
                  processedData,
                  "xgmtBalanceUsd",
                  USD_DECIMALS,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Wallet</div>
              <div>
                {formatKeyAmount(processedData, "xgmtBalance", 18, 2, true)} ($
                {formatKeyAmount(
                  processedData,
                  "xgmtBalanceUsd",
                  USD_DECIMALS,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-row">
              <div className="label">Rewards</div>
              <div>
                {!hasFeeDistribution && "TBC"}
                {hasFeeDistribution &&
                  `${formatKeyAmount(
                    processedData,
                    "xgmtRewards",
                    18,
                    8,
                    true
                  )} WBNB`}
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Total Staked</div>
              <div>
                {formatKeyAmount(processedData, "xgmtTotalStaked", 18, 2, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "xgmtTotalStakedUsd",
                  USD_DECIMALS,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Total Supply</div>
              <div>
                {formatKeyAmount(processedData, "xgmtSupply", 18, 2, true)} ($
                {formatKeyAmount(
                  processedData,
                  "xgmtSupplyUsd",
                  USD_DECIMALS,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-options">
              <a
                className="App-button-option App-card-option"
                href={buyXgmtUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get xGMT
              </a>
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => claim(xgmtAddress, processedData.xgmtRewards)}
                >
                  Claim
                </button>
              )}
              {!active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={connectWallet}
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="border App-card">
          <div className="Stake-card-title App-card-title">GMT-NDOL LP</div>
          <div className="Stake-card-bottom App-card-content">
            <div className="Stake-info App-card-row">
              <div className="label">APR</div>
              <div>
                {formatKeyAmount(processedData, "gmtUsdgApr", 2, 2, true)}%
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Staked</div>
              <div>
                {formatKeyAmount(processedData, "gmtUsdgStaked", 18, 4, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "gmtUsdgStakedUsd",
                  30,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Wallet</div>
              <div>
                {formatKeyAmount(processedData, "gmtUsdgBalance", 18, 2, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "gmtUsdgBalanceUsd",
                  USD_DECIMALS,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-row">
              <div className="label">Rewards</div>
              <div>
                {hasFeeDistribution &&
                  processedData.gmtUsdgNativeRewards &&
                  processedData.gmtUsdgNativeRewards.gt(0) &&
                  `${formatKeyAmount(
                    processedData,
                    "gmtUsdgNativeRewards",
                    18,
                    8,
                    true
                  )} WBNB, `}
                {formatKeyAmount(
                  processedData,
                  "gmtUsdgXgmtRewards",
                  18,
                  4,
                  true
                )}{" "}
                xGMT
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Total Staked</div>
              <div>
                {formatKeyAmount(
                  processedData,
                  "gmtUsdgTotalStaked",
                  18,
                  4,
                  true
                )}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "gmtUsdgTotalStakedUsd",
                  30,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-options">
              <a
                className="App-button-option App-card-option"
                href={buyGmtUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get GMT
              </a>
              <a
                className="App-button-option App-card-option"
                href={addGmtUsdgLpUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Create
              </a>
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => showStakeGmtUsdgModal()}
                >
                  Stake
                </button>
              )}
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => showUnstakeGmtUsdgModal()}
                >
                  Unstake
                </button>
              )}
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() =>
                    claim(gmtUsdgFarmAddress, processedData.gmtUsdgTotalRewards)
                  }
                >
                  Claim
                </button>
              )}
              {!active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={connectWallet}
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="border App-card">
          <div className="Stake-card-title App-card-title">xGMT-NDOL LP</div>
          <div className="Stake-card-bottom App-card-content">
            <div className="Stake-info App-card-row">
              <div className="label">APR</div>
              <div>
                {formatKeyAmount(processedData, "xgmtUsdgApr", 2, 2, true)}%
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Staked</div>
              <div>
                {formatKeyAmount(processedData, "xgmtUsdgStaked", 18, 4, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "xgmtUsdgStakedUsd",
                  30,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Wallet</div>
              <div>
                {formatKeyAmount(processedData, "xgmtUsdgBalance", 18, 2, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "xgmtUsdgBalanceUsd",
                  USD_DECIMALS,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-row">
              <div className="label">Rewards</div>
              <div>
                {hasFeeDistribution &&
                  processedData.xgmtUsdgNativeRewards &&
                  processedData.xgmtUsdgNativeRewards.gt(0) &&
                  `${formatKeyAmount(
                    processedData,
                    "xgmtUsdgNativeRewards",
                    18,
                    8,
                    true
                  )} WBNB, `}
                {formatKeyAmount(
                  processedData,
                  "xgmtUsdgXgmtRewards",
                  18,
                  4,
                  true
                )}{" "}
                xGMT
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Total Staked</div>
              <div>
                {formatKeyAmount(
                  processedData,
                  "xgmtUsdgTotalStaked",
                  18,
                  4,
                  true
                )}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "xgmtUsdgTotalStakedUsd",
                  30,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-options">
              <a
                className="App-button-option App-card-option"
                href={buyXgmtUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get xGMT
              </a>
              <a
                className="App-button-option App-card-option"
                href={addXgmtUsdgLpUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Create
              </a>
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => showStakeXgmtUsdgModal()}
                >
                  Stake
                </button>
              )}
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => showUnstakeXgmtUsdgModal()}
                >
                  Unstake
                </button>
              )}
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() =>
                    claim(
                      xgmtUsdgFarmAddress,
                      processedData.xgmtUsdgTotalRewards
                    )
                  }
                >
                  Claim
                </button>
              )}
              {!active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={connectWallet}
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="border App-card">
          <div className="Stake-card-title App-card-title">AUTO-NDOL LP</div>
          <div className="Stake-card-bottom App-card-content">
            <div className="Stake-info App-card-row">
              <div className="label">APR</div>
              <div>
                {formatKeyAmount(processedData, "autoUsdgApr", 2, 2, true)}%
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Staked</div>
              <div>
                {formatKeyAmount(processedData, "autoUsdgStaked", 18, 4, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "autoUsdgStakedUsd",
                  30,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Wallet</div>
              <div>
                {formatKeyAmount(processedData, "autoUsdgBalance", 18, 2, true)}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "autoUsdgBalanceUsd",
                  USD_DECIMALS,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-row">
              <div className="label">Rewards</div>
              <div>
                {formatKeyAmount(
                  processedData,
                  "autoUsdgXgmtRewards",
                  18,
                  4,
                  true
                )}{" "}
                xGMT
              </div>
            </div>
            <div className="Stake-info App-card-row">
              <div className="label">Total Staked</div>
              <div>
                {formatKeyAmount(
                  processedData,
                  "autoUsdgTotalStaked",
                  18,
                  4,
                  true
                )}{" "}
                ($
                {formatKeyAmount(
                  processedData,
                  "autoUsdgTotalStakedUsd",
                  30,
                  2,
                  true
                )}
                )
              </div>
            </div>
            <div className="App-card-options">
              <a
                className="App-button-option App-card-option"
                href={buyAutoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get AUTO
              </a>
              <a
                className="App-button-option App-card-option"
                href={addAutoUsdgLpUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Create
              </a>
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => showStakeAutoUsdgModal()}
                >
                  Stake
                </button>
              )}
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() => showUnstakeAutoUsdgModal()}
                >
                  Unstake
                </button>
              )}
              {active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={() =>
                    claim(
                      autoUsdgFarmAddress,
                      processedData.autoUsdgTotalRewards
                    )
                  }
                >
                  Claim
                </button>
              )}
              {!active && (
                <button
                  className="App-button-option App-card-option"
                  onClick={connectWallet}
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
