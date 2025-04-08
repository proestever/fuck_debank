const ETHERSCAN_API_KEY = 'E9KUS95THHRYIGP5829C3PIAGQV888ADCB';
const EXPLORER_APIS = {
    ethereum: 'https://api.etherscan.io/api',
    pulsechain: 'https://api.scan.pulsechain.com/api/v2'
};
const CHAIN_LOGOS = {
    Ethereum: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
    PulseChain: 'https://dd.dexscreener.com/ds-data/chains/pulsechain.png'
};
let isFetching = false;
let allTokens = [];
let allTransactions = [];
let showingAllTokens = false;
let currentTxPage = 1;
const TX_PER_PAGE = 20;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('content').classList.add('hidden');
    document.getElementById('toggleTokens').classList.add('hidden');
    document.querySelector('.refresh-button').style.display = 'none';
});

function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`button[onclick="showTab('${tabId}')"]`).classList.add('active');
    if (tabId === 'transactions') displayTransactions(allTransactions);
}

async function fetchData() {
    if (isFetching) return;
    isFetching = true;

    const addressInput = document.getElementById('address').value.trim();
    const addresses = addressInput.split(',').map(addr => addr.trim()).filter(addr => /^0x[a-fA-F0-9]{40}$/.test(addr));

    if (addresses.length === 0) {
        alert('Please enter at least one valid wallet address');
        isFetching = false;
        return;
    }

    document.getElementById('content').classList.remove('hidden');
    document.querySelector('.refresh-button').style.display = 'inline-block';
    document.body.style.justifyContent = 'flex-start';

    document.getElementById('tokenList').innerHTML = '<p>Loading tokens...</p>';
    document.getElementById('txList').innerHTML = '<p>Loading transactions...</p>';
    document.getElementById('totalValue').innerHTML = '';

    try {
        const allPromises = addresses.map(address => Promise.all([
            getNativeBalance('ethereum', address),
            getTokenBalances('ethereum', address),
            getNativeBalance('pulsechain', address),
            getTokenBalances('pulsechain', address),
            getTransactions('ethereum', address),
            getTransactions('pulsechain', address)
        ]));

        const results = await Promise.all(allPromises);

        const tokenMap = new Map();
        allTokens = [];
        allTransactions = [];

        results.forEach(([ethBalance, ethTokens, pulseBalance, pulseTokens, ethTxs, pulseTxs], index) => {
            const address = addresses[index];
            const tokens = [
                { chain: 'Ethereum', symbol: 'ETH', token: 'native', decimals: 18, balance: ethBalance },
                ...ethTokens.map(t => ({ ...t, chain: 'Ethereum' })),
                { chain: 'PulseChain', symbol: 'PLS', token: 'native', decimals: 18, balance: pulseBalance },
                ...pulseTokens.map(t => ({ ...t, chain: 'PulseChain' }))
            ];

            tokens.forEach(token => {
                const key = `${token.chain}-${token.token}-${token.symbol}`;
                if (tokenMap.has(key)) {
                    tokenMap.get(key).balance += token.balance;
                } else {
                    tokenMap.set(key, { ...token });
                }
            });

            allTransactions.push(
                ...ethTxs.map(t => ({ ...t, chain: 'Ethereum', address })),
                ...pulseTxs.map(t => ({ ...t, chain: 'PulseChain', address }))
            );
        });

        allTokens = Array.from(tokenMap.values());
        await displayTokens(allTokens);

        allTransactions.sort((a, b) => (b.timeStamp || b.timestamp) - (a.timeStamp || a.timestamp));
        await displayTransactions(allTransactions);
    } catch (error) {
        alert('Error fetching data: ' + error.message);
        console.error(error);
    } finally {
        isFetching = false;
    }
}

async function getNativeBalance(blockchain, address) {
    const apiUrl = EXPLORER_APIS[blockchain];
    const url = blockchain === 'ethereum'
        ? `${apiUrl}?module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`
        : `${apiUrl}/addresses/${address}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (blockchain === 'ethereum') {
            if (data.status === '1') return Number(data.result);
            throw new Error(data.message || 'Failed to fetch ETH balance');
        } else {
            if (data.balance !== undefined) return Number(data.balance);
            throw new Error('Failed to fetch PLS balance');
        }
    } catch (error) {
        console.error(`Error fetching ${blockchain} balance:`, error);
        return 0;
    }
}

async function getTokenBalances(blockchain, address) {
    const apiUrl = EXPLORER_APIS[blockchain];
    let url;
    if (blockchain === 'ethereum') {
        url = `${apiUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.status !== '1') throw new Error(data.message || 'Failed to fetch Ethereum token data');

            const balances = {};
            data.result.forEach(tx => {
                const token = tx.contractAddress;
                const symbol = tx.tokenSymbol;
                const decimals = parseInt(tx.tokenDecimal) || 18;
                const value = BigInt(tx.value);

                if (!balances[token]) {
                    balances[token] = { symbol, decimals, balance: BigInt(0) };
                }
                if (tx.from.toLowerCase() === address.toLowerCase()) {
                    balances[token].balance -= value;
                } else if (tx.to.toLowerCase() === address.toLowerCase()) {
                    balances[token].balance += value;
                }
            });

            return Object.entries(balances)
                .filter(([_, info]) => info.balance > 0)
                .map(([token, info]) => ({
                    token,
                    symbol: info.symbol,
                    decimals: info.decimals,
                    balance: Number(info.balance)
                }));
        } catch (error) {
            console.error('Error fetching Ethereum tokens:', error);
            return [];
        }
    } else {
        url = `${apiUrl}/addresses/${address}/token-balances`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error('Failed to fetch PulseChain token data');

            return data.map(item => ({
                token: item.token.address,
                symbol: item.token.symbol,
                decimals: Number(item.token.decimals),
                balance: Number(item.value),
                isPLP: item.token.symbol.startsWith('PLP')
            }));
        } catch (error) {
            console.error('Error fetching PulseChain tokens:', error);
            return [];
        }
    }
}

async function getTransactions(blockchain, address) {
    const apiUrl = EXPLORER_APIS[blockchain];
    let url;
    if (blockchain === 'ethereum') {
        url = `${apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
    } else {
        url = `${apiUrl}/addresses/${address}/transactions?filter=to%20%7C%20from`;
    }
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (blockchain === 'ethereum') {
            if (data.status === '1') return data.result;
            throw new Error(data.message || 'Failed to fetch Ethereum transactions');
        } else {
            if (data.items) {
                let transactions = data.items;
                while (data.next_page_params) {
                    const nextUrl = `${apiUrl}/addresses/${address}/transactions?filter=to%20%7C%20from&block_number=${data.next_page_params.block_number}&index=${data.next_page_params.index}&items_count=${data.next_page_params.items_count}`;
                    const nextResponse = await fetch(nextUrl);
                    const nextData = await nextResponse.json();
                    transactions = [...transactions, ...nextData.items];
                    data.next_page_params = nextData.next_page_params;
                }
                return transactions.map(tx => ({
                    ...tx,
                    timeStamp: new Date(tx.timestamp).getTime() / 1000,
                    gas: tx.gas_used,
                    blockNumber: tx.block
                }));
            }
            throw new Error('Failed to fetch PulseChain transactions');
        }
    } catch (error) {
        console.error(`Error fetching ${blockchain} transactions:`, error);
        return [];
    }
}

async function getTransactionReceipt(blockchain, txHash) {
    const apiUrl = EXPLORER_APIS[blockchain];
    let url;
    if (blockchain === 'ethereum') {
        url = `${apiUrl}?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${ETHERSCAN_API_KEY}`;
    } else {
        url = `${apiUrl}/transactions/${txHash}`;
    }
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (blockchain === 'ethereum') {
            if (data.status === '1') return data.result;
            throw new Error(data.message || 'Failed to fetch Ethereum receipt');
        } else {
            if (data.hash) return data;
            throw new Error('Failed to fetch PulseChain receipt');
        }
    } catch (error) {
        console.error(`Error fetching ${blockchain} receipt:`, error);
        return null;
    }
}

async function getTokenTransfers(blockchain, tx, receipt) {
    if (!receipt || !receipt.logs) return { tokensIn: [], tokensOut: [] };

    const transfers = { tokensIn: [], tokensOut: [] };
    const address = document.getElementById('address').value.toLowerCase();

    for (const log of receipt.logs) {
        if (log.topics && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            const from = '0x' + log.topics[1].slice(-40);
            const to = '0x' + log.topics[2].slice(-40);
            const value = BigInt(log.data).toString();
            const tokenAddress = log.address;
            const tokenInfo = await getTokenInfo(blockchain, tokenAddress);
            const amount = (Number(value) / 10 ** (tokenInfo.decimals || 18)).toFixed(4);

            if (from === address) transfers.tokensOut.push(`${amount} ${tokenInfo.symbol}`);
            if (to === address) transfers.tokensIn.push(`${amount} ${tokenInfo.symbol}`);
        }
    }
    return transfers;
}

async function getPLPPairInfo(tokenAddress) {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const pair = data.pairs.find(p => p.chainId === 'pulsechain');
        if (pair) {
            return {
                token0: { address: pair.baseToken.address, symbol: pair.baseToken.symbol, decimals: pair.baseToken.decimals },
                token1: { address: pair.quoteToken.address, symbol: pair.quoteToken.symbol, decimals: pair.quoteToken.decimals },
                liquidity: pair.liquidity.usd,
                totalSupply: pair.totalSupply || await getTotalSupply(tokenAddress)
            };
        }
        return null;
    } catch (error) {
        console.error('Error fetching PLP pair info:', error);
        return null;
    }
}

async function getTotalSupply(tokenAddress) {
    const url = `${EXPLORER_APIS.pulsechain}/tokens/${tokenAddress}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return Number(data.total_supply || 0);
    } catch (error) {
        console.error('Error fetching total supply:', error);
        return 0;
    }
}

async function getTokenInfo(blockchain, tokenAddress) {
    if (tokenAddress === 'native') {
        const priceUrl = blockchain === 'ethereum'
            ? 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
            : 'https://api.coingecko.com/api/v3/simple/price?ids=pulsechain&vs_currencies=usd';
        try {
            const response = await fetch(priceUrl);
            const data = await response.json();
            return {
                name: blockchain === 'ethereum' ? 'Ethereum' : 'PulseChain',
                symbol: blockchain === 'ethereum' ? 'ETH' : 'PLS',
                logo: CHAIN_LOGOS[blockchain === 'ethereum' ? 'Ethereum' : 'PulseChain'],
                price: blockchain === 'ethereum' ? data.ethereum.usd : (data.pulsechain?.usd || 0),
                decimals: 18
            };
        } catch (error) {
            console.error(`Error fetching ${blockchain} price:`, error);
            return { name: blockchain === 'ethereum' ? 'Ethereum' : 'PulseChain', symbol: blockchain === 'ethereum' ? 'ETH' : 'PLS', logo: CHAIN_LOGOS[blockchain === 'ethereum' ? 'Ethereum' : 'PulseChain'], price: 0, decimals: 18 };
        }
    }
    const chainId = blockchain === 'ethereum' ? 'ethereum' : 'pulsechain';
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
            const pair = data.pairs.find(p => p.chainId === chainId) || data.pairs[0];
            return {
                name: pair.baseToken.name || pair.baseToken.symbol,
                symbol: pair.baseToken.symbol,
                logo: pair.info?.imageUrl || 'https://via.placeholder.com/20',
                price: parseFloat(pair.priceUsd) || 0,
                decimals: pair.baseToken.decimals || 18
            };
        }
        return { name: 'Unknown', symbol: 'UNK', logo: 'https://via.placeholder.com/20', price: 0, decimals: 18 };
    } catch (error) {
        console.error('Error fetching token info:', error);
        return { name: 'Unknown', symbol: 'UNK', logo: 'https://via.placeholder.com/20', price: 0, decimals: 18 };
    }
}

async function displayTokens(tokens) {
    const tokenList = document.getElementById('tokenList');
    let ethTotal = 0, pulseTotal = 0;

    const tokenData = await Promise.all(tokens.map(async token => {
        if (token.isPLP) {
            const pairInfo = await getPLPPairInfo(token.token);
            if (pairInfo) {
                const share = token.balance / pairInfo.totalSupply;
                const token0Info = await getTokenInfo('pulsechain', pairInfo.token0.address);
                const token1Info = await getTokenInfo('pulsechain', pairInfo.token1.address);
                const token0Amount = (share * pairInfo.liquidity * 0.5) / token0Info.price;
                const token1Amount = (share * pairInfo.liquidity * 0.5) / token1Info.price;
                const value = share * pairInfo.liquidity;

                return {
                    ...token,
                    name: `${pairInfo.token0.symbol}-${pairInfo.token1.symbol} LP`,
                    adjustedBalance: `${token0Amount.toFixed(4)} ${pairInfo.token0.symbol} + ${token1Amount.toFixed(4)} ${pairInfo.token1.symbol}`,
                    value,
                    price: pairInfo.liquidity / pairInfo.totalSupply,
                    logo: 'https://via.placeholder.com/20' // Placeholder, replace with LP logo if available
                };
            }
        }
        const info = await getTokenInfo(token.chain.toLowerCase(), token.token);
        const adjustedBalance = (token.balance / 10 ** token.decimals).toFixed(4);
        const value = adjustedBalance * info.price;
        return { ...token, ...info, adjustedBalance, value };
    }));

    tokenData.sort((a, b) => b.value - a.value);

    tokenData.forEach(token => {
        const value = parseFloat(token.value.toFixed(2));
        if (token.chain === 'Ethereum') ethTotal += value;
        else pulseTotal += value;
    });

    const totalValueDiv = document.getElementById('totalValue');
    totalValueDiv.innerHTML = `
        <div class="total-cards">
            <div class="total-card"><h3>ETH Balance</h3><p>$${ethTotal.toFixed(2)}</p></div>
            <div class="total-card"><h3>PLS Balance</h3><p>$${pulseTotal.toFixed(2)}</p></div>
            <div class="total-card"><h3>Grand Total</h3><p>$${(ethTotal + pulseTotal).toFixed(2)}</p></div>
        </div>
    `;

    const displayTokens = showingAllTokens ? tokenData : tokenData.slice(0, 10);
    let tableHTML = `
        <table class="token-table">
            <thead><tr><th>Chain</th><th>Name</th><th>Ticker</th><th>Units</th><th>Value (USD)</th></tr></thead>
            <tbody>
    `;

    for (const token of displayTokens) {
        const value = token.value.toFixed(2);
        const explorerLink = token.chain === 'Ethereum'
            ? `https://etherscan.io/${token.token === 'native' ? 'address' : 'token'}/${token.token === 'native' ? document.getElementById('address').value : token.token}`
            : `https://scan.pulsechain.com/${token.token === 'native' ? 'address' : 'token'}/${token.token === 'native' ? document.getElementById('address').value : token.token}`;
        tableHTML += `
            <tr>
                <td><img src="${CHAIN_LOGOS[token.chain]}" alt="${token.chain} logo"></td>
                <td><img src="${token.logo}" alt="${token.symbol} logo" onerror="this.src='${CHAIN_LOGOS.PulseChain}'"> <a href="${explorerLink}" target="_blank">${token.name}</a></td>
                <td>${token.symbol}</td>
                <td>${token.adjustedBalance}</td>
                <td>$${value}</td>
            </tr>
        `;
    }

    tableHTML += '</tbody></table>';
    tokenList.innerHTML = displayTokens.length > 0 ? tableHTML : '<p>No tokens found.</p>';

    const toggleButton = document.getElementById('toggleTokens');
    toggleButton.textContent = showingAllTokens ? 'Show Top 10 Tokens' : 'Show All Tokens';
    toggleButton.style.display = tokenData.length > 10 ? 'block' : 'none';
    toggleButton.classList.remove('hidden');
}

function toggleTokenList() {
    showingAllTokens = !showingAllTokens;
    displayTokens(allTokens);
}

async function displayTransactions(transactions) {
    const txList = document.getElementById('txList');
    const totalPages = Math.ceil(transactions.length / TX_PER_PAGE);
    currentTxPage = Math.min(currentTxPage, totalPages);
    currentTxPage = Math.max(currentTxPage, 1);

    const startIndex = (currentTxPage - 1) * TX_PER_PAGE;
    const endIndex = startIndex + TX_PER_PAGE;
    const pageTransactions = transactions.slice(startIndex, endIndex);

    let tableHTML = `
        <table class="token-table">
            <thead>
                <tr>
                    <th>Chain</th>
                    <th>Date/Time</th>
                    <th>Contract/Protocol</th>
                    <th>Method</th>
                    <th>Tokens In</th>
                    <th>Tokens Out</th>
                    <th>Tx Hash</th>
                    <th>Gas Paid</th>
                    <th>Block</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const tx of pageTransactions) {
        const receipt = await getTransactionReceipt(tx.chain.toLowerCase(), tx.hash);
        const transfers = await getTokenTransfers(tx.chain.toLowerCase(), tx, receipt);
        const date = new Date((tx.timeStamp || tx.timestamp) * 1000).toLocaleString();
        const explorerLink = tx.chain === 'Ethereum'
            ? `https://etherscan.io/tx/${tx.hash}`
            : `https://scan.pulsechain.com/tx/${tx.hash}`;
        const contract = tx.to || 'N/A';
        const method = receipt?.method_id ? receipt.method_id.slice(0, 10) : (tx.input?.slice(0, 10) || 'N/A');
        const gasPaid = tx.chain === 'ethereum'
            ? (Number(tx.gasUsed) * Number(tx.gasPrice) / 1e18).toFixed(6)
            : (Number(tx.gas_used) / 1e18).toFixed(6);
        const block = tx.blockNumber || tx.block;

        tableHTML += `
            <tr>
                <td><img src="${CHAIN_LOGOS[tx.chain]}" alt="${tx.chain} logo"></td>
                <td>${date}</td>
                <td>${contract.slice(0, 10)}...</td>
                <td>${method}</td>
                <td>${transfers.tokensIn.join(', ') || '-'}</td>
                <td>${transfers.tokensOut.join(', ') || '-'}</td>
                <td><a href="${explorerLink}" target="_blank">${tx.hash.slice(0, 10)}...</a></td>
                <td>${gasPaid} ${tx.chain === 'Ethereum' ? 'ETH' : 'PLS'}</td>
                <td>${block}</td>
            </tr>
        `;
    }

    tableHTML += '</tbody></table>';
    txList.innerHTML = pageTransactions.length > 0 ? tableHTML : '<p>No transactions found.</p>';

    const paginationDiv = document.getElementById('txPagination');
    let paginationHTML = `
        <button onclick="goToTxPage(1)" ${currentTxPage === 1 ? 'disabled' : ''}>First</button>
        <button onclick="goToTxPage(${currentTxPage - 1})" ${currentTxPage === 1 ? 'disabled' : ''}>Previous</button>
    `;

    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentTxPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    startPage = Math.max(1, endPage - maxPagesToShow + 1);

    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `<button onclick="goToTxPage(${i})" ${i === currentTxPage ? 'disabled' : ''}>${i}</button>`;
    }

    paginationHTML += `
        <button onclick="goToTxPage(${currentTxPage + 1})" ${currentTxPage === totalPages ? 'disabled' : ''}>Next</button>
        <button onclick="goToTxPage(${totalPages})" ${currentTxPage === totalPages ? 'disabled' : ''}>Last</button>
    `;

    paginationDiv.innerHTML = paginationHTML;
}

function goToTxPage(page) {
    currentTxPage = page;
    displayTransactions(allTransactions);
}
