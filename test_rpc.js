const axios = require('axios');

// Функция для тестирования эндпоинта rpc_d
async function testRpcEndpoint(chainId, method, params) {
  try {
    console.log(`Тестирование метода ${method} для chain_id=${chainId}`);
    
    const response = await axios({
      method: 'POST',
      url: `http://localhost:3000/rpc_d?chain_id=${chainId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      data: {
        jsonrpc: '2.0',
        method: method,
        params: params,
        id: Math.floor(Math.random() * 1000)
      },
      timeout: 10000
    });
    
    console.log(`Статус: ${response.status}`);
    console.log('Ответ:', JSON.stringify(response.data, null, 2));
    
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('Ошибка при тестировании:', error.message);
    if (error.response) {
      console.error('Данные ответа:', error.response.data);
    }
    
    return {
      success: false,
      error: error.message,
      data: error.response ? error.response.data : null
    };
  }
}

// Запуск тестов
async function runTests() {
  // Тест 1: eth_getBalance для Ethereum (chain_id=1)
  await testRpcEndpoint('1', 'eth_getBalance', ['0xCC2A9a398219D3c8Ab006820bc7C025118a295Ed', 'latest']);
  
  // Тест 2: eth_blockNumber для Ethereum (chain_id=1)
  await testRpcEndpoint('1', 'eth_blockNumber', []);
  
  // Тест 3: eth_getBalance для BSC (chain_id=56)
  await testRpcEndpoint('56', 'eth_getBalance', ['0xCC2A9a398219D3c8Ab006820bc7C025118a295Ed', 'latest']);
  
  // Тест 4: eth_getBalance для Polygon (chain_id=137)
  await testRpcEndpoint('137', 'eth_getBalance', ['0xCC2A9a398219D3c8Ab006820bc7C025118a295Ed', 'latest']);
  
  // Тест 5: eth_call для Ethereum (chain_id=1)
  await testRpcEndpoint('1', 'eth_call', [
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT контракт
      data: '0x70a08231000000000000000000000000CC2A9a398219D3c8Ab006820bc7C025118a295Ed' // balanceOf
    },
    'latest'
  ]);
}

// Запускаем тесты
runTests().catch(console.error);
